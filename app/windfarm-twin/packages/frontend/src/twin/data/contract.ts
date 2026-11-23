/**
 * What the functions of the wind farm twin return to the browser.
 *
 * Every function returns one of these shapes as JSON text. This file exists twice, word for word:
 * as `packages/functions/src/contract.ts` and as `packages/frontend/src/twin/data/contract.ts`. A test
 * compares the two. Types only: it must not import anything.
 */

export type TurbineState =
  | 'RUNNING'
  | 'DERATED'
  | 'CURTAILED'
  | 'IDLE'
  | 'PAUSED'
  | 'STOPPED'
  | 'STOPPED_HIGH_WIND'
  | 'MAINTENANCE'
  | 'FAULT'
  | 'UNKNOWN';

/** The latest telemetry row of one turbine. Units as in the table TurbineTelemetry. */
export interface TurbineLive {
  id: string;
  timestamp: string;
  state: TurbineState;
  windSpeed: number;
  windDirection: number;
  ambientTemp: number;
  activePower: number;
  powerSetpoint: number;
  rotorSpeed: number;
  pitchAngle: number;
  nacelleDirection: number;
  yawError: number;
  gearboxOilTemp: number;
  gearboxBearingTemp: number;
  gearboxOilPressure: number;
  gearboxVibration: number;
  generatorWindingTemp: number;
  generatorBearingTemp: number;
  mainBearingTemp: number;
  transformerTemp: number;
  hydraulicPressure: number;
  towerVibration: number;
}

/** An alarm that was raised and has not cleared. */
export interface Alarm {
  id: string;
  turbineId: string;
  code: string;
  severity: string;
  component: string;
  description: string;
  raisedAt: string;
  value: number | null;
  threshold: number | null;
  unit: string;
  sopId: string;
}

/** The latest observation of the met mast. */
export interface Weather {
  timestamp: string;
  windSpeed: number;
  windDirection: number;
  windGust: number;
  ambientTemp: number;
  airDensity: number;
}

export interface LiveState {
  /** Where the values come from: Fabric, or the simulation built into the app. */
  source: 'fabric' | 'sample';
  /**
   * The way the values took. `eventhouse`: read from the KQL database as a service principal, seconds
   * old. `lakehouse`: read from the copies of the same tables in the Lakehouse, minutes old.
   */
  route: 'eventhouse' | 'lakehouse' | 'sample';
  /** Time of the newest telemetry row, ISO 8601, UTC. */
  asOf: string;
  turbines: TurbineLive[];
  alarms: Alarm[];
  weather: Weather | null;
}

/** One minute of one turbine: averages. */
export interface TrendPoint {
  t: string;
  activePower: number;
  windSpeed: number;
  rotorSpeed: number;
  gearboxOilTemp: number;
  gearboxBearingTemp: number;
  gearboxVibration: number;
}

export interface AgentAnswer {
  text: string;
  /** Seconds the data agent took. */
  seconds: number;
}

/** One line of the connection check. `detail` never holds a token or a secret. */
export interface DiagnosticStep {
  step: string;
  ok: boolean;
  /** True for a step that was left out on purpose, such as a route that is not set up. */
  skipped?: boolean;
  detail: string;
}

/**
 * What a function returns in place of its result when it could not do its work. The functions host
 * reports a function that throws as "InternalError" without the reason, so the reason travels here.
 */
export interface Failure {
  error: string;
}
