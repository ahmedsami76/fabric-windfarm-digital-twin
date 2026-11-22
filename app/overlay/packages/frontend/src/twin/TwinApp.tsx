/**
 * The wind farm twin: the 3D scene with its panels. It asks the provider for new values every five
 * seconds and gives them to the scene and the panels.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { TwinView } from './TwinView';
import type { LiveState } from './data/contract';
import { POLL_MS, STALE_AFTER_S, type TwinDataProvider } from './data/provider';
import { SITE } from './data/site';
import type { SceneEngine } from './scene/SceneEngine';
import './twin.css';
import { ChatPanel } from './ui/ChatPanel';
import { errorText } from './ui/format';
import { AlarmFeed, Diagnostics, FleetList, TurbinePanel } from './ui/panels';

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const compass = (degrees: number): string => COMPASS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

type Freshness = 'loading' | 'live' | 'stale' | 'silent' | 'sample' | 'error';

export function TwinApp({ provider }: { provider: TwinDataProvider }) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatRequest, setChatRequest] = useState<{ key: number; question: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const engine = useRef<SceneEngine | null>(null);
  const now = useNow(1000);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    const poll = async () => {
      let failed = false;
      try {
        const state = await provider.getLiveState();
        if (stop) return;
        setLive(state);
        setError(null);
      } catch (e) {
        if (stop) return;
        failed = true;
        setError(errorText(e));
      }
      timer = window.setTimeout(poll, failed ? POLL_MS * 3 : POLL_MS);
    };
    void poll();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [provider]);

  const kpi = useMemo(() => {
    const turbines = live?.turbines ?? [];
    const producing = turbines.filter((t) => t.activePower > 1).length;
    const powerMw = turbines.reduce((sum, t) => sum + t.activePower, 0) / 1000;
    const wind = live?.weather ?? (turbines.length ? { windSpeed: turbines.reduce((s, t) => s + t.windSpeed, 0) / turbines.length, windDirection: turbines[0].windDirection } : null);
    return { producing, powerMw, wind, reporting: turbines.length };
  }, [live]);

  const ageS = live?.asOf ? Math.max(0, Math.round((now - new Date(live.asOf).getTime()) / 1000)) : null;
  const freshness: Freshness = error && !live ? 'error' : !live ? 'loading' : live.source === 'sample' ? 'sample' : live.turbines.length === 0 ? 'silent' : error ? 'error' : ageS !== null && ageS > STALE_AFTER_S ? 'stale' : 'live';
  const badge: Record<Freshness, string> = {
    loading: 'Connecting…',
    live: `Live · ${ageS ?? 0} s ago`,
    stale: `Stale · last value ${ageS !== null && ageS > 120 ? `${Math.round(ageS / 60)} min` : `${ageS} s`} ago`,
    silent: 'No telemetry in the last 10 minutes',
    sample: 'Sample data',
    error: 'Not connected',
  };

  const selectedLive = live?.turbines.find((t) => t.id === selected);
  const ask = (question: string) => {
    setChatOpen(true);
    setChatRequest({ key: Date.now(), question });
  };

  return (
    <div className={selected ? 'twin-root has-selection' : 'twin-root'}>
      <TwinView live={live} selected={selected} onSelect={setSelected} engineRef={engine} />

      <header className="twin-panel twin-top">
        <div className="twin-title">
          <b>{SITE.site.name}</b>
          <span>
            {SITE.site.operator} · {SITE.turbines.length} × {(SITE.turbineModel.ratedPowerKw / 1000).toFixed(1)} MW
          </span>
        </div>
        <div className="twin-kpi">
          <span>Site power</span>
          <b>
            {live ? kpi.powerMw.toFixed(1) : '–'}
            <small>MW</small>
          </b>
          <i className="meter">
            <i style={{ width: `${Math.min(100, (kpi.powerMw / SITE.site.capacityMw) * 100)}%` }} />
          </i>
        </div>
        <div className="twin-kpi">
          <span>Wind at the met mast</span>
          <b>
            {kpi.wind ? kpi.wind.windSpeed.toFixed(1) : '–'}
            <small>m/s</small>
          </b>
          {kpi.wind ? (
            <em>
              <svg viewBox="-10 -10 20 20" width="14" height="14" style={{ transform: `rotate(${kpi.wind.windDirection + 180}deg)` }} aria-hidden="true">
                <path d="M0,-8 L5,6 L0,3 L-5,6 Z" fill="currentColor" />
              </svg>
              from {compass(kpi.wind.windDirection)}
            </em>
          ) : null}
        </div>
        <div className="twin-kpi">
          <span>Producing</span>
          <b>
            {live ? kpi.producing : '–'}
            <small>of {SITE.turbines.length}</small>
          </b>
        </div>
        <div className="twin-kpi">
          <span>Active alarms</span>
          <b className={live && live.alarms.length > 0 ? 'bad' : ''}>{live ? live.alarms.length : '–'}</b>
        </div>
        <div className="twin-spacer" />
        <button type="button" className={`twin-badge ${freshness}`} onClick={() => setChecking(true)} title="Open the connection check">
          <i />
          {badge[freshness]}
        </button>
        <button type="button" className="twin-button" onClick={() => { setSelected(null); engine.current?.overview(); }}>
          Whole site
        </button>
      </header>

      <FleetList live={live} selected={selected} onSelect={setSelected} />
      <AlarmFeed alarms={live?.alarms ?? []} onSelect={setSelected} />
      {selected ? (
        <TurbinePanel
          key={selected}
          turbineId={selected}
          turbine={selectedLive}
          alarms={(live?.alarms ?? []).filter((a) => a.turbineId === selected)}
          provider={provider}
          onClose={() => setSelected(null)}
          onAsk={ask}
        />
      ) : null}
      <ChatPanel provider={provider} request={chatRequest} open={chatOpen} onToggle={() => setChatOpen((o) => !o)} />

      {error && freshness === 'error' ? (
        <button type="button" className="twin-toast" onClick={() => setChecking(true)}>
          The live values could not be read: {error} <u>Open the connection check</u>
        </button>
      ) : null}
      {checking ? <Diagnostics provider={provider} lastError={error} onClose={() => setChecking(false)} /> : null}
    </div>
  );
}
