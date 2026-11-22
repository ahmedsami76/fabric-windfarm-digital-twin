/**
 * The React side of the 3D scene: makes one `SceneEngine` for the life of the component and passes
 * it the live values and the selection.
 */
import { type RefObject, useEffect, useRef } from 'react';

import type { LiveState } from './data/contract';
import { SceneEngine } from './scene/SceneEngine';

interface TwinViewProps {
  live: LiveState | null;
  selected: string | null;
  onSelect: (turbineId: string | null) => void;
  /** Receives the engine, so that the page can ask for the overview camera. */
  engineRef: RefObject<SceneEngine | null>;
}

export function TwinView({ live, selected, onSelect, engineRef }: TwinViewProps) {
  const host = useRef<HTMLDivElement>(null);
  // The engine lives longer than one render: it calls whatever `onSelect` is current.
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });

  useEffect(() => {
    if (!host.current) return undefined;
    const engine = new SceneEngine(host.current, { onSelect: (id) => select.current(id) });
    engineRef.current = engine;
    // For looking at the scene from the browser console and from the screenshot script.
    (window as unknown as { __twin?: SceneEngine }).__twin = engine;
    return () => {
      engineRef.current = null;
      engine.dispose();
    };
  }, [engineRef]);

  useEffect(() => {
    if (live) engineRef.current?.update(live);
  }, [live, engineRef]);

  useEffect(() => {
    engineRef.current?.select(selected);
  }, [selected, engineRef]);

  return <div ref={host} className="twin-view" />;
}
