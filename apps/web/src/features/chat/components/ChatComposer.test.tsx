// @vitest-environment jsdom
import { act } from 'react';
import type { Player } from '@voxel/shared';
import { beforeEach, expect, it, vi } from 'vitest';
import { installReactMount } from '../../../../test/helpers/react-mount';
import { Connection } from '../../../network/connection';
import { i18n } from '../../../i18n';
import {
  useChatController,
  type ChatController,
} from '../hooks/useChatController';
import { ChatComposer } from './ChatComposer';

const mount = installReactMount();
let controller: ChatController;
let connection: Connection;
const escaped = vi.fn();
const clicked = vi.fn();
function Harness() {
  controller = useChatController(connection);
  return (
    <div
      onClick={clicked}
      onKeyDown={(event) => {
        if (event.key === 'Escape') escaped();
      }}
    >
      <ChatComposer controller={controller} />
    </div>
  );
}
const button = (name: string) => {
  const result = [
    ...document.body.querySelectorAll<HTMLButtonElement>('button'),
  ].find(
    (el) => el.getAttribute('aria-label') === name || el.textContent === name,
  );
  expect(result, name).toBeDefined();
  return result!;
};
const click = async (name: string) => act(async () => button(name).click());
beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage('zh');
  connection = new Connection();
  connection.status = 'connected';
  escaped.mockClear();
  clicked.mockClear();
});

it('opens secondary actions, returns focus on Escape, and keeps recipient selection reachable', async () => {
  await mount.render(<Harness />);
  await click('更多聊天操作');
  expect(document.activeElement).toBe(button('选人'));
  await act(async () =>
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    ),
  );
  expect(escaped).not.toHaveBeenCalled();
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button('更多聊天操作')),
  );
  expect(document.body.textContent).not.toContain('发语音');
  await click('更多聊天操作');
  await click('选人');
  expect(controller.picker?.source).toBe('button');
  expect(document.activeElement?.getAttribute('aria-label')).toBe(
    '搜索玩家或 Agent',
  );
});

it('does not send during IME composition, an in-flight send or disconnection; private chat requires recipients', async () => {
  const send = vi
    .spyOn(connection, 'requestAction')
    .mockResolvedValue({ ok: true } as never);
  await mount.render(<Harness />);
  await act(async () => controller.setText('你好'));
  const input = mount.host.querySelector('input')!;
  const composing = new KeyboardEvent('keydown', {
    key: 'Enter',
    isComposing: true,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => input.dispatchEvent(composing));
  expect(composing.defaultPrevented).toBe(true);
  await act(async () => controller.setScope('private'));
  expect(button('发送消息').disabled).toBe(true);
  await act(async () => {
    controller.setScope('public');
    controller.setMode('sending');
  });
  await act(async () =>
    mount.host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(send).not.toHaveBeenCalled();
  await act(async () => controller.cancel());
  expect(document.activeElement?.getAttribute('aria-label')).toBe('聊天消息');
  connection.status = 'disconnected';
  await mount.render(<Harness />);
  expect(button('发送消息').disabled).toBe(true);
  await act(async () =>
    mount.host
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  expect(send).not.toHaveBeenCalled();
  connection.status = 'connected';
  await mount.render(<Harness />);
  await click('发送消息');
  expect(send).toHaveBeenCalledWith('chat', {
    text: '你好',
    scope: 'public',
    recipients: [],
  });
  expect(controller.status).toBe('');
});

it('closes the floating actions on an outside click, focus exit, and trigger toggle', async () => {
  await mount.render(<Harness />);
  await click('更多聊天操作');
  const floating = document.querySelector('.chat-more-actions')!;
  expect(mount.host.contains(floating)).toBe(false);
  expect(floating.hasAttribute('data-hud')).toBe(true);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  await act(async () => {
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }),
    );
    document.body.click();
  });
  expect(button('更多聊天操作').getAttribute('aria-expanded')).toBe('false');
  expect(document.querySelector('.chat-more-actions')).toBeNull();
  await click('更多聊天操作');
  const input = mount.host.querySelector('input')!;
  await act(async () => input.focus());
  expect(document.querySelector('.chat-more-actions')).toBeNull();
  expect(document.activeElement).toBe(input);
  await click('更多聊天操作');
  await click('更多聊天操作');
  expect(document.querySelector('.chat-more-actions')).toBeNull();
});

const typeMessage = async (value: string) =>
  act(async () => {
    const input = mount.host.querySelector<HTMLInputElement>(
      '.chat-composer-input',
    )!;
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.setSelectionRange(value.length, value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const key = async (value: string) =>
  act(async () => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: value,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

it('keeps autocomplete focus in the composer, filters and selects with the keyboard, and does not reopen on focus', async () => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  connection.players = [
    { id: 'a', name: 'Alice', kind: 'human', connected: true },
    { id: 'b', name: 'Bob', kind: 'human', connected: true },
  ] as Player[];
  await mount.render(<Harness />);
  const input = mount.host.querySelector<HTMLInputElement>(
    '.chat-composer-input',
  )!;
  await typeMessage('你好 @');
  expect(document.activeElement).toBe(input);
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
  expect(mount.host.contains(document.querySelector('.mention-picker'))).toBe(
    false,
  );
  await key('ArrowDown');
  expect(input.getAttribute('aria-activedescendant')).toBe('mention-b');
  await key('Enter');
  expect(controller.recipients.map((p) => p.id)).toEqual(['b']);
  expect(controller.text).toBe('你好 ');
  expect(document.activeElement).toBe(input);
  await typeMessage('你好 @Ali');
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(document.querySelector('[role="option"]')?.textContent).toContain(
    'Alice',
  );
  expect(document.activeElement).toBe(input);
  await key('Escape');
  expect(controller.picker).toBeNull();
  expect(controller.text).toBe('你好 @Ali');
  expect(escaped).not.toHaveBeenCalled();
  await act(async () => {
    input.blur();
    input.focus();
    document.dispatchEvent(new Event('selectionchange', { bubbles: true }));
  });
  expect(controller.picker).toBeNull();
  await typeMessage('你好 @Alice');
  await key('Enter');
  expect(controller.recipients.map((p) => p.id)).toEqual(['b', 'a']);
  expect(controller.text).toBe('你好 ');
});

it('dismisses the recipient popup on outside focus without stealing focus back', async () => {
  await mount.render(<Harness />);
  await click('更多聊天操作');
  await click('选人');
  expect(document.activeElement).toBe(controller.search.current);
  const outside = document.createElement('button');
  outside.textContent = 'outside';
  document.body.append(outside);
  await act(async () => outside.focus());
  expect(controller.picker).toBeNull();
  expect(document.activeElement).toBe(outside);
  outside.remove();
});

it('shows an error beside the input without taking focus, and keeps it reachable after dismissal', async () => {
  await mount.render(<Harness />);
  await typeMessage('保留我的草稿');
  await act(async () => controller.setMode('sending'));
  await act(async () => {
    controller.setMode('idle');
    controller.setError('连接失败，文字已保留，请重试。');
  });
  const input = mount.host.querySelector('.chat-composer-input');
  const notice = document.querySelector('.chat-input-notice');
  expect(notice?.textContent).toContain('连接失败');
  expect(mount.host.contains(notice)).toBe(false);
  expect(
    mount.host.querySelector('form [role="alert"]')?.textContent,
  ).toContain('文字已保留');
  expect(mount.host.querySelector('.chat-error, .chat-help')).toBeNull();
  expect(document.activeElement).toBe(input);
  await click('关闭输入提示');
  await vi.waitFor(() =>
    expect(document.activeElement).toBe(button('需要处理')),
  );
  expect(document.querySelector('.chat-input-notice')).toBeNull();
  await click('需要处理');
  expect(document.querySelector('.chat-input-notice')?.textContent).toContain(
    '连接失败',
  );
  expect(button('发送消息').disabled).toBe(false);
  expect(controller.text).toBe('保留我的草稿');
  await act(async () => controller.setError(''));
  expect(document.querySelector('.chat-input-notice')).toBeNull();
});
