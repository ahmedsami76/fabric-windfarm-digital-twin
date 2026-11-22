/**
 * The values of the deployed twin: every call goes to a function of the Fabric app, which reads the
 * KQL database or asks the data agent as the identity of the app. No token reaches the browser.
 */
import { getRayfinClient } from '@/lib/rayfin-client';

import type { AgentAnswer, DiagnosticStep, LiveState, TrendPoint } from './contract';
import type { TwinDataProvider } from './provider';

function parse<T>(text: string, name: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`The function ${name} did not return JSON.`);
  }
}

/** The functions host stops an invocation after 240 seconds; the data agent may need most of that. */
const AGENT_WAIT_MS = 240_000;

export function createFabricProvider(): TwinDataProvider {
  return {
    kind: 'fabric',
    getLiveState: async (): Promise<LiveState> => {
      const client = await getRayfinClient();
      return parse<LiveState>(await client.functions.getLiveState.invoke(), 'getLiveState');
    },
    getTrend: async (turbineId: string, minutes: number): Promise<TrendPoint[]> => {
      const client = await getRayfinClient();
      return parse<TrendPoint[]>(await client.functions.getTurbineTrend.invoke({ turbineId, minutes }), 'getTurbineTrend');
    },
    ask: async (question: string): Promise<AgentAnswer> => {
      const client = await getRayfinClient();
      return parse<AgentAnswer>(await client.functions.askAgent.invoke({ question }, { timeoutMs: AGENT_WAIT_MS }), 'askAgent');
    },
    diagnostics: async (): Promise<DiagnosticStep[]> => {
      const client = await getRayfinClient();
      return parse<DiagnosticStep[]>(await client.functions.getDiagnostics.invoke(undefined, { timeoutMs: 90_000 }), 'getDiagnostics');
    },
  };
}
