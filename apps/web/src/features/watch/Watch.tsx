import { useEffect, useRef, useState } from 'react';
import { ViewerScene } from '../../graphics/viewer-scene';
import { ViewerConnection } from '../../network/viewer-connection';

/**
 * Read-only spectator page (/watch): no lobby, no player slot, no input.
 * Drag to orbit, scroll to zoom.
 */
export function Watch() {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState({
    state: 'connecting',
    players: 0,
    revision: 0,
  });
  useEffect(() => {
    const feed = new ViewerConnection();
    const scene = new ViewerScene(host.current!, feed);
    feed.onBlocks = scene.rebuild;
    feed.onChange = () =>
      setStatus({
        state: feed.status,
        players: feed.players.length,
        revision: feed.revision,
      });
    feed.start();
    return () => {
      feed.stop();
      scene.dispose();
    };
  }, []);
  return (
    <main
      style={{ position: 'fixed', inset: 0, background: '#c6e2e7' }}
      aria-label="Watching the world (read-only)"
    >
      <div ref={host} style={{ position: 'absolute', inset: 0 }} />
      <div
        role="status"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.85)',
          font: '600 13px system-ui, sans-serif',
          color: '#24342b',
        }}
      >
        Watching · read-only · {status.players} in world · rev {status.revision}{' '}
        · {status.state}
      </div>
      <div
        aria-label="Viewer controls"
        style={{
          position: 'absolute',
          bottom: 16,
          left: 16,
          padding: '8px 12px',
          borderRadius: 8,
          background: 'rgba(255,255,255,0.85)',
          font: '500 12px/1.6 system-ui, sans-serif',
          color: '#24342b',
        }}
      >
        <b>Move</b> W A S D / arrows · <b>Up/down</b> E / Q · <b>Faster</b>{' '}
        Shift
        <br />
        <b>Rotate</b> drag · <b>Pan</b> right-drag · <b>Zoom</b> scroll
      </div>
    </main>
  );
}
