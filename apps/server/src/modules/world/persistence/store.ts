import { env } from '../../../core/config/env';
import type { PrismaClient } from '@prisma/client';
import { createDatabaseClient } from '../../../core/database/client';
import {
  key,
  WORLD_ID,
  type Edit,
  type Block,
  type Material,
} from '@voxel/shared';

/** Who made an edit and what it replaced; recorded in the append-only history. */
export type EditAttribution = {
  /** World session id of the editor. */
  editorId: string;
  editorName?: string;
  editorKind: 'human' | 'agent';
  /** Managed AI character and its current task run, when the editor is one. */
  characterId?: string;
  runId?: string;
  /** Material at the cell before the edit (terrain included); null = empty. */
  materialBefore: Material | null;
};

export class WorldStore {
  readonly mode: 'postgresql' | 'memory';
  private readonly db?: PrismaClient;
  private readonly ownsDatabase: boolean;
  constructor(connectionString = env.databaseUrl(), db?: PrismaClient) {
    this.db =
      db ??
      (connectionString ? createDatabaseClient(connectionString) : undefined);
    this.ownsDatabase = !db;
    this.mode = this.db ? 'postgresql' : 'memory';
  }
  async load(blocks: Map<string, Block>) {
    if (!this.db) return 0;
    const world = await this.db.world.upsert({
      where: { id: WORLD_ID },
      create: { id: WORLD_ID },
      update: {},
      include: { edits: true },
    });
    for (const e of world.edits) {
      if (e.material === null) blocks.delete(key(e));
      else
        blocks.set(key(e), {
          x: e.x,
          y: e.y,
          z: e.z,
          material: e.material as Material,
        });
    }
    return world.revision;
  }
  async save(edit: Edit, by: EditAttribution) {
    if (!this.db) return;
    const editedBy = by.editorName ?? by.editorId;
    await this.db.$transaction(async (tx) => {
      const result = await tx.world.updateMany({
        where: { id: WORLD_ID, revision: edit.revision },
        data: { revision: { increment: 1 } },
      });
      if (result.count !== 1) throw new Error('storage-conflict');
      const { x, y, z, material } = edit;
      await tx.blockEdit.upsert({
        where: { worldId_x_y_z: { worldId: WORLD_ID, x, y, z } },
        create: { worldId: WORLD_ID, x, y, z, material, editedBy },
        update: { material, editedBy },
      });
      // Append-only: history rows are only ever created, never updated.
      await tx.blockEditHistory.create({
        data: {
          worldId: WORLD_ID,
          revision: edit.revision + 1,
          x,
          y,
          z,
          materialBefore: by.materialBefore,
          materialAfter: material,
          editorId: by.editorId,
          editorName: by.editorName ?? null,
          editorKind: by.editorKind,
          characterId: by.characterId ?? null,
          runId: by.runId ?? null,
        },
      });
    });
  }
  async close() {
    // Injected clients belong to the server and may still serve other stores.
    if (this.ownsDatabase) await this.db?.$disconnect();
  }
}
