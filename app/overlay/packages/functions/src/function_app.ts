/**
 * The server side of the wind farm twin: four functions that the browser calls through the Rayfin
 * client. They run as the identity of the app, which today is the owner of the Fabric app item.
 *
 *   getLiveState     newest row per turbine, active alarms, met mast   KQL database
 *   getTurbineTrend  one turbine, minute by minute                      KQL database
 *   askAgent         one question to the published data agent           Fabric API (MCP)
 *   getDiagnostics   tries each connection and reports                  both
 *
 * Every function returns JSON text in a shape of `contract.ts`, so that `types.ts` stays four lines
 * of `string` whatever the shapes become.
 *
 * The audiences in the context annotations are the declaration Rayfin deploys from. They are written
 * literally on purpose: `AudienceType.Fabric` for the Fabric API, and the resource of the Eventhouse
 * as a custom audience.
 */
import { AudienceType, UserDataFunctions, type RayfinContext } from '@microsoft/fabric-user-data-functions';

import { askDataAgent } from './agent.js';
import { type Access, lookup } from './fabric.js';
import { getDiagnostics, getLiveState, getTurbineTrend } from './live.js';

const udf = new UserDataFunctions();

// The app has no tables of its own, so the data schema of the context is left open.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NoTables = Record<string, any>;

udf.func(
  'getLiveState',
  async (
    ctx: RayfinContext<NoTables, AudienceType.Fabric | 'https://kusto.kusto.windows.net'>
  ): Promise<string> => {
    const access: Access = {
      fabricToken: () => ctx.Tokens.Fabric,
      kustoToken: () => ctx.Tokens['https://kusto.kusto.windows.net'],
      fetch,
    };
    return JSON.stringify(await getLiveState(access));
  },
  []
);

udf.func(
  'getTurbineTrend',
  async (
    turbineId: string,
    minutes: number,
    ctx: RayfinContext<NoTables, AudienceType.Fabric | 'https://kusto.kusto.windows.net'>
  ): Promise<string> => {
    const access: Access = {
      fabricToken: () => ctx.Tokens.Fabric,
      kustoToken: () => ctx.Tokens['https://kusto.kusto.windows.net'],
      fetch,
    };
    return JSON.stringify(await getTurbineTrend(access, turbineId, minutes));
  },
  []
);

udf.func(
  'askAgent',
  async (question: string, ctx: RayfinContext<NoTables, AudienceType.Fabric>): Promise<string> => {
    const token = ctx.Tokens.Fabric;
    const access: Access = {
      fabricToken: () => token,
      kustoToken: () => {
        throw new Error('askAgent does not query the Eventhouse.');
      },
      fetch,
    };
    const found = await lookup(access);
    if (!found.dataAgentEndpoint) {
      throw new Error('No data agent named WindFarmDataAgent in the workspace. Build it with notebook 09 of Phase 3.');
    }
    return JSON.stringify(await askDataAgent(found.dataAgentEndpoint, token, question, fetch));
  },
  []
);

udf.func(
  'getDiagnostics',
  async (
    ctx: RayfinContext<NoTables, AudienceType.Fabric | 'https://kusto.kusto.windows.net'>
  ): Promise<string> => {
    const access: Access = {
      fabricToken: () => ctx.Tokens.Fabric,
      kustoToken: () => ctx.Tokens['https://kusto.kusto.windows.net'],
      fetch,
    };
    return JSON.stringify(await getDiagnostics(access));
  },
  []
);
