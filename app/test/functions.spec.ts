import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Access, FabricError, brief, clearLookup, lookup, lookupLakehouse } from '../overlay/packages/functions/src/fabric';
import { KustoError, rowsOf } from '../overlay/packages/functions/src/kusto';
import {
  ALARMS_QUERY, DELAY_QUERY, SQL_ALARMS, SQL_PROBE, SQL_TURBINES, SQL_WEATHER, TELEMETRY_COLUMNS, TURBINES_QUERY, WEATHER_QUERY,
  type SqlConnect, checkEventhouse, checkLakehouse, currentDatabase, currentSqlDatabase, delayText, liveFromEventhouse, liveFromLakehouse, resetRoute,
  sqlTrendQuery, toTurbine, trendFromEventhouse, trendFromLakehouse, trendQuery,
} from '../overlay/packages/functions/src/live';
import { NoPrincipal, type Principal, PrincipalRefused, SecretsUnreadable, clearPrincipalToken, principalToken, readPrincipal } from '../overlay/packages/functions/src/principal';
import { plainRows } from '../overlay/packages/functions/src/sql';

const here = new URL('.', import.meta.url).pathname;
const WORKSPACE = '638251b5-0826-4632-b8f1-642e05d39629';
const CLUSTER = 'https://trd-example.z5.kusto.fabric.microsoft.com';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const table = (columns: string[], rows: unknown[][]) => ({ Tables: [{ TableName: 'Table_0', Columns: columns.map((ColumnName) => ({ ColumnName })), Rows: rows }, { TableName: 'Table_1', Columns: [], Rows: [] }] });

const TENANT = '11111111-2222-3333-4444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SECRET = 'S3cr3t~value.of-the_principal';
const SQL_SERVER = 'abc123.datawarehouse.fabric.microsoft.com';
const principal = (): Principal => ({ tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET });
const noPrincipal = (): Principal => readPrincipal(() => undefined);

interface Fake {
  /** What the Eventhouse does with a query, by token and database. Return a Response to answer. */
  kusto?: (token: string, database: string, csl: string) => Response | undefined;
  /** What Microsoft Entra ID answers to the service principal. Default: a token. */
  entra?: (form: URLSearchParams) => Response;
  agent?: boolean;
  workspaces?: unknown[];
  lakehouses?: unknown[];
}

function fabric(fake: Fake = {}): { access: Access; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const token = String((init?.headers as Record<string, string>).Authorization ?? 'none').replace('Bearer ', '');
    if (url === `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`) {
      calls.push(`POST entra`);
      const form = new URLSearchParams(String(init?.body));
      return fake.entra?.(form) ?? json({ token_type: 'Bearer', expires_in: 3600, access_token: `principal-token-for-${form.get('scope')}` });
    }
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.fabric.microsoft.com/v1', '')} [${token}]`);
    if (url === 'https://api.fabric.microsoft.com/v1/workspaces') {
      return json({ value: fake.workspaces ?? [{ id: 'other', displayName: 'Sales' }], continuationUri: fake.workspaces ? null : 'https://api.fabric.microsoft.com/v1/workspaces?continuationToken=2' });
    }
    if (url.endsWith('/workspaces?continuationToken=2')) return json({ value: [{ id: WORKSPACE, displayName: 'WindFarmDigitalTwin' }] });
    if (url.endsWith(`/workspaces/${WORKSPACE}/kqlDatabases`)) {
      return json({ value: [{ id: 'kql-id', displayName: 'WindFarmEH', properties: { queryServiceUri: `${CLUSTER}/` } }] });
    }
    if (url.endsWith(`/workspaces/${WORKSPACE}/lakehouses`)) {
      return json({ value: fake.lakehouses ?? [{ id: 'lh-id', displayName: 'WindFarmLH', properties: { sqlEndpointProperties: { connectionString: SQL_SERVER, id: 'endpoint-id', provisioningStatus: 'Success' } } }] });
    }
    if (url.endsWith(`/workspaces/${WORKSPACE}/items`)) {
      return json({ value: [{ id: 'lh', displayName: 'WindFarmLH', type: 'Lakehouse' }, ...(fake.agent === false ? [] : [{ id: 'agent-id', displayName: 'WindFarmDataAgent', type: 'DataAgent' }])] });
    }
    if (url === `${CLUSTER}/v1/rest/query`) {
      const body = JSON.parse(String(init?.body)) as { db: string; csl: string };
      const answer = fake.kusto?.(token, body.db, body.csl);
      if (answer) return answer;
      if (body.csl.startsWith('TurbineTelemetry\n| where Timestamp > ago(10m)')) {
        return json(table(['TurbineId', 'Timestamp', 'State', 'WindSpeed', 'ActivePower', 'RotorSpeed', 'NacelleDirection', 'GearboxVibration', 'GearboxOilTemp'], [
          ['WT-01', '2026-11-21T18:00:05Z', 'RUNNING', 8.2, 1510.5, 9.9, 196, 1.9, 55.1],
          ['WT-02', '2026-11-21T18:00:10Z', 'fault', 8.0, 0, 0, 190, 6.1, 83.0],
          ['WT-03', '2026-11-21T18:00:07Z', 'WARP_SPEED', null, 'abc', 1, 2, 3, 4],
        ]));
      }
      if (body.csl.startsWith('ActiveAlarms()')) {
        return json(table(['RaisedAt', 'TurbineId', 'AlarmCode', 'Severity', 'Component', 'Description', 'Value', 'Threshold', 'Unit', 'SopId', 'AlarmId'], [
          ['2026-11-21T17:58:00Z', 'WT-02', 'GBX-VIB-HIGH', 'Warning', 'gearbox', 'Gearbox vibration high', 6.1, 5.5, 'mm/s', 'SOP-GBX-001', 'a1'],
        ]));
      }
      if (body.csl.startsWith('WeatherObservations')) return json(table(['Timestamp', 'WindSpeed', 'WindDirection', 'WindGust', 'AmbientTemp', 'AirDensity'], [[null, null, null, null, null, null]]));
      if (body.csl.includes('summarize ActivePower = avg(ActivePower)')) return json(table(['Timestamp', 'ActivePower', 'WindSpeed', 'RotorSpeed', 'GearboxOilTemp', 'GearboxBearingTemp', 'GearboxVibration'], [['2026-11-21T17:00:00Z', 1000, 7, 9, 50, 55, 2]]));
      if (body.csl === DELAY_QUERY) return json(table(['Rows', 'Median', 'P95', 'Highest'], [[2160, 23, 31.4, 44]]));
      return json(table(['Rows', 'Turbines', 'Newest'], [[24, 12, '2026-11-21T18:00:10Z']]));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { access: { fabricToken: () => 'fabric-token', fetch: fetchImpl }, calls };
}

const PRINCIPAL_TOKEN = 'principal-token-for-https://kusto.kusto.windows.net/.default';

/** A pretend SQL endpoint: remembers where it was opened and what it was asked. */
function lakehouse(answers: (statement: string) => Record<string, unknown>[] = () => []): { connect: SqlConnect; opened: string[]; asked: string[] } {
  const opened: string[] = [];
  const asked: string[] = [];
  const connect: SqlConnect = (server, database, token) => {
    opened.push(`${server} ${database} ${token}`);
    return async (statements) => statements.map((statement) => (asked.push(statement), answers(statement)));
  };
  return { connect, opened, asked };
}
const copies = (statement: string): Record<string, unknown>[] => {
  if (statement === SQL_TURBINES) return [{ TurbineId: 'WT-01', Timestamp: '2026-11-21T17:53:05.000Z', State: 'RUNNING', ActivePower: 1500, WindSpeed: 8 }, { TurbineId: 'WT-02', Timestamp: '2026-11-21T17:54:10.000Z', State: 'DERATED', ActivePower: 900, WindSpeed: 8 }];
  if (statement === SQL_ALARMS) return [{ RaisedAt: '2026-11-21T17:50:00.000Z', TurbineId: 'WT-02', AlarmCode: 'GBX-VIB-CRIT', Severity: 'critical', Component: 'gearbox', Description: 'Gearbox vibration critical', Value: 8.2, Threshold: 8, Unit: 'mm/s', SopId: 'SOP-GBX-001', AlarmId: 'a2' }];
  if (statement === SQL_WEATHER) return [{ Timestamp: '2026-11-21T17:54:00.000Z', WindSpeed: 8.4, WindDirection: 200, WindGust: 11, AmbientTemp: 12, AirDensity: 1.1 }];
  if (statement === SQL_PROBE) return [{ Rows: 8000, Turbines: 12, Newest: '2026-11-21T17:54:10.000Z' }];
  return [{ Timestamp: '2026-11-21T17:00:00.000Z', ActivePower: 1000, WindSpeed: 7, RotorSpeed: 9, GearboxOilTemp: 50, GearboxBearingTemp: 55, GearboxVibration: 2 }];
};

beforeEach(() => {
  clearLookup();
  resetRoute();
  clearPrincipalToken();
});

describe('looking the items up', () => {
  it('finds the workspace on a later page, the query address and the data agent', async () => {
    const { access } = fabric();
    const found = await lookup(access);
    expect(found).toMatchObject({ workspaceId: WORKSPACE, kqlDatabaseId: 'kql-id', kqlDatabaseName: 'WindFarmEH', queryServiceUri: CLUSTER, dataAgentId: 'agent-id' });
    expect(found.dataAgentEndpoint).toBe(`https://api.fabric.microsoft.com/v1/mcp/workspaces/${WORKSPACE}/dataagents/agent-id/agent`);
  });

  it('asks Fabric once in ten minutes', async () => {
    const { access, calls } = fabric();
    await lookup(access, 1_000_000);
    const first = calls.length;
    await lookup(access, 1_000_000 + 9 * 60_000);
    expect(calls.length).toBe(first);
    await lookup(access, 1_000_000 + 11 * 60_000);
    expect(calls.length).toBeGreaterThan(first);
  });

  it('says so when the identity of the app does not see the workspace', async () => {
    const { access } = fabric({ workspaces: [{ id: 'x', displayName: 'Sales' }] });
    await expect(lookup(access)).rejects.toThrow(/sees 1 workspaces and none is named WindFarmDigitalTwin/);
    await expect(lookup(access)).rejects.toBeInstanceOf(FabricError);
  });

  it('goes on without a data agent', async () => {
    const found = await lookup(fabric({ agent: false }).access);
    expect(found.dataAgentId).toBeNull();
    expect(found.dataAgentEndpoint).toBeNull();
  });

  it('finds the Lakehouse, the server of its SQL endpoint and its identifier', async () => {
    expect(await lookupLakehouse(fabric().access)).toEqual({ workspaceId: WORKSPACE, lakehouseId: 'lh-id', lakehouseName: 'WindFarmLH', sqlEndpointId: 'endpoint-id', sqlServer: SQL_SERVER });
  });

  it('says so when there is no Lakehouse of that name, or its SQL endpoint is not ready', async () => {
    await expect(lookupLakehouse(fabric({ lakehouses: [{ id: 'x', displayName: 'Other' }] }).access)).rejects.toThrow(/no Lakehouse named WindFarmLH/);
    clearLookup();
    const notReady = [{ id: 'lh-id', displayName: 'WindFarmLH', properties: { sqlEndpointProperties: { connectionString: null, provisioningStatus: 'InProgress' } } }];
    await expect(lookupLakehouse(fabric({ lakehouses: notReady }).access)).rejects.toThrow(/did not return the SQL endpoint.*InProgress/);
  });
});

describe('reading an answer of the Eventhouse', () => {
  it('takes the first table and names the cells', () => {
    expect(rowsOf(table(['A', 'B'], [[1, 'x'], [2, 'y']]))).toEqual([{ A: 1, B: 'x' }, { A: 2, B: 'y' }]);
  });
  it('refuses a body without tables and a failure inside the rows', () => {
    expect(() => rowsOf({})).toThrow(KustoError);
    expect(() => rowsOf({ Tables: [{ Columns: [{ ColumnName: 'A' }], Rows: [{ Exceptions: ['Query execution has exceeded the allowed limits'] }] }] })).toThrow(/failure inside the result/);
  });
});

describe('the service principal', () => {
  it('is read from the three secrets of the app', () => {
    const secrets: Record<string, string> = { KUSTO_TENANT_ID: ` ${TENANT} `, KUSTO_CLIENT_ID: CLIENT, KUSTO_CLIENT_SECRET: SECRET };
    expect(readPrincipal((name) => secrets[name])).toEqual(principal());
  });

  it('is "not set up" when a secret is missing, whether the host throws or returns nothing', () => {
    expect(noPrincipal).toThrow(NoPrincipal);
    expect(noPrincipal).toThrow(/no secret KUSTO_TENANT_ID.*create-principal\.sh/);
    const throwing = (name: string): string => {
      if (name === 'KUSTO_CLIENT_SECRET') throw new Error(`No value available for secret '${name}'.`);
      return name === 'KUSTO_TENANT_ID' ? TENANT : CLIENT;
    };
    expect(() => readPrincipal(throwing)).toThrow(/no secret KUSTO_CLIENT_SECRET/);
  });

  it('is a failure, not "not set up", when the host cannot read the secrets at all', () => {
    const broken = (): string => {
      throw new Error('Secrets could not be retrieved for this invocation. Retry the request.');
    };
    expect(() => readPrincipal(broken)).toThrow(SecretsUnreadable);
    expect(() => readPrincipal(broken)).toThrow(/could not be read \(KUSTO_TENANT_ID\): Secrets could not be retrieved/);
  });

  it('refuses a tenant or an application ID that is not one', () => {
    expect(() => readPrincipal((name) => (name === 'KUSTO_TENANT_ID' ? 'contoso' : CLIENT))).toThrow(/KUSTO_TENANT_ID is not a tenant ID/);
    expect(() => readPrincipal((name) => (name === 'KUSTO_CLIENT_ID' ? 'windfarm-twin' : TENANT))).toThrow(/KUSTO_CLIENT_ID is not an application ID/);
  });

  it('asks Entra for a token for the Eventhouse with its own credentials, and keeps it until shortly before it expires', async () => {
    let form: URLSearchParams | undefined;
    const { access, calls } = fabric({ entra: (f) => ((form = f), json({ expires_in: 3600, access_token: 'T1' })) });
    expect(await principalToken(principal(), access.fetch, 1_000_000)).toBe('T1');
    expect(Object.fromEntries(form!)).toEqual({ grant_type: 'client_credentials', client_id: CLIENT, client_secret: SECRET, scope: 'https://kusto.kusto.windows.net/.default' });
    await principalToken(principal(), access.fetch, 1_000_000 + 54 * 60_000);
    expect(calls.filter((c) => c === 'POST entra')).toHaveLength(1);
    await principalToken(principal(), access.fetch, 1_000_000 + 56 * 60_000);
    expect(calls.filter((c) => c === 'POST entra')).toHaveLength(2);
  });

  it('reports what Entra said when it gives no token, without the secret', async () => {
    const refused = json({ error: 'invalid_client', error_description: `AADSTS7000215: Invalid client secret provided. Ensure the secret being sent is the client secret value. Sent: ${SECRET}` }, 401);
    const { access } = fabric({ entra: () => refused });
    const failure = await principalToken(principal(), access.fetch).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(PrincipalRefused);
    expect((failure as Error).message).toMatch(/no token \(401\): AADSTS7000215: Invalid client secret/);
    expect((failure as Error).message).not.toContain(SECRET);
  });
});

describe('the live values from the Eventhouse', () => {
  it('maps rows to the contract: states in capitals, unknown states and bad numbers made safe', async () => {
    const { access } = fabric();
    const state = await liveFromEventhouse(access, principal);
    expect(state.source).toBe('fabric');
    expect(state.route).toBe('eventhouse');
    expect(state.asOf).toBe('2026-11-21T18:00:10Z');
    expect(state.turbines.map((t) => t.state)).toEqual(['RUNNING', 'FAULT', 'UNKNOWN']);
    expect(state.turbines[0]).toMatchObject({ id: 'WT-01', activePower: 1510.5, nacelleDirection: 196, pitchAngle: 0 });
    expect(state.turbines[2]).toMatchObject({ windSpeed: 0, activePower: 0 });
    expect(state.alarms).toEqual([{ id: 'a1', turbineId: 'WT-02', code: 'GBX-VIB-HIGH', severity: 'warning', component: 'gearbox', description: 'Gearbox vibration high', raisedAt: '2026-11-21T17:58:00Z', value: 6.1, threshold: 5.5, unit: 'mm/s', sopId: 'SOP-GBX-001' }]);
    expect(state.weather).toBeNull(); // one row of nulls means no observation
    expect(toTurbine({ TurbineId: 'WT-09', State: 'derated' }).state).toBe('DERATED');
  });

  it('takes every number of a turbine from the column of the same name, and asks for every such column on both routes', () => {
    const columns = [
      'WindSpeed', 'WindDirection', 'AmbientTemp', 'ActivePower', 'PowerSetpoint', 'RotorSpeed', 'PitchAngle', 'NacelleDirection', 'YawError',
      'GearboxOilTemp', 'GearboxBearingTemp', 'GearboxOilPressure', 'GearboxVibration', 'GeneratorWindingTemp', 'GeneratorBearingTemp',
      'MainBearingTemp', 'TransformerTemp', 'HydraulicPressure', 'TowerVibration',
    ];
    const field = (column: string): string => column[0].toLowerCase() + column.slice(1);
    const row: Record<string, unknown> = { TurbineId: 'WT-04', Timestamp: '2026-11-21T18:00:00Z', State: 'RUNNING' };
    columns.forEach((column, i) => (row[column] = 100 + i));
    const turbine = toTurbine(row) as unknown as Record<string, unknown>;
    columns.forEach((column, i) => expect(turbine[field(column)], column).toBe(100 + i));
    expect(Object.keys(turbine).sort()).toEqual(['id', 'timestamp', 'state', ...columns.map(field)].sort());
    const asked = /arg_max\(Timestamp, ([^)]*)\)/.exec(TURBINES_QUERY)?.[1].split(', ') ?? [];
    expect(asked.sort()).toEqual(['State', ...columns].sort());
    expect([...TELEMETRY_COLUMNS].sort()).toEqual(['State', ...columns].sort());
    const selected = /\nSELECT TurbineId, \[Timestamp\], ([^\n]*)\nFROM newest/.exec(SQL_TURBINES)?.[1].split(', ') ?? [];
    expect(selected.sort()).toEqual(['State', ...columns].sort());
  });

  it('queries as the service principal, never with the token of the app, and by the name of the database', async () => {
    const { access, calls } = fabric();
    await liveFromEventhouse(access, principal);
    expect(currentDatabase()).toBe('WindFarmEH');
    const queries = calls.filter((c) => c.includes('/v1/rest/query'));
    expect(queries).toHaveLength(3);
    expect(queries.every((c) => c.endsWith(`[${PRINCIPAL_TOKEN}]`))).toBe(true);
  });

  it('is not there without a service principal, and asks nobody', async () => {
    const { access, calls } = fabric();
    await expect(liveFromEventhouse(access, noPrincipal)).rejects.toBeInstanceOf(NoPrincipal);
    expect(calls).toEqual([]);
  });

  it('addresses the database by its identifier when the name is not known', async () => {
    const { access } = fabric({ kusto: (_t, db) => (db === 'WindFarmEH' ? json({ error: { message: "Database 'WindFarmEH' could not be found" } }, 400) : undefined) });
    await liveFromEventhouse(access, principal);
    expect(currentDatabase()).toBe('kql-id');
  });

  it('reports what the Eventhouse said when it refuses the service principal', async () => {
    const { access } = fabric({ kusto: () => json({ error: { message: "Principal 'aadapp=…' is not authorized to read database" } }, 403) });
    await expect(liveFromEventhouse(access, principal)).rejects.toThrow(/answered 403: .*not authorized to read database/);
  });

  it('does not retry a query the Eventhouse could not run', async () => {
    const { access, calls } = fabric({ kusto: () => json({ error: { message: 'Semantic error: unknown column' } }, 400) });
    await expect(liveFromEventhouse(access, principal)).rejects.toThrow(/Semantic error/);
    expect(calls.filter((c) => c.includes('/v1/rest/query'))).toHaveLength(1);
  });
});

describe('the live values from the Lakehouse', () => {
  it('opens the SQL endpoint of the Lakehouse with the SQL token and the name of the Lakehouse as database', async () => {
    const sql = lakehouse(copies);
    const state = await liveFromLakehouse(fabric().access, () => 'sql-token', sql.connect);
    expect(sql.opened).toEqual([`${SQL_SERVER} WindFarmLH sql-token`]);
    expect(sql.asked).toEqual([SQL_TURBINES, SQL_ALARMS, SQL_WEATHER]);
    expect(state).toMatchObject({ source: 'fabric', route: 'lakehouse', asOf: '2026-11-21T17:54:10.000Z' });
    expect(state.turbines.map((t) => `${t.id} ${t.state} ${t.activePower}`)).toEqual(['WT-01 RUNNING 1500', 'WT-02 DERATED 900']);
    expect(state.alarms[0]).toMatchObject({ id: 'a2', code: 'GBX-VIB-CRIT', severity: 'critical', raisedAt: '2026-11-21T17:50:00.000Z', value: 8.2 });
    expect(state.weather).toMatchObject({ windSpeed: 8.4, windGust: 11 });
  });

  it('tries the two identifiers when the endpoint does not open the name, and remembers which one worked', async () => {
    // The words the first deployment got, then for the item identifier of the Lakehouse.
    const notFound = "The SQL endpoint of the Lakehouse answered ELOGIN: Login failed for user '<token-identified principal>'.Reason: Authentication was successful, but the database was not found or you have insufficient permissions to connect to it.";
    for (const [knows, tries] of [['lh-id', 2], ['endpoint-id', 3]] as const) {
      resetRoute();
      const opened: string[] = [];
      const connect: SqlConnect = (_server, database) => async (statements) => {
        opened.push(database);
        if (database !== knows) throw new Error(notFound);
        return statements.map(copies);
      };
      const state = await liveFromLakehouse(fabric().access, () => 'sql-token', connect);
      expect(state.turbines).toHaveLength(2);
      expect(opened).toEqual(['WindFarmLH', 'lh-id', 'endpoint-id'].slice(0, tries));
      expect(currentSqlDatabase()).toBe(knows);
      opened.length = 0;
      clearLookup();
      await liveFromLakehouse(fabric().access, () => 'sql-token', connect);
      expect(opened).toEqual([knows]); // no second search
    }
  });

  it('says what the endpoint answered to each name when it opens none', async () => {
    const connect: SqlConnect = () => async () => {
      throw new Error('The SQL endpoint of the Lakehouse answered ELOGIN: Login failed. Reason: the database was not found or you have insufficient permissions to connect to it.');
    };
    const failure = await liveFromLakehouse(fabric().access, () => 'sql-token', connect).catch((e: unknown) => e as Error);
    expect((failure as Error).message).toMatch(/under none of 3 names\. as the name of the Lakehouse: .* \| as the item identifier of the Lakehouse: .* \| as the item identifier of the SQL endpoint: /);
  });

  it('does not try another name when the endpoint opened the database and refused the statement', async () => {
    let attempts = 0;
    const connect: SqlConnect = () => async () => {
      attempts += 1;
      throw new Error("The SQL endpoint of the Lakehouse answered EREQUEST: Invalid object name 'TurbineTelemetry'.");
    };
    await expect(liveFromLakehouse(fabric().access, () => 'sql-token', connect)).rejects.toThrow(/Invalid object name/);
    expect(attempts).toBe(1);
  });

  it('gives an empty picture, not an error, when the copies hold nothing recent', async () => {
    const state = await liveFromLakehouse(fabric().access, () => 'sql-token', lakehouse().connect);
    expect(state).toMatchObject({ route: 'lakehouse', asOf: '', turbines: [], alarms: [], weather: null });
  });

  it('says so when the host has no SQL token, before any connection', async () => {
    const sql = lakehouse(copies);
    const none = (): string => {
      throw new Error('Token for audience Sql was not supplied');
    };
    await expect(liveFromLakehouse(fabric().access, none, sql.connect)).rejects.toThrow(/Sql was not supplied/);
    expect(sql.opened).toEqual([]);
  });

  it('turns dates of the driver into the text the Eventhouse returns, and leaves the rest', () => {
    expect(plainRows([{ Timestamp: new Date('2026-11-21T17:54:10.123Z'), TurbineId: 'WT-01', ActivePower: 1500.5, Value: null, Bad: new Date('x') }]))
      .toEqual([{ Timestamp: '2026-11-21T17:54:10.123Z', TurbineId: 'WT-01', ActivePower: 1500.5, Value: null, Bad: null }]);
  });

  it('asks in T-SQL what ActiveAlarms() of the KQL database asks', () => {
    expect(SQL_ALARMS).toContain("AlarmCode <> 'COMMS-RESTORED'");
    expect(SQL_ALARMS).toContain("Status = 'raised'");
    expect(SQL_ALARMS).toContain('PARTITION BY AlarmId ORDER BY [Timestamp] DESC');
    expect(SQL_ALARMS).toMatch(/StartedAt FROM started\) IS NULL OR \[Timestamp\] >= DATEADD\(minute, -1,/);
    const kql = readFileSync(`${here}../../fabric/kql/02-update-policies.kql`, 'utf8');
    for (const part of ["AlarmCode != 'COMMS-RESTORED'", "Status == 'raised'", 'arg_max(Timestamp, *) by AlarmId', 'Timestamp >= lastStart - 1m']) expect(kql).toContain(part);
  });
});

describe('the trend of one turbine', () => {
  it('returns one point a minute, on either route', async () => {
    const point = { activePower: 1000, windSpeed: 7, rotorSpeed: 9, gearboxOilTemp: 50, gearboxBearingTemp: 55, gearboxVibration: 2 };
    expect(await trendFromEventhouse(fabric().access, principal, 'WT-07', 60)).toEqual([{ t: '2026-11-21T17:00:00Z', ...point }]);
    const sql = lakehouse(copies);
    expect(await trendFromLakehouse(fabric().access, () => 'sql-token', sql.connect, 'WT-07', 60)).toEqual([{ t: '2026-11-21T17:00:00.000Z', ...point }]);
    expect(sql.asked).toEqual([sqlTrendQuery('WT-07', 60)]);
  });
  it('lets nothing but a turbine identifier and a bounded number into the query, in KQL and in T-SQL', () => {
    expect(trendQuery('WT-07', 60)).toContain("ago(60m) and TurbineId == 'WT-07'");
    expect(trendQuery('WT-07', 100000)).toContain('ago(360m)');
    expect(trendQuery('WT-07', Number.NaN)).toContain('ago(60m)');
    expect(trendQuery('WT-07', 0.2)).toContain('ago(5m)');
    expect(sqlTrendQuery('WT-07', 60)).toContain("DATEADD(minute, -60, SYSUTCDATETIME()) AND TurbineId = 'WT-07'");
    expect(sqlTrendQuery('WT-07', 100000)).toContain('DATEADD(minute, -360, SYSUTCDATETIME())');
    expect(sqlTrendQuery('WT-07', Number.NaN)).toContain('DATEADD(minute, -60, SYSUTCDATETIME())');
    for (const bad of ["WT-07' or 1==1 //", 'WT-7', "'; .drop table TurbineTelemetry", "WT-07'; DROP TABLE TurbineTelemetry; --", '']) {
      expect(() => trendQuery(bad, 60)).toThrow(/Not a turbine identifier/);
      expect(() => sqlTrendQuery(bad, 60)).toThrow(/Not a turbine identifier/);
    }
  });
});

describe('the connection check', () => {
  const lines = (steps: { step: string; ok: boolean; skipped?: boolean }[]): string[] => steps.map((s) => `${s.skipped ? 'SKIP' : s.ok ? 'PASS' : 'FAIL'} ${s.step}`);

  it('passes every line of the Eventhouse route when the service principal works', async () => {
    const steps = await checkEventhouse(fabric().access, principal, Date.parse('2026-11-21T18:00:20Z'));
    expect(lines(steps)).toEqual([
      'PASS Functions of the Eventhouse route',
      'PASS Token for the Fabric API', 'PASS Workspace and KQL database', 'PASS Data agent, for the chat',
      'PASS Eventhouse route: service principal', 'PASS Eventhouse route: token from Microsoft Entra ID', 'PASS Eventhouse route: query',
      'PASS Eventhouse route: delay from turbine to database',
    ]);
    expect(steps[0].detail).toMatch(/^build [0-9a-f]{12}$/);
    expect(steps[4].detail).toBe(`application ${CLIENT} in tenant ${TENANT}`);
    expect(steps[6].detail).toMatch(/24 rows from 12 turbines in the last 2 minutes; newest 10 s old/);
    expect(steps[7].detail).toBe('median 23 s, 95 % of the rows within 31 s, highest 44 s, over the 2160 rows of the last 15 minutes');
    expect(JSON.stringify(steps)).not.toContain(SECRET);
  });

  it('measures the delay only when there is telemetry, and a measurement that fails is no failure of the route', async () => {
    const silent = await checkEventhouse(fabric({ kusto: (_t, _d, csl) => (csl === DELAY_QUERY ? undefined : json(table(['Rows', 'Turbines', 'Newest'], [[0, 0, null]]))) }).access, principal);
    expect(lines(silent).slice(-1)).toEqual(['FAIL Eventhouse route: query']);
    expect(silent.at(-1)!.detail).toMatch(/no telemetry in the last 2 minutes.*edge VM is stopped \(the VM has a daily shutdown\)/);
    clearLookup();
    const refused = await checkEventhouse(fabric({ kusto: (_t, _d, csl) => (csl === DELAY_QUERY ? new Response('{"error":{"message":"Semantic error: IngestedAt"}}', { status: 400 }) : undefined) }).access, principal);
    expect(lines(refused).slice(-2)).toEqual(['PASS Eventhouse route: query', 'SKIP Eventhouse route: delay from turbine to database']);
    expect(refused.at(-1)!.detail).toMatch(/^not measured: /);
    expect(delayText({})).toBe('median ? s, 95 % of the rows within ? s, highest ? s, over the ? rows of the last 15 minutes');
  });

  it('skips the Eventhouse route when no service principal is set up, and still checks the rest', async () => {
    const steps = await checkEventhouse(fabric({ agent: false }).access, noPrincipal);
    expect(lines(steps).slice(1)).toEqual(['PASS Token for the Fabric API', 'PASS Workspace and KQL database', 'FAIL Data agent, for the chat', 'SKIP Eventhouse route: service principal']);
    expect(steps[4].detail).toMatch(/No service principal is set up/);
    clearLookup();
    const unreadable = await checkEventhouse(fabric().access, () => readPrincipal(() => {
      throw new Error('Secrets could not be retrieved for this invocation.');
    }));
    expect(lines(unreadable).slice(4)).toEqual(['FAIL Eventhouse route: service principal']);
    expect(unreadable[4].detail).toMatch(/could not be read.*Secrets could not be retrieved/);
  });

  it('shows where the Eventhouse route stops: at Entra, or at the Eventhouse', async () => {
    const atEntra = await checkEventhouse(fabric({ entra: () => json({ error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.' }, 401) }).access, principal);
    expect(lines(atEntra).slice(4)).toEqual(['PASS Eventhouse route: service principal', 'FAIL Eventhouse route: token from Microsoft Entra ID']);
    expect(atEntra[5].detail).toMatch(/AADSTS7000215/);
    clearLookup();
    const atEventhouse = await checkEventhouse(fabric({ kusto: () => json({ error: { message: 'Principal is not authorized to read database' } }, 403) }).access, principal);
    expect(lines(atEventhouse).slice(5)).toEqual(['PASS Eventhouse route: token from Microsoft Entra ID', 'FAIL Eventhouse route: query']);
    expect(atEventhouse[6].detail).toMatch(/403.*not authorized/);
  });

  it('fails the query line when the query runs and finds no telemetry', async () => {
    const steps = await checkEventhouse(fabric({ kusto: (_t, _d, csl) => (csl.includes('summarize Rows') ? json(table(['Rows', 'Turbines', 'Newest'], [[0, 0, null]])) : undefined) }).access, principal);
    expect(steps[6]).toMatchObject({ ok: false });
    expect(steps[6].detail).toMatch(/found no telemetry in the last 2 minutes/);
  });

  it('checks the Lakehouse route: token, endpoint, a query with the age of the newest row', async () => {
    const sql = lakehouse(copies);
    const steps = await checkLakehouse(fabric().access, () => 'sql-token', sql.connect, Date.parse('2026-11-21T18:00:10Z'));
    expect(lines(steps)).toEqual(['PASS Functions of the Lakehouse route', 'PASS Lakehouse route: token for SQL', 'PASS Lakehouse route: Lakehouse and SQL endpoint', 'PASS Lakehouse route: query']);
    expect(steps[2].detail).toBe(`WindFarmLH at ${SQL_SERVER}`);
    expect(steps[3].detail).toBe('8000 rows from 12 turbines in the last 60 minutes; newest 6 min old; database opened as the name of the Lakehouse');
    expect(sql.asked).toEqual([SQL_PROBE]);
  });

  it('shows where the Lakehouse route stops', async () => {
    const none = (): string => {
      throw new Error('Token for audience Sql was not supplied');
    };
    expect(lines(await checkLakehouse(fabric().access, none, lakehouse().connect)).slice(1)).toEqual(['FAIL Lakehouse route: token for SQL', 'PASS Lakehouse route: Lakehouse and SQL endpoint']);
    const refusing: SqlConnect = () => async () => {
      throw new Error('The SQL endpoint of the Lakehouse answered ELOGIN: Login failed for user');
    };
    const steps = await checkLakehouse(fabric().access, () => 'sql-token', refusing);
    expect(lines(steps).slice(1)).toEqual(['PASS Lakehouse route: token for SQL', 'PASS Lakehouse route: Lakehouse and SQL endpoint', 'FAIL Lakehouse route: query']);
    expect(steps[3].detail).toMatch(/under none of 3 names.*as the name of the Lakehouse.*ELOGIN: Login failed.*as the item identifier of the SQL endpoint/);
  });

  it('never repeats a token or a secret in a message', () => {
    expect(brief(new Error('401 for Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOi.abc-def_123 failed'))).not.toMatch(/eyJ0/);
    expect(brief('grant_type=client_credentials&client_secret=S3cr3t~value&scope=x')).toBe('grant_type=client_credentials&client_secret=…&scope=x');
  });
});

describe('the build stamp', () => {
  it('is the same for the page and the functions of one build, so that a difference in the check means an older part is answering', async () => {
    const { PAGE_BUILD } = await import('../overlay/packages/frontend/src/twin/data/build');
    const { FUNCTIONS_BUILD } = await import('../overlay/packages/functions/src/build');
    expect(PAGE_BUILD).toMatch(/^[0-9a-f]{12}$/);
    expect(FUNCTIONS_BUILD).toBe(PAGE_BUILD);
  });
});

describe('the queries', () => {
  it('are the ones in the repository, where they can be run by hand', () => {
    const kql = readFileSync(`${here}../../fabric/kql/94-twin-app-queries.kql`, 'utf8').replace(/\r/g, '');
    for (const query of [TURBINES_QUERY, ALARMS_QUERY, WEATHER_QUERY, trendQuery('WT-07', 60), DELAY_QUERY]) expect(kql).toContain(query);
    const sql = readFileSync(`${here}../../fabric/sql/94-twin-app-queries.sql`, 'utf8').replace(/\r/g, '');
    for (const query of [SQL_TURBINES, SQL_ALARMS, SQL_WEATHER, sqlTrendQuery('WT-07', 60), SQL_PROBE]) expect(sql).toContain(query);
  });
});
