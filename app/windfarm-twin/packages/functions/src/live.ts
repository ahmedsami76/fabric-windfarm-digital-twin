/**
 * The live values of the twin: the newest row of every turbine, the active alarms and the met mast,
 * read from the KQL database. The four queries are also in `fabric/kql/94-twin-app-queries.kql` of the
 * repository, where they can be run by hand.
 */
import { LIVE_WINDOW } from './config.js';
import type { Alarm, DiagnosticStep, LiveState, TrendPoint, TurbineLive, TurbineState, Weather } from './contract.js';
import { type Access, type Lookup, brief, clearLookup, lookup } from './fabric.js';
import { KustoError, runQuery } from './kusto.js';

export const TURBINES_QUERY = `TurbineTelemetry
| where Timestamp > ago(${LIVE_WINDOW})
| summarize arg_max(Timestamp, State, WindSpeed, WindDirection, AmbientTemp, ActivePower, PowerSetpoint, RotorSpeed, PitchAngle, NacelleDirection, YawError, GearboxOilTemp, GearboxBearingTemp, GearboxVibration, GeneratorWindingTemp, MainBearingTemp, TowerVibration) by TurbineId
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
    gearboxVibration: num(row.GearboxVibration),
    generatorWindingTemp: num(row.GeneratorWindingTemp),
    mainBearingTemp: num(row.MainBearingTemp),
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
 * Which token the Eventhouse accepted, and under which name it knows the database. Both are found
 * out at the first query and remembered while the function host lives.
 */
type TokenRoute = 'kusto' | 'fabric';
let acceptedRoute: TokenRoute | undefined;
let acceptedDatabase: string | undefined;

export function resetRoute(): void {
  acceptedRoute = undefined;
  acceptedDatabase = undefined;
}

export function currentRoute(): { token: TokenRoute | undefined; database: string | undefined } {
  return { token: acceptedRoute, database: acceptedDatabase };
}

const refused = (error: unknown): boolean =>
  error instanceof KustoError && (error.status === 401 || error.status === 403);
const unknownDatabase = (error: unknown): boolean =>
  error instanceof KustoError && error.status >= 400 && error.status < 500 && /database/i.test(error.message);

/**
 * Runs one query. The Eventhouse is asked first with a token issued for it and, when the host has
 * none or the Eventhouse refuses it, with the token for the Fabric API. The database is addressed
 * by its name and, when the Eventhouse does not know that name, by its item identifier.
 */
export async function query(access: Access, found: Lookup, csl: string): Promise<Record<string, unknown>[]> {
  const routes: TokenRoute[] = acceptedRoute ? [acceptedRoute] : ['kusto', 'fabric'];
  const databases = acceptedDatabase ? [acceptedDatabase] : [found.kqlDatabaseName, found.kqlDatabaseId];
  let failure: unknown; // what the Eventhouse said; it says more than "no token"
  let missing: Error | undefined;
  for (const route of routes) {
    let token: string;
    try {
      token = route === 'kusto' ? access.kustoToken() : access.fabricToken();
    } catch (error) {
      missing = new Error(`The host supplied no ${route === 'kusto' ? 'Eventhouse' : 'Fabric'} token: ${brief(error)}`);
      continue;
    }
    for (const database of databases) {
      try {
        const rows = await runQuery({ queryServiceUri: found.queryServiceUri, database, query: csl, token, fetch: access.fetch });
        acceptedRoute = route;
        acceptedDatabase = database;
        return rows;
      } catch (error) {
        failure = error;
        if (unknownDatabase(error)) continue; // try the identifier
        if (refused(error)) break; // try the other token
        throw error;
      }
    }
  }
  if (acceptedRoute && refused(failure)) resetRoute(); // what worked before no longer does: start over next time
  throw failure ?? missing ?? new Error('No token for the Eventhouse.');
}

export async function getLiveState(access: Access): Promise<LiveState> {
  const found = await lookup(access);
  // The first query settles the token and the database name; the other two then run side by side.
  const turbineRows = await query(access, found, TURBINES_QUERY);
  const [alarmRows, weatherRows] = await Promise.all([
    query(access, found, ALARMS_QUERY),
    query(access, found, WEATHER_QUERY),
  ]);
  const turbines = turbineRows.map(toTurbine);
  const asOf = turbines.reduce((latest, t) => (t.timestamp > latest ? t.timestamp : latest), '');
  return {
    source: 'fabric',
    asOf,
    turbines,
    alarms: alarmRows.map(toAlarm),
    weather: toWeather(weatherRows[0]),
  };
}

export async function getTurbineTrend(access: Access, turbineId: string, minutes: number): Promise<TrendPoint[]> {
  const csl = trendQuery(turbineId, minutes);
  const found = await lookup(access);
  return (await query(access, found, csl)).map(toTrendPoint);
}

/**
 * Tries every connection the twin needs, one after the other, and says what happened at each.
 * The steps do not stop at the first failure, so one run shows everything that is wrong.
 */
export async function getDiagnostics(access: Access): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  const add = (step: string, ok: boolean, detail: string) => steps.push({ step, ok, detail: brief(detail) });

  let fabricOk = false;
  try {
    access.fabricToken();
    fabricOk = true;
    add('Token for the Fabric API', true, 'supplied by the host');
  } catch (error) {
    add('Token for the Fabric API', false, brief(error));
  }
  let kustoOk = false;
  try {
    access.kustoToken();
    kustoOk = true;
    add('Token for the Eventhouse', true, 'supplied by the host');
  } catch (error) {
    add('Token for the Eventhouse', false, brief(error));
  }

  let found: Lookup | undefined;
  if (fabricOk) {
    try {
      clearLookup();
      found = await lookup(access);
      add('Workspace and KQL database', true, `${found.kqlDatabaseName} at ${found.queryServiceUri}`);
      add('Data agent', found.dataAgentId !== null, found.dataAgentId ?? 'no item with the name of the agent in the workspace');
    } catch (error) {
      add('Workspace and KQL database', false, brief(error));
    }
  }

  if (found) {
    for (const route of ['kusto', 'fabric'] as const) {
      const label = route === 'kusto' ? 'Query with the Eventhouse token' : 'Query with the Fabric token';
      if (route === 'kusto' ? !kustoOk : !fabricOk) {
        add(label, false, 'no token');
        continue;
      }
      const only: Access = {
        fetch: access.fetch,
        fabricToken: route === 'fabric' ? access.fabricToken : () => { throw new Error('not used in this step'); },
        kustoToken: route === 'kusto' ? access.kustoToken : () => { throw new Error('not used in this step'); },
      };
      try {
        resetRoute();
        const rows = await query(only, found, 'TurbineTelemetry | where Timestamp > ago(2m) | summarize Rows = count(), Turbines = dcount(TurbineId), Newest = max(Timestamp)');
        const r = rows[0] ?? {};
        add(label, true, `${num(r.Rows)} rows from ${num(r.Turbines)} turbines in the last 2 minutes; newest ${text(r.Newest) || 'none'}`);
      } catch (error) {
        add(label, false, brief(error));
      }
    }
    resetRoute();
  }
  return steps;
}
