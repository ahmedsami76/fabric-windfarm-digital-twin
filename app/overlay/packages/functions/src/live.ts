/**
 * The live values of the twin: the newest row of every turbine, the active alarms and the met mast.
 *
 * They can come two ways, and each way has functions of its own in `function_app.ts`:
 *
 *   eventhouse  KQL on the KQL database, as a service principal (`principal.ts`). Seconds old.
 *   lakehouse   T-SQL on the copies of the same tables in the Lakehouse (`sql.ts`), as the owner of
 *               the app. Minutes old, and there without any set-up.
 *
 * The queries are also in the repository, where they can be run by hand:
 * `fabric/kql/94-twin-app-queries.kql` and `fabric/sql/94-twin-app-queries.sql`.
 */
import { FUNCTIONS_BUILD } from './build.js';
import { LAKEHOUSE_WINDOW_MINUTES, LIVE_WINDOW } from './config.js';
import type { Alarm, DiagnosticStep, LiveState, TrendPoint, TurbineLive, TurbineState, Weather } from './contract.js';
import { type Access, type LakehouseLookup, type Lookup, brief, clearLookup, lookup, lookupLakehouse } from './fabric.js';
import { KustoError, runQuery } from './kusto.js';
import { NoPrincipal, type Principal, clearPrincipalToken, principalToken } from './principal.js';
import type { Row, SqlBatch } from './sql.js';

/** The columns of TurbineTelemetry the twin shows, besides TurbineId and Timestamp. */
export const TELEMETRY_COLUMNS = [
  'State',
  'WindSpeed',
  'WindDirection',
  'AmbientTemp',
  'ActivePower',
  'PowerSetpoint',
  'RotorSpeed',
  'PitchAngle',
  'NacelleDirection',
  'YawError',
  'GearboxOilTemp',
  'GearboxBearingTemp',
  'GearboxOilPressure',
  'GearboxVibration',
  'GeneratorWindingTemp',
  'GeneratorBearingTemp',
  'MainBearingTemp',
  'TransformerTemp',
  'HydraulicPressure',
  'TowerVibration',
] as const;

export const TURBINES_QUERY = `TurbineTelemetry
| where Timestamp > ago(${LIVE_WINDOW})
| summarize arg_max(Timestamp, ${TELEMETRY_COLUMNS.join(', ')}) by TurbineId
| order by TurbineId asc`;

export const ALARMS_QUERY = `ActiveAlarms()
| order by RaisedAt desc
| take 100`;

export const WEATHER_QUERY = `WeatherObservations
| where Timestamp > ago(${LIVE_WINDOW})
| summarize arg_max(Timestamp, WindSpeed, WindDirection, WindGust, AmbientTemp, AirDensity)`;

const TURBINE_ID = /^WT-\d{2}$/;

/**
 * The trend query of one turbine. Both values go into the text of the query, so both are checked:
 * the identifier against its pattern, the minutes as a whole number between 5 and 360.
 */
export function trendQuery(turbineId: string, minutes: number): string {
  if (!TURBINE_ID.test(turbineId)) throw new Error(`Not a turbine identifier: ${brief(turbineId)}`);
  const span = Math.min(360, Math.max(5, Math.round(Number(minutes) || 60)));
  return `TurbineTelemetry
| where Timestamp > ago(${span}m) and TurbineId == '${turbineId}'
| summarize ActivePower = avg(ActivePower), WindSpeed = avg(WindSpeed), RotorSpeed = avg(RotorSpeed), GearboxOilTemp = avg(GearboxOilTemp), GearboxBearingTemp = avg(GearboxBearingTemp), GearboxVibration = avg(GearboxVibration) by Timestamp = bin(Timestamp, 1m)
| order by Timestamp asc`;
}

const TREND_COLUMNS = ['ActivePower', 'WindSpeed', 'RotorSpeed', 'GearboxOilTemp', 'GearboxBearingTemp', 'GearboxVibration'] as const;

/*
 * The same four questions in T-SQL, for the copies of the tables in the Lakehouse. The newest row
 * there is minutes old, so the search goes back LAKEHOUSE_WINDOW_MINUTES. Names are written as the
 * Eventhouse spells them: the SQL endpoint tells capitals from small letters.
 */
export const SQL_TURBINES = `WITH newest AS (
  SELECT TurbineId, [Timestamp], ${TELEMETRY_COLUMNS.join(', ')},
         ROW_NUMBER() OVER (PARTITION BY TurbineId ORDER BY [Timestamp] DESC) AS rn
  FROM TurbineTelemetry
  WHERE [Timestamp] > DATEADD(minute, -${LAKEHOUSE_WINDOW_MINUTES}, SYSUTCDATETIME())
)
SELECT TurbineId, [Timestamp], ${TELEMETRY_COLUMNS.join(', ')}
FROM newest
WHERE rn = 1
ORDER BY TurbineId`;

/** What the function ActiveAlarms() of the KQL database does, on the copies of its two tables. */
export const SQL_ALARMS = `WITH started AS (
  SELECT TOP 1 DATEADD(second, -CAST(UptimeSeconds AS int), [Timestamp]) AS StartedAt
  FROM EdgeHeartbeats
  ORDER BY [Timestamp] DESC
), newest AS (
  SELECT [Timestamp], TurbineId, AlarmCode, Status, Severity, Component, Description, Value, Threshold, Unit, SopId, AlarmId,
         ROW_NUMBER() OVER (PARTITION BY AlarmId ORDER BY [Timestamp] DESC) AS rn
  FROM AlarmEvents
  WHERE AlarmCode <> 'COMMS-RESTORED'
)
SELECT TOP 100 [Timestamp] AS RaisedAt, TurbineId, AlarmCode, Severity, Component, Description, Value, Threshold, Unit, SopId, AlarmId
FROM newest
WHERE rn = 1 AND Status = 'raised'
  AND ((SELECT StartedAt FROM started) IS NULL OR [Timestamp] >= DATEADD(minute, -1, (SELECT StartedAt FROM started)))
ORDER BY [Timestamp] DESC`;

export const SQL_WEATHER = `SELECT TOP 1 [Timestamp], WindSpeed, WindDirection, WindGust, AmbientTemp, AirDensity
FROM WeatherObservations
WHERE [Timestamp] > DATEADD(minute, -${LAKEHOUSE_WINDOW_MINUTES}, SYSUTCDATETIME())
ORDER BY [Timestamp] DESC`;

export const SQL_PROBE = `SELECT COUNT(*) AS [Rows], COUNT(DISTINCT TurbineId) AS Turbines, MAX([Timestamp]) AS Newest
FROM TurbineTelemetry
WHERE [Timestamp] > DATEADD(minute, -${LAKEHOUSE_WINDOW_MINUTES}, SYSUTCDATETIME())`;

/** The trend of one turbine in T-SQL, one row a minute. The same checks as `trendQuery`. */
export function sqlTrendQuery(turbineId: string, minutes: number): string {
  if (!TURBINE_ID.test(turbineId)) throw new Error(`Not a turbine identifier: ${brief(turbineId)}`);
  const span = Math.min(360, Math.max(5, Math.round(Number(minutes) || 60)));
  const minute = `DATEADD(minute, DATEDIFF(minute, '2000-01-01', [Timestamp]), CAST('2000-01-01' AS datetime2(0)))`;
  return `SELECT ${minute} AS [Timestamp], ${TREND_COLUMNS.map((c) => `AVG(${c}) AS ${c}`).join(', ')}
FROM TurbineTelemetry
WHERE [Timestamp] > DATEADD(minute, -${span}, SYSUTCDATETIME()) AND TurbineId = '${turbineId}'
GROUP BY ${minute}
ORDER BY [Timestamp]`;
}

const STATES: readonly TurbineState[] = [
  'RUNNING', 'DERATED', 'CURTAILED', 'IDLE', 'PAUSED', 'STOPPED', 'STOPPED_HIGH_WIND', 'MAINTENANCE', 'FAULT',
];

const num = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

export function toTurbine(row: Record<string, unknown>): TurbineLive {
  const state = text(row.State).toUpperCase() as TurbineState;
  return {
    id: text(row.TurbineId),
    timestamp: text(row.Timestamp),
    state: STATES.includes(state) ? state : 'UNKNOWN',
    windSpeed: num(row.WindSpeed),
    windDirection: num(row.WindDirection),
    ambientTemp: num(row.AmbientTemp),
    activePower: num(row.ActivePower),
    powerSetpoint: num(row.PowerSetpoint),
    rotorSpeed: num(row.RotorSpeed),
    pitchAngle: num(row.PitchAngle),
    nacelleDirection: num(row.NacelleDirection),
    yawError: num(row.YawError),
    gearboxOilTemp: num(row.GearboxOilTemp),
    gearboxBearingTemp: num(row.GearboxBearingTemp),
    gearboxOilPressure: num(row.GearboxOilPressure),
    gearboxVibration: num(row.GearboxVibration),
    generatorWindingTemp: num(row.GeneratorWindingTemp),
    generatorBearingTemp: num(row.GeneratorBearingTemp),
    mainBearingTemp: num(row.MainBearingTemp),
    transformerTemp: num(row.TransformerTemp),
    hydraulicPressure: num(row.HydraulicPressure),
    towerVibration: num(row.TowerVibration),
  };
}

export function toAlarm(row: Record<string, unknown>): Alarm {
  return {
    id: text(row.AlarmId),
    turbineId: text(row.TurbineId),
    code: text(row.AlarmCode),
    severity: text(row.Severity).toLowerCase(),
    component: text(row.Component),
    description: text(row.Description),
    raisedAt: text(row.RaisedAt),
    value: numOrNull(row.Value),
    threshold: numOrNull(row.Threshold),
    unit: text(row.Unit),
    sopId: text(row.SopId),
  };
}

export function toWeather(row: Record<string, unknown> | undefined): Weather | null {
  if (!row || !text(row.Timestamp)) return null; // no observation in the window: one row of nulls
  return {
    timestamp: text(row.Timestamp),
    windSpeed: num(row.WindSpeed),
    windDirection: num(row.WindDirection),
    windGust: num(row.WindGust),
    ambientTemp: num(row.AmbientTemp),
    airDensity: num(row.AirDensity),
  };
}

export function toTrendPoint(row: Record<string, unknown>): TrendPoint {
  return {
    t: text(row.Timestamp),
    activePower: num(row.ActivePower),
    windSpeed: num(row.WindSpeed),
    rotorSpeed: num(row.RotorSpeed),
    gearboxOilTemp: num(row.GearboxOilTemp),
    gearboxBearingTemp: num(row.GearboxBearingTemp),
    gearboxVibration: num(row.GearboxVibration),
  };
}

/**
 * Under which name the Eventhouse knows the database: its display name or, when it does not know
 * that, its item identifier. Found out at the first query and remembered while the host lives.
 */
let acceptedDatabase: string | undefined;

/** The same for the SQL endpoint of the Lakehouse: the name of the database it answered to. */
let acceptedSqlDatabase: string | undefined;

/** Forget both. Used by the connection check and by the tests. */
export function resetRoute(): void {
  acceptedDatabase = undefined;
  acceptedSqlDatabase = undefined;
}

export function currentSqlDatabase(): string | undefined {
  return acceptedSqlDatabase;
}

export function currentDatabase(): string | undefined {
  return acceptedDatabase;
}

const unknownDatabase = (error: unknown): boolean =>
  error instanceof KustoError && error.status >= 400 && error.status < 500 && /database/i.test(error.message);

/** Runs KQL on the Eventhouse with the token of the service principal. */
export async function queryEventhouse(access: Access, found: Lookup, token: string, csl: string): Promise<Row[]> {
  const databases = acceptedDatabase ? [acceptedDatabase] : [found.kqlDatabaseName, found.kqlDatabaseId];
  let failure: unknown;
  for (const database of databases) {
    try {
      const rows = await runQuery({ queryServiceUri: found.queryServiceUri, database, query: csl, token, fetch: access.fetch });
      acceptedDatabase = database;
      return rows;
    } catch (error) {
      failure = error;
      if (unknownDatabase(error)) continue; // try the identifier
      if (acceptedDatabase) resetRoute(); // what worked before no longer does: start over next time
      throw error;
    }
  }
  throw failure ?? new Error('The Eventhouse was not asked.');
}

function liveState(route: 'eventhouse' | 'lakehouse', turbineRows: Row[], alarmRows: Row[], weatherRows: Row[]): LiveState {
  const turbines = turbineRows.map(toTurbine);
  const asOf = turbines.reduce((latest, t) => (t.timestamp > latest ? t.timestamp : latest), '');
  return { source: 'fabric', route, asOf, turbines, alarms: alarmRows.map(toAlarm), weather: toWeather(weatherRows[0]) };
}

/** The live values from the KQL database, as the service principal. Throws NoPrincipal when there is none. */
export async function liveFromEventhouse(access: Access, principal: () => Principal): Promise<LiveState> {
  const who = principal();
  const [found, token] = await Promise.all([lookup(access), principalToken(who, access.fetch)]);
  // The first query settles the name of the database; the other two then run side by side.
  const turbineRows = await queryEventhouse(access, found, token, TURBINES_QUERY);
  const [alarmRows, weatherRows] = await Promise.all([
    queryEventhouse(access, found, token, ALARMS_QUERY),
    queryEventhouse(access, found, token, WEATHER_QUERY),
  ]);
  return liveState('eventhouse', turbineRows, alarmRows, weatherRows);
}

export async function trendFromEventhouse(access: Access, principal: () => Principal, turbineId: string, minutes: number): Promise<TrendPoint[]> {
  const csl = trendQuery(turbineId, minutes);
  const who = principal();
  const [found, token] = await Promise.all([lookup(access), principalToken(who, access.fetch)]);
  return (await queryEventhouse(access, found, token, csl)).map(toTrendPoint);
}

/** Opens the SQL endpoint of a Lakehouse: server, database (the item identifier), token. */
export type SqlConnect = (server: string, database: string, token: string) => SqlBatch;

/**
 * The names the SQL endpoint may know the Lakehouse by, in the order they are tried. Rayfin's guide
 * says the item identifier of the Lakehouse; on the first deployment (23 November 2026) the endpoint
 * answered "the database was not found or you have insufficient permissions" to it and opened the
 * database under the display name. So the name comes first; the two identifiers stay as fallbacks,
 * and the one that answers is remembered while the host lives.
 */
export function sqlDatabaseNames(found: LakehouseLookup): { name: string; kind: string }[] {
  const names = [
    { name: found.lakehouseName, kind: 'the name of the Lakehouse' },
    { name: found.lakehouseId, kind: 'the item identifier of the Lakehouse' },
    ...(found.sqlEndpointId ? [{ name: found.sqlEndpointId, kind: 'the item identifier of the SQL endpoint' }] : []),
  ];
  return names.filter((n, i) => names.findIndex((m) => m.name === n.name) === i);
}

/** True when the endpoint let the token in and did not open the database: another name may work. */
const databaseNotOpened = (error: unknown): boolean =>
  /database was not found|insufficient permissions to connect|cannot open database|ELOGIN/i.test(error instanceof Error ? error.message : String(error));

/** Runs the statements on the Lakehouse, under the first database name the endpoint accepts. */
export async function queryLakehouse(found: LakehouseLookup, token: string, connect: SqlConnect, statements: string[]): Promise<Row[][]> {
  const candidates = sqlDatabaseNames(found);
  const order = acceptedSqlDatabase ? candidates.filter((c) => c.name === acceptedSqlDatabase) : candidates;
  const said: string[] = [];
  for (const candidate of order.length ? order : candidates) {
    try {
      const rows = await connect(found.sqlServer, candidate.name, token)(statements);
      acceptedSqlDatabase = candidate.name;
      return rows;
    } catch (error) {
      if (!databaseNotOpened(error)) throw error;
      said.push(`as ${candidate.kind}: ${brief(error).slice(0, 150)}`);
    }
  }
  acceptedSqlDatabase = undefined; // what worked before no longer does: try every name next time
  throw new Error(`The SQL endpoint opened the database under none of ${said.length} names. ${said.join(' | ')}`);
}

/** The live values from the copies of the tables in the Lakehouse, as the owner of the app. */
export async function liveFromLakehouse(access: Access, sqlToken: () => string, connect: SqlConnect): Promise<LiveState> {
  const found = await lookupLakehouse(access);
  const [turbineRows, alarmRows, weatherRows] = await queryLakehouse(found, sqlToken(), connect, [SQL_TURBINES, SQL_ALARMS, SQL_WEATHER]);
  return liveState('lakehouse', turbineRows ?? [], alarmRows ?? [], weatherRows ?? []);
}

export async function trendFromLakehouse(access: Access, sqlToken: () => string, connect: SqlConnect, turbineId: string, minutes: number): Promise<TrendPoint[]> {
  const statement = sqlTrendQuery(turbineId, minutes);
  const found = await lookupLakehouse(access);
  const [rows] = await queryLakehouse(found, sqlToken(), connect, [statement]);
  return (rows ?? []).map(toTrendPoint);
}

const step = (steps: DiagnosticStep[], name: string, ok: boolean, detail: string): void => {
  steps.push({ step: name, ok, detail: brief(detail) });
};

/**
 * How long a reading takes from the turbine to the KQL database, measured in the data itself: the time
 * the row arrived (`IngestedAt`, which the update policy takes from `ingestion_time()`) minus the time
 * the turbine put on it. No clock of a workstation or of the function host is in it. The connection
 * check prints the result, because the limit after which the page calls its values stale
 * (`STALE_AFTER_S`) has to sit well above the highest delay.
 */
export const DELAY_QUERY = `TurbineTelemetry
| where Timestamp > ago(15m)
| extend DelayS = datetime_diff('second', IngestedAt, Timestamp)
| summarize Rows = count(), Median = percentile(DelayS, 50), P95 = percentile(DelayS, 95), Highest = max(DelayS)`;

/** The words of the connection check for the answer to `DELAY_QUERY`. */
export function delayText(row: Record<string, unknown>): string {
  const n = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : '?');
  return `median ${n(row.Median)} s, 95 % of the rows within ${n(row.P95)} s, highest ${n(row.Highest)} s, over the ${n(row.Rows)} rows of the last 15 minutes`;
}

const minutesOld = (iso: string, now: number): string => {
  const ms = now - new Date(iso).getTime();
  if (!iso || !Number.isFinite(ms)) return 'age unknown';
  return ms < 90_000 ? `${Math.max(0, Math.round(ms / 1000))} s old` : `${Math.round(ms / 60_000)} min old`;
};

/**
 * Tries what the real-time route and the chat need, one thing after the other, and says what happened
 * at each. The steps do not stop at the first failure, so one run shows everything that is wrong.
 */
export async function checkEventhouse(access: Access, principal: () => Principal, now: number = Date.now()): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  step(steps, 'Functions of the Eventhouse route', true, `build ${FUNCTIONS_BUILD}`);

  let fabricOk = false;
  try {
    access.fabricToken();
    fabricOk = true;
    step(steps, 'Token for the Fabric API', true, 'supplied by the host');
  } catch (error) {
    step(steps, 'Token for the Fabric API', false, brief(error));
  }

  let found: Lookup | undefined;
  if (fabricOk) {
    try {
      clearLookup();
      found = await lookup(access);
      step(steps, 'Workspace and KQL database', true, `${found.kqlDatabaseName} at ${found.queryServiceUri}`);
      step(steps, 'Data agent, for the chat', found.dataAgentId !== null, found.dataAgentId ?? 'no item with the name of the agent in the workspace');
    } catch (error) {
      step(steps, 'Workspace and KQL database', false, brief(error));
    }
  }

  let who: Principal | undefined;
  try {
    who = principal();
    step(steps, 'Eventhouse route: service principal', true, `application ${who.clientId} in tenant ${who.tenantId}`);
  } catch (error) {
    if (error instanceof NoPrincipal) {
      steps.push({ step: 'Eventhouse route: service principal', ok: false, skipped: true, detail: brief(error) });
    } else {
      step(steps, 'Eventhouse route: service principal', false, brief(error));
    }
  }

  let token: string | undefined;
  if (who) {
    try {
      clearPrincipalToken();
      token = await principalToken(who, access.fetch);
      step(steps, 'Eventhouse route: token from Microsoft Entra ID', true, 'issued to the service principal');
    } catch (error) {
      step(steps, 'Eventhouse route: token from Microsoft Entra ID', false, brief(error));
    }
  }

  if (found && token) {
    try {
      resetRoute();
      const rows = await queryEventhouse(access, found, token, 'TurbineTelemetry | where Timestamp > ago(2m) | summarize Rows = count(), Turbines = dcount(TurbineId), Newest = max(Timestamp)');
      const r = rows[0] ?? {};
      const newest = text(r.Newest);
      step(steps, 'Eventhouse route: query', num(r.Rows) > 0, num(r.Rows) > 0
        ? `${num(r.Rows)} rows from ${num(r.Turbines)} turbines in the last 2 minutes; newest ${minutesOld(newest, now)}`
        : 'the query ran and found no telemetry in the last 2 minutes: the simulator or the edge VM is stopped (the VM has a daily shutdown)');
      if (num(r.Rows) > 0) {
        // A measurement, not a condition: when it cannot be taken, the route still works.
        try {
          const delay = await queryEventhouse(access, found, token, DELAY_QUERY);
          step(steps, 'Eventhouse route: delay from turbine to database', true, delayText(delay[0] ?? {}));
        } catch (error) {
          steps.push({ step: 'Eventhouse route: delay from turbine to database', ok: false, skipped: true, detail: `not measured: ${brief(error)}` });
        }
      }
    } catch (error) {
      step(steps, 'Eventhouse route: query', false, brief(error));
    }
  }
  return steps;
}

/** Tries what the Lakehouse route needs, in the same manner. */
export async function checkLakehouse(access: Access, sqlToken: () => string, connect: SqlConnect, now: number = Date.now()): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  step(steps, 'Functions of the Lakehouse route', true, `build ${FUNCTIONS_BUILD}`);
  let token: string | undefined;
  try {
    token = sqlToken();
    step(steps, 'Lakehouse route: token for SQL', true, 'supplied by the host');
  } catch (error) {
    step(steps, 'Lakehouse route: token for SQL', false, brief(error));
  }
  let found: LakehouseLookup | undefined;
  try {
    clearLookup();
    found = await lookupLakehouse(access);
    step(steps, 'Lakehouse route: Lakehouse and SQL endpoint', true, `${found.lakehouseName} at ${found.sqlServer}`);
  } catch (error) {
    step(steps, 'Lakehouse route: Lakehouse and SQL endpoint', false, brief(error));
  }
  if (found && token) {
    try {
      acceptedSqlDatabase = undefined; // the check tries every name afresh
      const [rows] = await queryLakehouse(found, token, connect, [SQL_PROBE]);
      const r = rows?.[0] ?? {};
      const newest = text(r.Newest);
      const opened = sqlDatabaseNames(found).find((n) => n.name === acceptedSqlDatabase)?.kind ?? 'an unknown name';
      step(steps, 'Lakehouse route: query', num(r.Rows) > 0, num(r.Rows) > 0
        ? `${num(r.Rows)} rows from ${num(r.Turbines)} turbines in the last ${LAKEHOUSE_WINDOW_MINUTES} minutes; newest ${minutesOld(newest, now)}; database opened as ${opened}`
        : `the query ran and found no telemetry in the last ${LAKEHOUSE_WINDOW_MINUTES} minutes; database opened as ${opened}`);
    } catch (error) {
      // Longer than other lines on purpose: it carries what the endpoint said to each name.
      steps.push({ step: 'Lakehouse route: query', ok: false, detail: (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 900) });
    }
  }
  return steps;
}
