import {
  key,
  type Block,
  type Player,
  type WorldPresence,
} from '@voxel/shared';
import { serverHttpUrl } from './endpoints';

/**
 * Read-only world feed for spectators (GET /world/view). Never joins the world
 * room, so it takes no player slot and has no way to send input.
 */
export class ViewerConnection {
  blocks = new Map<string, Block>();
  players: Player[] = [];
  revision = 0;
  status: 'connecting' | 'live' | 'reconnecting' = 'connecting';
  onBlocks = () => {};
  onChange = () => {};
  private stream?: EventSource;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setTimeout>;

  start() {
    if (this.stream) return;
    const stream = new EventSource(`${serverHttpUrl()}/world/view`);
    this.stream = stream;
    const alive = () => {
      clearTimeout(this.heartbeat);
      // Presence arrives every second; silence means the server went away.
      this.heartbeat = setTimeout(() => this.reconnect(stream), 5000);
    };
    alive();
    stream.addEventListener('snapshot', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as {
        revision: number;
        blocks: Block[];
      };
      this.blocks = new Map(data.blocks.map((b) => [key(b), b]));
      this.revision = data.revision;
      this.status = 'live';
      alive();
      this.onBlocks();
      this.onChange();
    });
    stream.addEventListener('edit', (event) => {
      const edit = JSON.parse((event as MessageEvent).data) as Block & {
        material: Block['material'] | null;
        revision: number;
      };
      if (edit.revision <= this.revision) return;
      if (edit.material === null) this.blocks.delete(key(edit));
      else
        this.blocks.set(key(edit), {
          x: edit.x,
          y: edit.y,
          z: edit.z,
          material: edit.material,
        });
      this.revision = edit.revision;
      alive();
      this.onBlocks();
    });
    stream.addEventListener('presence', (event) => {
      const data = JSON.parse((event as MessageEvent).data) as WorldPresence;
      this.players = data.players.filter((p) => p.connected);
      alive();
      this.onChange();
    });
    stream.onerror = () => this.reconnect(stream);
  }

  private reconnect(stream: EventSource) {
    if (this.stream !== stream) return;
    stream.close();
    this.stream = undefined;
    clearTimeout(this.heartbeat);
    this.status = 'reconnecting';
    this.onChange();
    clearTimeout(this.retry);
    this.retry = setTimeout(() => this.start(), 2000);
  }

  stop() {
    clearTimeout(this.retry);
    clearTimeout(this.heartbeat);
    this.stream?.close();
    this.stream = undefined;
  }
}
