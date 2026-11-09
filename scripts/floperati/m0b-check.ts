/**
 * M0b done check against a running world (default: Docker Compose through nginx).
 *   place  — join as a human, place one stone block next to spawn, print the cell
 *   verify — join again and confirm the block is still in the world snapshot
 * Usage: SERVER_URL=ws://localhost:8080 pnpm exec tsx scripts/floperati/m0b-check.ts place|verify
 */
import { Session } from '@voxel/agent-runtime';
import { key } from '@voxel/shared';

const mode = process.argv[2];
const url = process.env.SERVER_URL ?? 'ws://localhost:8080';
const cell = { x: 2, y: 3, z: 1 };

const session = await new Session(url).join(`M0b-${mode}`, 'human');
try {
  if (mode === 'place') {
    let o = await session.observe();
    const occupied = o.blocks.find((b) => key(b) === key(cell));
    if (occupied?.material === 'stone') {
      console.log(
        JSON.stringify({ placed: false, note: 'already stone', cell }),
      );
    } else {
      if (occupied) {
        const cleared = await session.request('edit', {
          ...cell,
          material: null,
          revision: o.revision,
        });
        if (!cleared.ok) throw Error(`clear failed: ${cleared.error}`);
        o = await session.observe();
      }
      const result = await session.request('edit', {
        ...cell,
        material: 'stone',
        revision: o.revision,
      });
      if (!result.ok) throw Error(`place failed: ${result.error}`);
      console.log(
        JSON.stringify({ placed: true, cell, revision: o.revision + 1 }),
      );
    }
  } else if (mode === 'verify') {
    const block = session.snapshot?.blocks.find((b) => key(b) === key(cell));
    const ok = block?.material === 'stone';
    console.log(
      JSON.stringify({
        survived: ok,
        cell,
        revision: session.snapshot?.revision,
      }),
    );
    if (!ok) process.exitCode = 1;
  } else {
    throw Error('usage: m0b-check.ts place|verify');
  }
} finally {
  await session.close();
}
