import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { LiveState } from '../overlay/packages/frontend/src/twin/data/contract';
import { sampleRequested } from '../overlay/packages/frontend/src/twin/data/provider';
import { createSampleProvider } from '../overlay/packages/frontend/src/twin/data/sampleProvider';
import { ALARM_VIBRATION, SITE, gearboxLevel, groundAt, powerCurve } from '../overlay/packages/frontend/src/twin/data/site';
import { VERTICAL_SCALE, elevationAt, heightAt } from '../overlay/packages/frontend/src/twin/scene/terrain';
import { downwind, yawFor } from '../overlay/packages/frontend/src/twin/scene/turbine';

const here = new URL('.', import.meta.url).pathname;

describe('the contract', () => {
  it('is the same file in the frontend and in the functions', () => {
    const frontend = readFileSync(`${here}../overlay/packages/frontend/src/twin/data/contract.ts`, 'utf8');
    const functions = readFileSync(`${here}../overlay/packages/functions/src/contract.ts`, 'utf8');
    expect(frontend).toBe(functions);
    expect(frontend).not.toMatch(/^import /m);
  });
});

describe('the site data', () => {
  it('holds twelve turbines of the model, three places and the roads', () => {
    expect(SITE.turbines.map((t) => t.id)).toEqual(Array.from({ length: 12 }, (_, i) => `WT-${String(i + 1).padStart(2, '0')}`));
    expect(SITE.infrastructure.map((p) => p.type).sort()).toEqual(['Building', 'MetMast', 'Substation']);
    expect(SITE.roads.length).toBeGreaterThan(10);
    expect(SITE.turbineModel.ratedPowerKw * SITE.turbines.length).toBeCloseTo(SITE.site.capacityMw * 1000, 0);
  });

  it('puts every turbine on the ground of the heightmap', () => {
    for (const t of SITE.turbines) expect(Math.abs(groundAt(t.x, t.y) - t.elevationM)).toBeLessThan(1);
  });

  it('has a power curve from cut-in to rated power', () => {
    const m = SITE.turbineModel;
    expect(powerCurve(m.cutInWindSpeed - 0.1)).toBe(0);
    expect(powerCurve(m.ratedWindSpeed)).toBe(m.ratedPowerKw);
    expect(powerCurve(m.cutOutWindSpeed)).toBe(0);
    expect(powerCurve(8)).toBeGreaterThan(powerCurve(7));
  });

  it('grades the gearbox by the thresholds of the operations agent', () => {
    expect(gearboxLevel(2.0, 60)).toBe(0);
    expect(gearboxLevel(4.0, 60)).toBe(1);
    expect(gearboxLevel(2.0, 72)).toBe(1);
    expect(gearboxLevel(5.5, 60)).toBe(2);
  });
});

describe('the ground', () => {
  it('is level around a turbine and at the height of its base', () => {
    for (const t of SITE.turbines) {
      const base = heightAt(t.x, t.y);
      expect(base).toBeCloseTo((groundAt(t.x, t.y) - SITE.terrain.minElevationM) * VERTICAL_SCALE, 5);
      for (const [dx, dy] of [[25, 0], [0, -25], [-18, 18]]) expect(Math.abs(heightAt(t.x + dx, t.y + dy) - base)).toBeLessThan(0.01);
    }
  });

  it('joins the site to the country around it without a step', () => {
    const half = SITE.terrain.sizeM / 2;
    for (const y of [-2000, 0, 1500]) expect(Math.abs(elevationAt(half + 1, y) - elevationAt(half - 1, y))).toBeLessThan(1.5);
  });
});

describe('directions', () => {
  it('turns a nacelle to face the wind', () => {
    // A nacelle looks along +z of its group. Turned for wind from the north it must look north, which is -z.
    const facing = (deg: number) => ({ x: Math.sin(yawFor(deg)), z: Math.cos(yawFor(deg)) });
    expect(facing(0).z).toBeCloseTo(-1);
    expect(facing(90).x).toBeCloseTo(1);
    expect(facing(180).z).toBeCloseTo(1);
  });

  it('blows the streaks away from where the wind comes from', () => {
    expect(downwind(0).z).toBeCloseTo(1); // from the north, to the south
    expect(downwind(270).x).toBeCloseTo(1); // from the west, to the east
  });
});

describe('the sample data', () => {
  const start = Date.UTC(2026, 10, 21, 18, 0, 0);

  it('gives twelve running turbines with plausible values, the same for the same time', async () => {
    const a = await createSampleProvider(() => start).getLiveState();
    const b = await createSampleProvider(() => start).getLiveState();
    expect(a).toEqual(b);
    expect(a.source).toBe('sample');
    expect(a.turbines).toHaveLength(12);
    for (const t of a.turbines) {
      expect(t.activePower).toBeGreaterThanOrEqual(0);
      expect(t.activePower).toBeLessThanOrEqual(SITE.turbineModel.ratedPowerKw * 1.03);
      expect(t.rotorSpeed).toBeLessThanOrEqual(SITE.turbineModel.ratedRotorRpm);
      expect(t.gearboxVibration).toBeLessThan(ALARM_VIBRATION);
    }
    expect(a.alarms).toEqual([]);
  });

  it('shows the three standing conditions', async () => {
    const state = await createSampleProvider(() => start).getLiveState();
    const by = (id: string) => state.turbines.find((t) => t.id === id)!;
    expect(by('WT-05').yawError).toBeGreaterThan(6);
    expect(by('WT-07').gearboxVibration - by('WT-06').gearboxVibration).toBeGreaterThan(0.5);
    expect(Math.abs(by('WT-05').windDirection - by('WT-05').nacelleDirection)).toBeGreaterThan(6);
  });

  it('runs a gearbox fault through derating, the trip and the restart', async () => {
    let now = start;
    const provider = createSampleProvider(() => now);
    provider.injectFault?.('WT-03');
    const at = async (seconds: number): Promise<LiveState> => {
      now = start + seconds * 1000;
      return provider.getLiveState();
    };
    const turbine = (s: LiveState) => s.turbines.find((t) => t.id === 'WT-03')!;

    const building = await at(120);
    expect(turbine(building).state).toBe('DERATED');
    expect(turbine(building).gearboxVibration).toBeGreaterThan(ALARM_VIBRATION);
    expect(building.alarms.map((a) => a.code)).toContain('GBX-VIB');
    expect(building.alarms.every((a) => a.turbineId === 'WT-03')).toBe(true);

    const tripped = await at(170);
    expect(turbine(tripped).state).toBe('FAULT');
    expect(turbine(tripped).activePower).toBe(0);
    expect(turbine(tripped).rotorSpeed).toBe(0);

    const over = await at(320);
    expect(turbine(over).state).toBe('RUNNING');
    expect(over.alarms).toEqual([]);
    expect(over.turbines.filter((t) => t.state !== 'RUNNING')).toEqual([]);
  });

  it('gives a trend of one point a minute', async () => {
    const trend = await createSampleProvider(() => start).getTrend('WT-07', 60);
    expect(trend).toHaveLength(61);
    expect(new Date(trend[1].t).getTime() - new Date(trend[0].t).getTime()).toBe(60000);
    expect(await createSampleProvider(() => start).getTrend('WT-99', 60)).toEqual([]);
  });
});

describe('the sample switch', () => {
  it('reads ?sample from the address', () => {
    expect(sampleRequested('?sample')).toBe(true);
    expect(sampleRequested('?sample=1')).toBe(true);
    expect(sampleRequested('?sample=0')).toBe(false);
    expect(sampleRequested('')).toBe(false);
  });
});
