/**
 * Where the twin gets its values. Two implementations: the functions of the Fabric app
 * (`fabricProvider.ts`) and a simulation that runs in the browser (`sampleProvider.ts`).
 */
import type { AgentAnswer, DiagnosticStep, LiveState, TrendPoint } from './contract';

export interface TwinDataProvider {
  /** `fabric` reads Fabric and asks the data agent; `sample` invents its values. */
  readonly kind: 'fabric' | 'sample';
  getLiveState(): Promise<LiveState>;
  getTrend(turbineId: string, minutes: number): Promise<TrendPoint[]>;
  ask(question: string): Promise<AgentAnswer>;
  diagnostics(): Promise<DiagnosticStep[]>;
  /** Only the simulation has it: start a gearbox fault on a turbine, as the edge script does. */
  injectFault?(turbineId: string): void;
  /** Only the Fabric provider has it: the route of the last answer, and what the Eventhouse route said. */
  routeStatus?(): { route: 'eventhouse' | 'lakehouse' | null; eventhouseSaid: string | null };
}

/** How often the twin asks for new values, in milliseconds. The simulator reports every 5 seconds. */
export const POLL_MS = 5000;

/** The copies in the Lakehouse change every few minutes: asking twice a minute is enough. */
export const LAKEHOUSE_POLL_MS = 30_000;

/** Telemetry older than this many seconds is shown as stale. */
export const STALE_AFTER_S = 60;

/** The same for the Lakehouse route, whose values are normally 5 to 10 minutes old. */
export const LAKEHOUSE_STALE_AFTER_S = 20 * 60;

/** The wait before the next question, by the route of the last answer. */
export function pollDelay(route: 'eventhouse' | 'lakehouse' | 'sample' | undefined, failed: boolean): number {
  if (failed) return POLL_MS * 3;
  return route === 'lakehouse' ? LAKEHOUSE_POLL_MS : POLL_MS;
}

export type Freshness = 'loading' | 'live' | 'delayed' | 'stale' | 'silent' | 'sample' | 'error';

/** What the badge says about the values on the page. */
export function freshnessOf(
  live: { source: string; route?: string; turbines: unknown[] } | null,
  ageS: number | null,
  failed: boolean
): Freshness {
  if (failed && !live) return 'error';
  if (!live) return 'loading';
  if (live.source === 'sample') return 'sample';
  if (live.turbines.length === 0) return 'silent';
  if (failed) return 'error';
  const lakehouse = live.route === 'lakehouse';
  if (ageS !== null && ageS > (lakehouse ? LAKEHOUSE_STALE_AFTER_S : STALE_AFTER_S)) return 'stale';
  return lakehouse ? 'delayed' : 'live';
}

/** An age in words: seconds up to two minutes, then minutes. */
export function ageText(ageS: number | null): string {
  if (ageS === null) return 'age unknown';
  return ageS > 120 ? `${Math.round(ageS / 60)} min` : `${ageS} s`;
}

/** True when the address of the page asks for the simulation: `?sample` or `?sample=1`. */
export function sampleRequested(search: string = window.location.search): boolean {
  const value = new URLSearchParams(search).get('sample');
  return value !== null && value !== '0' && value !== 'false';
}
