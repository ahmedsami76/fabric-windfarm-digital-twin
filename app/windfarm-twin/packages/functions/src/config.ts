/**
 * Names of the Fabric items the twin reads. They are the names the deployment guides of Phases 1 and 3
 * create. The functions look the items up by name at run time, so no identifier is written down here.
 */
export const WORKSPACE_NAME = 'WindFarmDigitalTwin';
export const KQL_DATABASE_NAME = 'WindFarmEH';
export const DATA_AGENT_NAME = 'WindFarmDataAgent';

/** Fabric REST API. */
export const FABRIC_API = 'https://api.fabric.microsoft.com/v1';

/**
 * The resource a token must be issued for to query an Eventhouse. This string is also written
 * literally in the context annotations of `function_app.ts`: Rayfin reads it from there at deployment.
 */
export const KUSTO_AUDIENCE = 'https://kusto.kusto.windows.net';

/** How long the looked-up identifiers are kept in memory. */
export const LOOKUP_TTL_MS = 10 * 60 * 1000;

/** Telemetry older than this is not "live". */
export const LIVE_WINDOW = '10m';

/** Longest question and answer that pass through `askAgent`, in characters. */
export const MAX_QUESTION_CHARS = 1000;
export const MAX_ANSWER_CHARS = 20000;

/** The functions host stops an invocation after 240 seconds. Stay below it. */
export const AGENT_TIMEOUT_MS = 225_000;
export const KUSTO_TIMEOUT_MS = 20_000;
export const FABRIC_TIMEOUT_MS = 20_000;
