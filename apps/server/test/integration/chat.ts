import { delay, Session, until } from '@voxel/agent-runtime';
import type { ChatData } from '@voxel/shared';
import assert from 'node:assert/strict';
import { createTestServer } from '../helpers/test-server';

process.env.DATABASE_URL = '';
process.env.WEB_ORIGIN = 'http://127.0.0.1:5187';
const server = await createTestServer({ origin: process.env.WEB_ORIGIN });
const sessions: Session[] = [];
try {
  const room = server.world;
  const url = server.httpUrl;
  for (const [name, kind] of [
    ['Sender', 'human'],
    ['Receiver', 'human'],
    ['AI', 'ai-agent'],
    ['Outsider', 'human'],
  ]) {
    const s = new Session(url.replace('http', 'ws'));
    sessions.push(s);
    await s.join(name, kind);
  }
  const [a, b, ai, out] = sessions,
    ids = sessions.map((s) => s.room.sessionId);
  await until(() => sessions.every((s) => !!s.chatToken));
  assert((await a.request('chat', { text: 'public hello' })).ok);
  await until(() =>
    sessions.every((s) => s.events.some((e) => e.type === 'chat')),
  );
  await delay(310);
  const secret = 'only recipients can see';
  assert(
    (
      await a.request('chat', {
        text: secret,
        scope: 'private',
        recipients: [ids[1], ids[2]],
      })
    ).ok,
  );
  await until(() =>
    ai.events.some((e) => (e.data as Partial<ChatData>).text === secret),
  );
  await delay(100);
  assert(
    !out.events.some((e) => (e.data as Partial<ChatData>).text === secret),
  );
  for (const s of [a, b, ai])
    assert(
      (await s.observe()).events.some(
        (e) => (e.data as Partial<ChatData>).text === secret,
      ),
    );
  assert(
    !(await out.observe()).events.some(
      (e) => (e.data as Partial<ChatData>).text === secret,
    ),
  );
  assert(
    !(
      await a.request('chat', {
        text: 'invalid',
        scope: 'private',
        recipients: ['offline'],
      })
    ).ok,
  );
  // Voice actions were removed with the voice stack; the room rejects them.
  assert(
    !(await a.request('spatial.state', { sending: true, listening: false })).ok,
  );
  assert(!(await ai.request('agent.voice', { enabled: true })).ok);
  const oldToken = b.chatToken;
  await b.reconnect();
  assert.notEqual(oldToken, b.chatToken);
  assert.throws(() => room.chat.authenticate(oldToken));
  a.room.send('action', {
    id: 'yaw',
    type: 'move',
    payload: { x: 0, z: 0, jump: false, yaw: 1.2 },
  });
  await delay(450);
  assert(Math.abs(room.state.players.get(ids[0])!.yaw - 1.2) < 0.001);
  const token = a.chatToken;
  await a.close();
  await until(() => !room.state.players.has(ids[0]));
  assert.throws(() => room.chat.authenticate(token));
  console.log(
    'PASS: four real WebSocket clients, public/private events and agent observation isolation, voice actions rejected, token rotation/revocation, idle yaw.',
  );
} finally {
  await Promise.all(sessions.map((s) => s.close()));
  await server.close();
}
