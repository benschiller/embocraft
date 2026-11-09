import { AppError } from '../../../core/errors/app-error';
import {
  CHAT_MIN_INTERVAL_MS,
  parseChatRoute,
  type ChatData,
  type Player,
} from '@voxel/shared';
import { ChatCredentials } from './credentials.service';
import type { ChatStore } from '../persistence/chat-store';

/** Room-facing chat API; each stateful concern owns its own lifecycle. */
export class WorldChat {
  private credentials: ChatCredentials;
  private sent = new Map<string, number>();

  constructor(
    private players: () => Iterable<Player>,
    private emit: (actor: string, data: ChatData) => void,
    private store?: ChatStore,
  ) {
    this.credentials = new ChatCredentials(players);
  }

  issue(id: string) {
    this.sent.delete(id);
    return this.credentials.issue(id);
  }

  revoke(id: string) {
    this.sent.delete(id);
    this.credentials.revoke(id);
  }

  authenticate(token: string) {
    return this.credentials.authenticate(token);
  }

  route(actor: string, value: unknown) {
    const route = parseChatRoute(value),
      players = [...this.players()];
    if (!players.some((p) => p.id === actor && p.connected))
      throw new AppError('你尚未连接世界。', 401);
    if (
      route.recipients.some(
        (id) =>
          id === actor || !players.some((p) => p.id === id && p.connected),
      )
    )
      throw new AppError('接收对象已离线或无效，请重新选择。');
    return route;
  }
  send(actor: string, value: unknown) {
    const route = this.route(actor, value),
      text = (value as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim() || text.length > 240)
      throw new AppError('消息需为 1–240 字。');
    // Resolve typed public mentions too. Duplicate nicknames require the picker.
    if (route.scope === 'public') {
      const players = [...this.players()].filter(
        (p) => p.connected && p.id !== actor,
      );
      for (const player of players) {
        if (players.filter((p) => p.name === player.name).length !== 1)
          continue;
        const escaped = player.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (
          new RegExp(
            `(?:^|\\s)@${escaped}(?=$|\\s|[，。！？、,:;!?])`,
            'u',
          ).test(text) &&
          !route.recipients.includes(player.id)
        )
          route.recipients.push(player.id);
      }
      if (route.recipients.length > 8)
        throw new AppError('接收对象最多选择 8 位。');
    }
    if (Date.now() - (this.sent.get(actor) ?? 0) < CHAT_MIN_INTERVAL_MS)
      throw new AppError('发送过快，请稍候。', 429);
    this.sent.set(actor, Date.now());
    const sender = [...this.players()].find((p) => p.id === actor);
    const senderName = sender?.name ?? '';
    this.emit(actor, {
      ...route,
      text: text.trim(),
      kind: 'text',
      name: senderName,
    });
    void this.store?.recordMessage({
      senderName,
      senderKind: sender?.kind as 'human' | 'ai-agent' | 'scripted-agent',
      scope: route.scope,
      kind: 'text',
      text: text.trim(),
      recipients: route.recipients
        .map((id) => [...this.players()].find((p) => p.id === id)?.name)
        .filter((n): n is string => !!n),
    });
  }
  clear() {
    this.credentials.clear();
    this.sent.clear();
  }
}
