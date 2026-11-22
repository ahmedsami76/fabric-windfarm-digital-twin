/**
 * The site as the twin draws it: turbines, buildings, roads and terrain, in metres in the site's own
 * frame (x to the east, y to the north). The data is `assets/site-data.ts`, which
 * `tools/build-twin-assets.py` of the repository makes from `data/reference`.
 */
import { SITE_DATA_JSON } from '../assets/site-data';

export interface SiteTurbine {
  id: string;
  name: string;
  x: number;
  y: number;
  elevationM: number;
  string: string;
}

export interface SitePlace {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  elevationM: number;
}

export interface SiteRoad {
  id: string;
  type: string;
  points: number[][];
}

export interface TurbineModel {
  model: string;
  ratedPowerKw: number;
  rotorDiameterM: number;
  hubHeightM: number;
  cutInWindSpeed: number;
  ratedWindSpeed: number;
  cutOutWindSpeed: number;
  ratedRotorRpm: number;
}

export interface Site {
  site: { id: string; name: string; operator: string; capacityMw: number; timezone: string; prevailingWindDirectionDeg: number };
  turbineModel: TurbineModel;
  turbines: SiteTurbine[];
  infrastructure: SitePlace[];
  roads: SiteRoad[];
  terrain: { grid: number; sizeM: number; minElevationM: number; maxElevationM: number; elevationsDm: number[][] };
}

export const SITE = JSON.parse(SITE_DATA_JSON) as Site;

/**
 * Thresholds on the gearbox signals. They are the ones the operations agent of Phase 3 watches
 * (`tools/agent_spec.py`): an early warning at 4.0 mm/s and 72 °C, the controller's alarm at 5.5 mm/s.
 */
export const EARLY_VIBRATION = 4.0;
export const ALARM_VIBRATION = 5.5;
export const EARLY_OIL_TEMP = 72.0;

/** Elevation in metres above sea level at a position, by bilinear interpolation of the grid. */
export function groundAt(x: number, y: number): number {
  const { grid, sizeM, elevationsDm } = SITE.terrain;
  const step = sizeM / (grid - 1);
  const col = Math.min(Math.max((x + sizeM / 2) / step, 0), grid - 1 - 1e-9);
  const row = Math.min(Math.max((y + sizeM / 2) / step, 0), grid - 1 - 1e-9);
  const c = Math.floor(col);
  const r = Math.floor(row);
  const fc = col - c;
  const fr = row - r;
  const south = elevationsDm[r][c] * (1 - fc) + elevationsDm[r][c + 1] * fc;
  const north = elevationsDm[r + 1][c] * (1 - fc) + elevationsDm[r + 1][c + 1] * fc;
  return (south * (1 - fr) + north * fr) / 10;
}

/** Power in kW the turbine model gives at a wind speed: a cubic rise from cut-in to rated power. */
export function powerCurve(windSpeed: number): number {
  const m = SITE.turbineModel;
  if (windSpeed < m.cutInWindSpeed || windSpeed >= m.cutOutWindSpeed) return 0;
  if (windSpeed >= m.ratedWindSpeed) return m.ratedPowerKw;
  const share = (windSpeed ** 3 - m.cutInWindSpeed ** 3) / (m.ratedWindSpeed ** 3 - m.cutInWindSpeed ** 3);
  return m.ratedPowerKw * share;
}

/** How serious the gearbox of a turbine looks: 0 healthy, 1 early warning, 2 at the alarm level. */
export function gearboxLevel(vibration: number, oilTemp: number): 0 | 1 | 2 {
  if (vibration >= ALARM_VIBRATION) return 2;
  if (vibration >= EARLY_VIBRATION || oilTemp >= EARLY_OIL_TEMP) return 1;
  return 0;
}
