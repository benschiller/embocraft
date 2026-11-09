import type { Block, Edit } from '@voxel/shared';

/** Committed edit as seen by viewers (same shape as the room's `edit` broadcast). */
export type ViewerEdit = Omit<Edit, 'revision'> & { revision: number };

/** Full world state for a newly connected viewer (same shape as the room `snapshot`). */
export type ViewerSnapshot = { revision: number; blocks: Block[] };

type Listener = (edit: ViewerEdit) => void;

/** Default cap on concurrent read-only viewers per world. */
export const MAX_VIEWERS = 50;

/**
 * Read-only fan-out of committed block edits to spectators (Floperati). Viewers
 * never join the Colyseus room, so they take no player slot and have no input
 * path: the hub only exposes subscribe and publish, and the room is the only
 * publisher.
 */
export class ViewerHub {
  private listeners = new Set<Listener>();

  constructor(readonly max = MAX_VIEWERS) {}

  get size() {
    return this.listeners.size;
  }

  /** Returns an unsubscribe function, or undefined when the cap is reached. */
  subscribe(listener: Listener): (() => void) | undefined {
    if (this.listeners.size >= this.max) return undefined;
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(edit: ViewerEdit) {
    for (const listener of this.listeners) {
      try {
        listener(edit);
      } catch {
        // A failing viewer must never affect the room or other viewers.
        this.listeners.delete(listener);
      }
    }
  }

  clear() {
    this.listeners.clear();
  }
}
