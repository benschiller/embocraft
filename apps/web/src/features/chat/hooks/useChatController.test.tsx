// @vitest-environment jsdom
import { act } from 'react';

import { beforeEach, expect, it, vi } from 'vitest';

import type { ChatEntry } from '@voxel/shared';

import { Connection } from '../../../network/connection';

import { useChatController, type ChatController } from './useChatController';

import { installReactMount } from '../../../../test/helpers/react-mount';
const mount = installReactMount();
beforeEach(() => localStorage.clear());

it('keeps the draft across rerenders, counts unread messages and aborts sending on disconnect', async () => {
  const connection = new Connection();
  connection.status = 'connected';
  let controller!: ChatController;
  function Harness({ expanded }: { expanded: boolean }) {
    controller = useChatController(connection, expanded);
    return null;
  }
  await mount.render(<Harness expanded />);
  const abort = new AbortController();
  controller.upload.current = abort;
  await act(async () => {
    controller.setText('draft');
  });
  connection.chats = [{ seq: 5, actor: 'other' } as ChatEntry];
  await mount.render(<Harness expanded />);
  expect(controller.text).toBe('draft');
  await mount.render(<Harness expanded={false} />);
  expect(controller.unread).toBe(0);
  connection.chats = [
    ...connection.chats,
    { seq: 6, actor: 'other' } as ChatEntry,
  ];
  await mount.render(<Harness expanded={false} />);
  expect(controller.unread).toBe(1);
  connection.status = 'disconnected';
  await mount.render(<Harness expanded={false} />);
  expect(abort.signal.aborted).toBe(true);
  await mount.unmount();
});

it('sends text chat through the world connection and keeps private sends scoped', async () => {
  const connection = new Connection();
  connection.status = 'connected';
  const request = vi
    .spyOn(connection, 'requestAction')
    .mockResolvedValue(undefined);
  let controller!: ChatController;
  function Harness() {
    controller = useChatController(connection);
    return null;
  }
  await mount.render(<Harness />);
  await act(async () => controller.send('hello world'));
  expect(request).toHaveBeenCalledWith('chat', {
    text: 'hello world',
    scope: 'public',
    recipients: [],
  });
  await act(async () => controller.setScope('private'));
  await act(async () => controller.send('secret'));
  expect(controller.error).toContain('私聊对象');
  expect(request).toHaveBeenCalledTimes(1);
  await mount.unmount();
});
