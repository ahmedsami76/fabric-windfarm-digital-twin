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
  gearboxVibration: number;
  generatorWindingTemp: number;
  mainBearingTemp: number;
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
  /** Where the values come from: the KQL database, or the simulation built into the app. */
  source: 'fabric' | 'sample';
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

/** One line of the connection check. `detail` never holds a token. */
export interface DiagnosticStep {
  step: string;
  ok: boolean;
  detail: string;
}
