import cors from 'cors';
import express, { type Router } from 'express';
import { env } from '../../../core/config/env';
import { createOriginGuard } from '../../../core/http/middleware/origin-guard';
import { getActiveWorld } from '../world.room';

/** 创建独立的世界路由 Router 实例 */
export function createWorldRouter(): Router {
  const router = express.Router();
  const allowed = env.webOrigin();

  /**
   * @openapi
   * /world:
   *   get:
   *     summary: 获取当前世界房间 ID
   *     description: 获取 Colyseus 当前活动的 WorldRoom 实例房间 ID
   *     tags:
   *       - World
   *     responses:
   *       200:
   *         description: 返回世界房间信息
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 roomId:
   *                   type: string
   *                   example: 4xK9pL2
   */
  router.get('/world', (_req, res) =>
    res.json({ roomId: getActiveWorld()?.roomId ?? '' }),
  );

  /**
   * @openapi
   * /world/presence:
   *   get:
   *     summary: 世界状态 SSE 长连接
   *     description: 监听世界的在线玩家与在线状态 (Server-Sent Events)
   *     tags:
   *       - World
   *     responses:
   *       200:
   *         description: 实时 SSE 事件流
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       403:
   *         description: Origin 不受信任
   *       503:
   *         description: 世界服务未就绪
   */
  router.get(
    '/world/presence',
    createOriginGuard({ origin: allowed, required: false }),
    cors({ origin: true }),
    (_req, res) => {
      const read = () => getActiveWorld()?.getPresence();
      if (!read()) {
        res.sendStatus(503);
        return;
      }
      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      const send = () => {
        const state = read();
        if (!state) {
          res.end();
          return;
        }
        // A heartbeat on every tick also detects loss of the world service.
        if (!res.writableNeedDrain)
          res.write(`data: ${JSON.stringify(state)}\n\n`);
      };
      const interval = setInterval(send, 1000);
      res.on('close', () => clearInterval(interval));
      send();
    },
  );

  /**
   * @openapi
   * /world/view:
   *   get:
   *     summary: Read-only spectator stream (SSE)
   *     description: >-
   *       Watch the world without joining it: no player slot, no input. Sends
   *       `snapshot` (revision + all blocks) on connect, `edit` for every
   *       committed block edit, and `presence` (players and positions) every second.
   *     tags:
   *       - World
   *     responses:
   *       200:
   *         description: SSE events snapshot, edit and presence
   *         content:
   *           text/event-stream:
   *             schema:
   *               type: string
   *       403:
   *         description: Origin not trusted
   *       503:
   *         description: World not ready, or the viewer limit is reached
   */
  router.get(
    '/world/view',
    createOriginGuard({ origin: allowed, required: false }),
    cors({ origin: true }),
    (_req, res) => {
      const world = getActiveWorld();
      if (!world) {
        res.sendStatus(503);
        return;
      }
      const write = (event: string, data: unknown) =>
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // Subscribe and snapshot in the same synchronous step so no edit is missed.
      const unsubscribe = world.viewers.subscribe((edit) =>
        write('edit', edit),
      );
      if (!unsubscribe) {
        res.sendStatus(503);
        return;
      }
      res.status(200).set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      write('snapshot', world.viewerSnapshot());
      const presence = () => {
        const state = getActiveWorld()?.getPresence();
        if (!state) {
          res.end();
          return;
        }
        // Doubles as the heartbeat; skip a tick rather than queue under backpressure.
        if (!res.writableNeedDrain) write('presence', state);
      };
      const interval = setInterval(presence, 1000);
      res.on('close', () => {
        clearInterval(interval);
        unsubscribe();
      });
      presence();
    },
  );

  return router;
}
