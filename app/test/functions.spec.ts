import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';

import { type Access, FabricError, brief, clearLookup, lookup } from '../overlay/packages/functions/src/fabric';
import { KustoError, rowsOf } from '../overlay/packages/functions/src/kusto';
import { ALARMS_QUERY, TURBINES_QUERY, WEATHER_QUERY, currentRoute, getDiagnostics, getLiveState, getTurbineTrend, resetRoute, toTurbine, trendQuery } from '../overlay/packages/functions/src/live';

const here = new URL('.', import.meta.url).pathname;
const WORKSPACE = '638251b5-0826-4632-b8f1-642e05d39629';
const CLUSTER = 'https://trd-example.z5.kusto.fabric.microsoft.com';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const table = (columns: string[], rows: unknown[][]) => ({ Tables: [{ TableName: 'Table_0', Columns: columns.map((ColumnName) => ({ ColumnName })), Rows: rows }, { TableName: 'Table_1', Columns: [], Rows: [] }] });

interface Fake {
  /** What the Eventhouse does with a query, by token and database. Return a Response to answer. */
  kusto?: (token: string, database: string, csl: string) => Response | undefined;
  agent?: boolean;
  workspaces?: unknown[];
}

function fabric(fake: Fake = {}): { access: Access; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const token = String((init?.headers as Record<string, string>).Authorization).replace('Bearer ', '');
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.fabric.microsoft.com/v1', '')} [${token}]`);
    if (url === 'https://api.fabric.microsoft.com/v1/workspaces') {
      return json({ value: fake.workspaces ?? [{ id: 'other', displayName: 'Sales' }], continuationUri: fake.workspaces ? null : 'https://api.fabric.microsoft.com/v1/workspaces?continuationToken=2' });
    }
    if (url.endsWith('/workspaces?continuationToken=2')) return json({ value: [{ id: WORKSPACE, displayName: 'WindFarmDigitalTwin' }] });
    if (url.endsWith(`/workspaces/${WORKSPACE}/kqlDatabases`)) {
      return json({ value: [{ id: 'kql-id', displayName: 'WindFarmEH', properties: { queryServiceUri: `${CLUSTER}/` } }] });
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
          ['2026-11-21T17:58:00Z', 'WT-02', 'GBX-VIB', 'Critical', 'gearbox', 'Gearbox vibration high', 6.1, 5.5, 'mm/s', 'SOP-GBX-001', 'a1'],
        ]));
      }
      if (body.csl.startsWith('WeatherObservations')) return json(table(['Timestamp', 'WindSpeed', 'WindDirection', 'WindGust', 'AmbientTemp', 'AirDensity'], [[null, null, null, null, null, null]]));
      if (body.csl.includes('summarize ActivePower = avg(ActivePower)')) return json(table(['Timestamp', 'ActivePower', 'WindSpeed', 'RotorSpeed', 'GearboxOilTemp', 'GearboxBearingTemp', 'GearboxVibration'], [['2026-11-21T17:00:00Z', 1000, 7, 9, 50, 55, 2]]));
      return json(table(['Rows', 'Turbines', 'Newest'], [[24, 12, '2026-11-21T18:00:10Z']]));
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { access: { fabricToken: () => 'fabric-token', kustoToken: () => 'kusto-token', fetch: fetchImpl }, calls };
}

beforeEach(() => {
  clearLookup();
  resetRoute();
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

describe('the live values', () => {
  it('maps rows to the contract: states in capitals, unknown states and bad numbers made safe', async () => {
    const { access } = fabric();
    const state = await getLiveState(access);
    expect(state.source).toBe('fabric');
    expect(state.asOf).toBe('2026-11-21T18:00:10Z');
    expect(state.turbines.map((t) => t.state)).toEqual(['RUNNING', 'FAULT', 'UNKNOWN']);
    expect(state.turbines[0]).toMatchObject({ id: 'WT-01', activePower: 1510.5, nacelleDirection: 196, pitchAngle: 0 });
    expect(state.turbines[2]).toMatchObject({ windSpeed: 0, activePower: 0 });
    expect(state.alarms).toEqual([{ id: 'a1', turbineId: 'WT-02', code: 'GBX-VIB', severity: 'critical', component: 'gearbox', description: 'Gearbox vibration high', raisedAt: '2026-11-21T17:58:00Z', value: 6.1, threshold: 5.5, unit: 'mm/s', sopId: 'SOP-GBX-001' }]);
    expect(state.weather).toBeNull(); // one row of nulls means no observation
    expect(toTurbine({ TurbineId: 'WT-09', State: 'derated' }).state).toBe('DERATED');
  });

  it('uses the Eventhouse token and the database name when both are accepted', async () => {
    const { access, calls } = fabric();
    await getLiveState(access);
    expect(currentRoute()).toEqual({ token: 'kusto', database: 'WindFarmEH' });
    expect(calls.filter((c) => c.includes('/v1/rest/query')).every((c) => c.endsWith('[kusto-token]'))).toBe(true);
  });

  it('falls back to the Fabric token when the Eventhouse refuses its own, and remembers it', async () => {
    const { access, calls } = fabric({ kusto: (token) => (token === 'kusto-token' ? json({ error: { message: 'Unauthorized' } }, 401) : undefined) });
    await getLiveState(access);
    expect(currentRoute().token).toBe('fabric');
    const before = calls.filter((c) => c.endsWith('[kusto-token]')).length;
    await getLiveState(access);
    expect(calls.filter((c) => c.endsWith('[kusto-token]')).length).toBe(before); // not tried again
  });

  it('falls back to the Fabric token when the host has no Eventhouse token', async () => {
    const { access } = fabric();
    access.kustoToken = () => {
      throw new Error('Token for audience https://kusto.kusto.windows.net was not supplied');
    };
    expect((await getLiveState(access)).turbines).toHaveLength(3);
    expect(currentRoute().token).toBe('fabric');
  });

  it('addresses the database by its identifier when the name is not known', async () => {
    const { access } = fabric({ kusto: (_t, db) => (db === 'WindFarmEH' ? json({ error: { message: "Database 'WindFarmEH' could not be found" } }, 400) : undefined) });
    await getLiveState(access);
    expect(currentRoute().database).toBe('kql-id');
  });

  it('reports what the Eventhouse said when both tokens are refused', async () => {
    const { access } = fabric({ kusto: () => json({ error: { message: 'Principal is not authorized to read database' } }, 403) });
    await expect(getLiveState(access)).rejects.toThrow(/answered 403: .*not authorized to read database/);
  });

  it('does not retry a query the Eventhouse could not run', async () => {
    const { access, calls } = fabric({ kusto: () => json({ error: { message: 'Semantic error: unknown column' } }, 400) });
    await expect(getLiveState(access)).rejects.toThrow(/Semantic error/);
    expect(calls.filter((c) => c.includes('/v1/rest/query'))).toHaveLength(1);
  });
});

describe('the trend of one turbine', () => {
  it('returns one point a minute', async () => {
    const points = await getTurbineTrend(fabric().access, 'WT-07', 60);
    expect(points).toEqual([{ t: '2026-11-21T17:00:00Z', activePower: 1000, windSpeed: 7, rotorSpeed: 9, gearboxOilTemp: 50, gearboxBearingTemp: 55, gearboxVibration: 2 }]);
  });
  it('lets nothing but a turbine identifier and a bounded number into the query', () => {
    expect(trendQuery('WT-07', 60)).toContain("ago(60m) and TurbineId == 'WT-07'");
    expect(trendQuery('WT-07', 100000)).toContain('ago(360m)');
    expect(trendQuery('WT-07', Number.NaN)).toContain('ago(60m)');
    expect(trendQuery('WT-07', 0.2)).toContain('ago(5m)');
    for (const bad of ["WT-07' or 1==1 //", 'WT-7', "'; .drop table TurbineTelemetry", '']) expect(() => trendQuery(bad, 60)).toThrow(/Not a turbine identifier/);
  });
});

describe('the connection check', () => {
  it('passes every line when everything works, and tries both tokens', async () => {
    const steps = await getDiagnostics(fabric().access);
    expect(steps.map((s) => `${s.ok ? 'PASS' : 'FAIL'} ${s.step}`)).toEqual([
      'PASS Token for the Fabric API', 'PASS Token for the Eventhouse', 'PASS Workspace and KQL database', 'PASS Data agent',
      'PASS Query with the Eventhouse token', 'PASS Query with the Fabric token',
    ]);
    expect(steps[4].detail).toMatch(/24 rows from 12 turbines/);
  });

  it('shows which token the Eventhouse refuses, and goes on', async () => {
    const { access } = fabric({ agent: false, kusto: (token) => (token === 'fabric-token' ? json({ error: { message: 'InvalidAudience' } }, 401) : undefined) });
    const steps = await getDiagnostics(access);
    const line = (name: string) => steps.find((s) => s.step === name)!;
    expect(line('Query with the Eventhouse token').ok).toBe(true);
    expect(line('Query with the Fabric token')).toMatchObject({ ok: false });
    expect(line('Query with the Fabric token').detail).toMatch(/401.*InvalidAudience/);
    expect(line('Data agent').ok).toBe(false);
  });

  it('never repeats a token in a message', () => {
    expect(brief(new Error('401 for Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOi.abc-def_123 failed'))).not.toMatch(/eyJ0/);
  });
});

describe('the queries', () => {
  it('are the ones in fabric/kql/94-twin-app-queries.kql, where they can be run by hand', () => {
    const file = readFileSync(`${here}../../fabric/kql/94-twin-app-queries.kql`, 'utf8').replace(/\r/g, '');
    for (const query of [TURBINES_QUERY, ALARMS_QUERY, WEATHER_QUERY, trendQuery('WT-07', 60)]) expect(file).toContain(query);
  });
});
