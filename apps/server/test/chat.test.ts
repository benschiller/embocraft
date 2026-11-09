import { executeAction, type Observation } from '@voxel/agent-runtime';
import { parseChatRoute, type Player } from '@voxel/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { visibleEvent, WorldChat } from '../src/modules/chat';

const player = (id: string): Player => ({
  id,
  name: id,
  kind: 'human',
  connected: true,
  x: 0,
  y: 2,
  z: 0,
  yaw: 0,
});
const event = (actor: string, scope: string, recipients: string[] = []) => ({
  seq: 1,
  type: 'chat',
  actor,
  data: { name: actor, text: 'secret', scope, recipients, kind: 'text' },
  at: 0,
});
afterEach(() => vi.restoreAllMocks());
describe('private chat', () => {
  it('resolves exact typed public mentions and avoids ambiguous names and name prefixes', () => {
    const people = [
      player('sender'),
      { ...player('ai'), name: 'AI 探索者' },
      { ...player('a'), name: '同名' },
      { ...player('b'), name: '同名' },
    ];
    const emit = vi.fn(),
      chat = new WorldChat(() => people, emit);
    chat.send('sender', { text: '@AI 探索者 换个地方？ @同名 hi' });
    expect(emit.mock.calls[0][1].recipients).toEqual(['ai']);
    const second = new WorldChat(() => people, emit);
    second.send('sender', { text: '@AI 探索者2 hi' });
    expect(emit.mock.calls[1][1].recipients).toEqual([]);
  });
  it('rejects empty, duplicate and malformed private recipients', () => {
    expect(parseChatRoute({ text: 'hi' })).toEqual({
      scope: 'public',
      recipients: [],
    });
    for (const recipients of [
      [],
      ['x', 'x'],
      ['../x'],
      Array(9).fill('x'),
      [2],
    ])
      expect(() => parseChatRoute({ scope: 'private', recipients })).toThrow();
  });
  it('restricts live/history visibility to sender and recipients including agents', () => {
    const e = event('a', 'private', ['b', 'ai']);
    for (const id of ['a', 'b', 'ai']) expect(visibleEvent(e, id)).toBe(true);
    expect(visibleEvent(e, 'outsider')).toBe(false);
    expect(visibleEvent(event('a', 'public'), 'outsider')).toBe(true);
  });
  it('validates recipients and rotates session credentials', () => {
    const people = [player('a'), player('b'), player('outsider')],
      emit = vi.fn(),
      chat = new WorldChat(() => people, emit);
    const old = chat.issue('a'),
      token = chat.issue('a');
    expect(() => chat.authenticate(old)).toThrow();
    expect(chat.authenticate(token)).toBe('a');
    expect(() =>
      chat.send('a', {
        text: 'secret',
        scope: 'private',
        recipients: ['missing'],
      }),
    ).toThrow();
    expect(emit).not.toHaveBeenCalled();
    chat.send('a', { text: 'secret', scope: 'private', recipients: ['b'] });
    expect(emit.mock.calls[0][1].scope).toBe('private');
    people[0].connected = false;
    expect(() => chat.authenticate(token)).toThrow();
    chat.clear();
  });
  it('forces replies to private messages to stay private', async () => {
    const observation: Observation = {
      id: 'x',
      revision: 0,
      self: player('ai'),
      players: [],
      blocks: [],
      events: [event('a', 'private', ['ai'])],
      radius: 8,
      allowedActions: [],
    };
    const request = vi.fn().mockResolvedValue({ ok: true });
    await executeAction(
      { request, move: vi.fn() },
      { type: 'chat', text: 'reply', scope: 'public', recipients: [] },
      observation,
      { move: true, chat: true, place: false, remove: false },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith('chat', {
      text: 'reply',
      scope: 'private',
      recipients: ['a'],
    });
  });
});
describe('nearby replies', () => {
  it('keeps nearby replies scoped to their sender', async () => {
    const observation: Observation = {
      id: 'x',
      revision: 0,
      self: player('ai'),
      players: [],
      blocks: [],
      events: [event('s', 'nearby', ['ai'])],
      radius: 8,
      allowedActions: [],
    };
    const request = vi.fn().mockResolvedValue({ ok: true });
    await executeAction(
      { request, move: vi.fn() },
      { type: 'chat', text: '我听到了' },
      observation,
      { move: true, chat: true, place: false, remove: false },
      new AbortController().signal,
    );
    expect(request).toHaveBeenCalledWith('chat', {
      text: '我听到了',
      scope: 'private',
      recipients: ['s'],
    });
  });
});
