import { useEffect, useRef, useState } from 'react';
import { ViewerScene, type SpectatorMode } from '../../graphics/viewer-scene';
import { ViewerConnection } from '../../network/viewer-connection';

const panel = {
  position: 'absolute',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.85)',
  color: '#24342b',
} as const;

function describe(mode: SpectatorMode) {
  if (mode.kind === 'follow') return `Following ${mode.name}`;
  if (mode.kind === 'overview') return 'Overview';
  return `Free camera · ${mode.speed} blocks/s`;
}

/**
 * Read-only spectator page (/watch): first-person spectator camera in the live
 * world. No lobby, no player slot, nothing is sent to the world.
 */
export function Watch() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState({
    state: 'connecting',
    players: 0,
    mode: 'Free camera',
  });
  useEffect(() => {
    const feed = new ViewerConnection();
    const scene = new ViewerScene(host.current!, feed);
    const update = () =>
      setStatus({
        state: feed.status,
        players: feed.players.length,
        mode: describe(scene.mode),
      });
    feed.onBlocks = scene.rebuild;
    feed.onChange = update;
    scene.onModeChange = update;
    feed.start();
    return () => {
      feed.stop();
      scene.dispose();
    };
  }, []);
  return (
    <main
      style={{ position: 'fixed', inset: 0, background: '#c6e2e7' }}
      aria-label="Spectating the world (read-only)"
    >
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div
        role="status"
        style={{
          ...panel,
          top: 16,
          left: 16,
          font: '600 13px system-ui, sans-serif',
        }}
      >
        Spectating · read-only · {status.mode} · {status.players} in world ·{' '}
        {status.state}
      </div>
      <div
        aria-label="Spectator controls"
        style={{
          ...panel,
          bottom: 16,
          left: 16,
          font: '500 12px/1.6 system-ui, sans-serif',
        }}
      >
        <b>Look</b> click, then move the mouse (Esc releases) · or drag
        <br />
        <b>Move</b> W A S D · <b>Up</b> Space · <b>Down</b> Shift · <b>Speed</b>{' '}
        scroll
        <br />
        <b>Follow player</b> Tab (Shift+Tab back) · <b>Overview</b> M ·{' '}
        <b>Free camera</b> any move key
      </div>
    </main>
  );
}
