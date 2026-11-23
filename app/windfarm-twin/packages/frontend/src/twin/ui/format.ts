/** Small helpers the panels share for turning values into words. */

export const stateLabel = (state: string): string => state.replace(/_/g, ' ').toLowerCase();

export const clock = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
