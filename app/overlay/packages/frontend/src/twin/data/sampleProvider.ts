/**
 * A simulation of the wind farm that runs in the browser. It lets the twin be looked at without Fabric:
 * in the standalone preview, and in the deployed app with `?sample` in the address.
 *
 * It follows the edge simulator in what matters to the eye: one wind for the whole site, twelve
 * machines on one power curve, the three standing conditions (WT-05 yawed, WT-07 warm gearbox,
 * WT-09 eroded blades), and a gearbox fault that builds up, trips the turbine and clears. Its numbers
 * are invented and are not the numbers of the KQL database.
 */
import type { AgentAnswer, Alarm, DiagnosticStep, LiveState, TrendPoint, TurbineLive, TurbineState } from './contract';
import type { TwinDataProvider } from './provider';
import { ALARM_VIBRATION, SITE, powerCurve } from './site';

interface Fault {
  turbineId: string;
  startMs: number;
}

/** Seconds from the start of a fault to: full vibration, the trip, the restart, the end. */
const RAMP_S = 80;
const TRIP_S = 150;
const RESTART_S = 215;
const END_S = 300;

const wave = (t: number, period: number, phase: number): number => Math.sin((t / period) * 2 * Math.PI + phase);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function siteWind(tSec: number): { speed: number; direction: number } {
  const speed = 9.2 + 2.3 * wave(tSec, 1700, 0.4) + 1.0 * wave(tSec, 420, 2.1) + 0.3 * wave(tSec, 95, 5.0);
  const direction = SITE.site.prevailingWindDirectionDeg + 11 * wave(tSec, 2300, 1.3) + 4 * wave(tSec, 190, 0.2);
  return { speed: clamp(speed, 2.5, 20), direction: (direction + 360) % 360 };
}

function faultProgress(fault: Fault | undefined, nowMs: number): number {
  if (!fault) return -1;
  const s = (nowMs - fault.startMs) / 1000;
  return s >= 0 && s < END_S ? s : -1;
}

function turbineAt(index: number, nowMs: number, faults: Fault[]): TurbineLive {
  const spec = SITE.turbines[index];
  const model = SITE.turbineModel;
  const t = nowMs / 1000;
  const wind = siteWind(t);
  const local = wind.speed * (1 + 0.05 * Math.sin(index * 2.4)) + 0.35 * wave(t, 140 + index * 11, index * 1.7);
  const windSpeed = clamp(local, 0, 30);
  const windDirection = (wind.direction + 3 * wave(t, 61, index) + 360) % 360;

  const yawOffset = spec.id === 'WT-05' ? 9 : 0;
  const performance = spec.id === 'WT-05' ? 0.95 : spec.id === 'WT-09' ? 0.95 : 1;
  const s = faultProgress(faults.find((f) => f.turbineId === spec.id), nowMs);

  let state: TurbineState = windSpeed < model.cutInWindSpeed ? 'IDLE' : 'RUNNING';
  let derate = 1;
  let extraVibration = spec.id === 'WT-07' ? 0.9 : 0;
  let extraOil = spec.id === 'WT-07' ? 2.4 : 0;
  if (s >= 0) {
    const build = clamp(s / RAMP_S, 0, 1) * (s < RESTART_S ? 1 : clamp(1 - (s - RESTART_S) / (END_S - RESTART_S), 0, 1));
    extraVibration += 5.2 * build;
    extraOil += 26 * build;
    if (s >= TRIP_S && s < RESTART_S) state = 'FAULT';
    else if (1.6 + extraVibration >= ALARM_VIBRATION && state === 'RUNNING') {
      state = 'DERATED';
      derate = 0.6;
    }
  }

  const producing = state === 'RUNNING' || state === 'DERATED';
  const possible = powerCurve(windSpeed) * performance;
  const activePower = producing ? Math.max(0, possible * derate * (1 + 0.015 * wave(t, 9, index))) : 0;
  const load = activePower / model.ratedPowerKw;
  const rotorSpeed = producing ? model.ratedRotorRpm * clamp(0.42 + 0.58 * (windSpeed / model.ratedWindSpeed), 0.42, 1) * (derate < 1 ? 0.8 : 1) : 0;
  const pitchAngle = !producing ? 88 : windSpeed > model.ratedWindSpeed ? clamp((windSpeed - model.ratedWindSpeed) * 2.6, 0, 25) : 0.6;
  const ambientTemp = 19 + 5 * wave(t, 86400, -1.9);

  return {
    id: spec.id,
    timestamp: new Date(nowMs).toISOString(),
    state,
    windSpeed,
    windDirection,
    ambientTemp,
    activePower,
    powerSetpoint: model.ratedPowerKw * derate,
    rotorSpeed,
    pitchAngle,
    nacelleDirection: (windDirection - yawOffset + 360) % 360,
    yawError: yawOffset + 1.2 * wave(t, 40, index * 0.9),
    gearboxOilTemp: ambientTemp + 24 + 22 * load + extraOil + 0.4 * wave(t, 70, index),
    gearboxBearingTemp: ambientTemp + 28 + 25 * load + extraOil * 1.1 + 0.4 * wave(t, 83, index + 1),
    gearboxVibration: (producing ? 1.1 + 0.9 * load : 0.2) + extraVibration + 0.08 * wave(t, 13, index * 3),
    generatorWindingTemp: ambientTemp + 30 + 48 * load,
    mainBearingTemp: ambientTemp + 16 + 14 * load,
    towerVibration: 0.3 + 0.5 * load + 0.05 * wave(t, 17, index),
  };
}

function alarmsAt(turbines: TurbineLive[], nowMs: number, faults: Fault[]): Alarm[] {
  const alarms: Alarm[] = [];
  for (const turbine of turbines) {
    const fault = faults.find((f) => f.turbineId === turbine.id);
    const s = faultProgress(fault, nowMs);
    if (!fault || s < 0) continue;
    const raised = (afterS: number) => new Date(fault.startMs + afterS * 1000).toISOString();
    if (turbine.gearboxVibration >= ALARM_VIBRATION) {
      alarms.push({
        id: `${turbine.id}-GBX-VIB-${fault.startMs}`, turbineId: turbine.id, code: 'GBX-VIB', severity: 'critical',
        component: 'gearbox', description: 'Gearbox vibration high', raisedAt: raised(RAMP_S * 0.75),
        value: turbine.gearboxVibration, threshold: ALARM_VIBRATION, unit: 'mm/s', sopId: 'SOP-GBX-001',
      });
    }
    if (turbine.gearboxOilTemp >= 80) {
      alarms.push({
        id: `${turbine.id}-GBX-OIL-TEMP-${fault.startMs}`, turbineId: turbine.id, code: 'GBX-OIL-TEMP', severity: 'warning',
        component: 'gearbox', description: 'Gearbox oil temperature high', raisedAt: raised(RAMP_S * 0.9),
        value: turbine.gearboxOilTemp, threshold: 80, unit: '°C', sopId: 'SOP-GBX-001',
      });
    }
  }
  return alarms.sort((a, b) => (a.raisedAt < b.raisedAt ? 1 : -1));
}

export function createSampleProvider(clock: () => number = Date.now): TwinDataProvider {
  const faults: Fault[] = [];

  const stateAt = (nowMs: number): LiveState => {
    const turbines = SITE.turbines.map((_, i) => turbineAt(i, nowMs, faults));
    const wind = siteWind(nowMs / 1000);
    return {
      source: 'sample',
      asOf: new Date(nowMs).toISOString(),
      turbines,
      alarms: alarmsAt(turbines, nowMs, faults),
      weather: {
        timestamp: new Date(nowMs).toISOString(),
        windSpeed: wind.speed,
        windDirection: wind.direction,
        windGust: wind.speed * 1.25,
        ambientTemp: turbines[0]?.ambientTemp ?? 20,
        airDensity: 1.11,
      },
    };
  };

  return {
    kind: 'sample',
    getLiveState: async () => stateAt(clock()),
    getTrend: async (turbineId: string, minutes: number): Promise<TrendPoint[]> => {
      const index = SITE.turbines.findIndex((t) => t.id === turbineId);
      if (index < 0) return [];
      const end = Math.floor(clock() / 60000) * 60000;
      const points: TrendPoint[] = [];
      for (let m = Math.max(5, Math.min(360, minutes)); m >= 0; m--) {
        const at = end - m * 60000;
        const live = turbineAt(index, at, faults);
        points.push({
          t: new Date(at).toISOString(), activePower: live.activePower, windSpeed: live.windSpeed, rotorSpeed: live.rotorSpeed,
          gearboxOilTemp: live.gearboxOilTemp, gearboxBearingTemp: live.gearboxBearingTemp, gearboxVibration: live.gearboxVibration,
        });
      }
      return points;
    },
    ask: async (question: string): Promise<AgentAnswer> => {
      await new Promise((resolve) => setTimeout(resolve, 900));
      const now = stateAt(clock());
      const worst = [...now.turbines].sort((a, b) => b.gearboxVibration - a.gearboxVibration)[0];
      const power = now.turbines.reduce((sum, t) => sum + t.activePower, 0) / 1000;
      const text =
        'This is the sample mode of the twin: no data agent is connected, so I can only describe the simulated values on screen.\n\n' +
        `Right now the simulated site produces ${power.toFixed(1)} MW from ${now.turbines.filter((t) => t.activePower > 0).length} turbines. ` +
        `The highest gearbox vibration is on ${worst.id} with ${worst.gearboxVibration.toFixed(1)} mm/s.\n\n` +
        `Deployed in Fabric, this panel sends your question ("${question.slice(0, 120)}") to the data agent WindFarmDataAgent, which answers from the Lakehouse and the KQL database.`;
      return { text, seconds: 0.9 };
    },
    diagnostics: async (): Promise<DiagnosticStep[]> => [
      { step: 'Sample data', ok: true, detail: 'The values are simulated in the browser. Nothing is read from Fabric.' },
    ],
    injectFault: (turbineId: string) => {
      const now = clock();
      const running = faults.find((f) => f.turbineId === turbineId);
      if (running && faultProgress(running, now) >= 0) return;
      for (let i = faults.length - 1; i >= 0; i--) if (faults[i].turbineId === turbineId) faults.splice(i, 1);
      faults.push({ turbineId, startMs: now });
    },
  };
}
