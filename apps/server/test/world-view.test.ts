import { Session, until } from '@voxel/agent-runtime';
import type { WorldPresence } from '@voxel/shared';
import { describe, expect, it } from 'vitest';
import type {
  ViewerEdit,
  ViewerSnapshot,
} from '../src/modules/world/services/viewer-hub';
import { MAX_VIEWERS } from '../src/modules/world/services/viewer-hub';
import { createTestServer } from './helpers/test-server';

type ViewerEvent =
  | { event: 'snapshot'; data: ViewerSnapshot }
  | { event: 'edit'; data: ViewerEdit }
  | { event: 'presence'; data: WorldPresence };

/** Minimal SSE reader: collects named events from a streaming fetch response. */
function readEvents(response: Response) {
  const events: ViewerEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({
        value: undefined,
        done: true,
      }));
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(frame)?.[1];
        const data = /^data: (.+)$/m.exec(frame)?.[1];
        if (event && data)
          events.push({ event, data: JSON.parse(data) } as ViewerEvent);
      }
    }
  })();
  return events;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)(
  'read-only viewer stream (Floperati)',
  () => {
    it('streams snapshot, live edits and presence without taking a player slot', async () => {
      const server = await createTestServer();
      const controller = new AbortController();
      let human: Session | undefined;
      try {
        const response = await fetch(`${server.httpUrl}/world/view`, {
          signal: controller.signal,
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain(
          'text/event-stream',
        );
        const events = readEvents(response);
        await until(() => events.some((e) => e.event === 'presence'));
        const snapshot = events.find((e) => e.event === 'snapshot');
        expect(events[0].event).toBe('snapshot');
        expect(snapshot!.data.blocks.length).toBeGreaterThan(1000);
        expect(server.world.viewers.size).toBe(1);
        expect(server.world.clients.length).toBe(0);

        human = await new Session(server.url).join('Viewer-Test', 'human');
        await until(() =>
          events.some(
            (e) => e.event === 'presence' && e.data.players.length === 1,
          ),
        );
        // The viewer is not a player: the room only has the human.
        expect(server.world.state.players.size).toBe(1);

        const cell = { x: 2, y: 3, z: 1 };
        let o = await human.observe();
        if (
          o.blocks.some(
            (b) => b.x === cell.x && b.y === cell.y && b.z === cell.z,
          )
        ) {
          await human.request('edit', {
            ...cell,
            material: null,
            revision: o.revision,
          });
          o = await human.observe();
        }
        const placed = await human.request('edit', {
          ...cell,
          material: 'stone',
          revision: o.revision,
        });
        expect(placed.ok).toBe(true);
        await until(() =>
          events.some(
            (e) =>
              e.event === 'edit' &&
              e.data.revision === o.revision + 1 &&
              e.data.material === 'stone',
          ),
        );
        const edit = events.find(
          (e) => e.event === 'edit' && e.data.revision === o.revision + 1,
        );
        expect(edit!.data).toEqual({
          ...cell,
          material: 'stone',
          revision: o.revision + 1,
        });

        controller.abort();
        await until(() => server.world.viewers.size === 0);
      } finally {
        controller.abort();
        await human?.close();
        await server.close();
      }
    });

    it('refuses viewers past the cap with 503', async () => {
      const server = await createTestServer();
      const release: Array<() => void> = [];
      try {
        for (let i = 0; i < MAX_VIEWERS; i++)
          release.push(server.world.viewers.subscribe(() => {})!);
        const response = await fetch(`${server.httpUrl}/world/view`);
        expect(response.status).toBe(503);
        expect(server.world.viewers.size).toBe(MAX_VIEWERS);
      } finally {
        for (const off of release) off();
        await server.close();
      }
    });
  },
);
