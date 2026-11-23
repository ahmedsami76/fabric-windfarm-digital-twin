/**
 * Where the twin gets its values. Two implementations: the functions of the Fabric app
 * (`fabricProvider.ts`) and a simulation that runs in the browser (`sampleProvider.ts`).
 */
import type { AgentAnswer, DiagnosticStep, LiveState, TrendPoint } from './contract';

export interface TwinDataProvider {
  /** `fabric` reads the KQL database and asks the data agent; `sample` invents its values. */
  readonly kind: 'fabric' | 'sample';
  getLiveState(): Promise<LiveState>;
  getTrend(turbineId: string, minutes: number): Promise<TrendPoint[]>;
  ask(question: string): Promise<AgentAnswer>;
  diagnostics(): Promise<DiagnosticStep[]>;
  /** Only the simulation has it: start a gearbox fault on a turbine, as the edge script does. */
  injectFault?(turbineId: string): void;
}

/** How often the twin asks for new values, in milliseconds. The simulator reports every 5 seconds. */
export const POLL_MS = 5000;

/** Telemetry older than this many seconds is shown as stale. */
export const STALE_AFTER_S = 60;

/** True when the address of the page asks for the simulation: `?sample` or `?sample=1`. */
export function sampleRequested(search: string = window.location.search): boolean {
  const value = new URLSearchParams(search).get('sample');
  return value !== null && value !== '0' && value !== 'false';
}
