import { Session, until } from '@voxel/agent-runtime';
import { WORLD_ID } from '@voxel/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../src/core/database/client';
import { bindEditAttribution } from '../src/modules/world';
import { createTestServer } from './helpers/test-server';

const url = process.env.TEST_DATABASE_URL;
const db = url ? createDatabaseClient(url) : undefined;

describe.skipIf(!url)('append-only block edit history (Floperati)', () => {
  afterAll(async () => db?.$disconnect());

  it('applies the block_edit_history migration with the expected columns', async () => {
    const applied = await db!.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT migration_name AS name FROM "_prisma_migrations"
       WHERE migration_name LIKE '%_block_edit_history' AND finished_at IS NOT NULL`,
    );
    expect(applied).toHaveLength(1);
    const columns = await db!.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_name = 'BlockEditHistory' ORDER BY column_name`,
    );
    expect(columns.map((c) => c.name).sort()).toEqual(
      [
        'id',
        'worldId',
        'revision',
        'x',
        'y',
        'z',
        'materialBefore',
        'materialAfter',
        'editorId',
        'editorName',
        'editorKind',
        'characterId',
        'runId',
        'createdAt',
      ].sort(),
    );
  });

  it('writes exactly one history row per committed edit and none for rejected edits', async () => {
    const server = await createTestServer();
    const sessions: Session[] = [];
    let release = () => {};
    try {
      const human = await new Session(server.url).join('Hist-Human', 'human');
      const agent = await new Session(server.url).join('Hist-Agent');
      sessions.push(human, agent);
      await until(() => human.room.state.players.size >= 2);
      // Stand in for the managed-character lookup the server wires at startup.
      release = bindEditAttribution((sessionId) =>
        sessionId === agent.room.sessionId
          ? { characterId: 'char-fixture', runId: 'run-fixture' }
          : undefined,
      );
      const rows = () =>
        db!.blockEditHistory.findMany({
          where: { worldId: WORLD_ID },
          orderBy: { id: 'asc' },
        });
      const cell = { x: 2, y: 3, z: 1 };
      let o = await human.observe();
      if (
        o.blocks.some((b) => b.x === cell.x && b.y === cell.y && b.z === cell.z)
      ) {
        expect(
          (
            await human.request('edit', {
              ...cell,
              material: null,
              revision: o.revision,
            })
          ).ok,
        ).toBe(true);
        o = await human.observe();
      }
      const before = (await rows()).length;

      const placed = await human.request('edit', {
        ...cell,
        material: 'wood',
        revision: o.revision,
      });
      expect(placed.ok).toBe(true);
      let history = await rows();
      expect(history).toHaveLength(before + 1);
      expect(history.at(-1)).toMatchObject({
        ...cell,
        revision: o.revision + 1,
        materialBefore: null,
        materialAfter: 'wood',
        editorId: human.room.sessionId,
        editorName: 'Hist-Human',
        editorKind: 'human',
        characterId: null,
        runId: null,
      });

      // A stale revision is rejected by the room and must not append history.
      const stale = await agent.request('edit', {
        ...cell,
        material: null,
        revision: o.revision,
      });
      expect(stale.error).toBe('conflict');
      expect(await rows()).toHaveLength(before + 1);

      o = await agent.observe();
      const removed = await agent.request('edit', {
        ...cell,
        material: null,
        revision: o.revision,
      });
      expect(removed.ok).toBe(true);
      history = await rows();
      expect(history).toHaveLength(before + 2);
      expect(history.at(-1)).toMatchObject({
        ...cell,
        materialBefore: 'wood',
        materialAfter: null,
        editorId: agent.room.sessionId,
        editorKind: 'agent',
        characterId: 'char-fixture',
        runId: 'run-fixture',
      });
      const current = await db!.blockEdit.findUnique({
        where: { worldId_x_y_z: { worldId: WORLD_ID, ...cell } },
      });
      expect(current?.material).toBeNull();
    } finally {
      release();
      await Promise.all(sessions.map((s) => s.close()));
      await server.close();
    }
  });
});
