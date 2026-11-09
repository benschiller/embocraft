import type { Player } from '@voxel/shared';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { Connection } from '../../../network/connection';
import { consumeMention, mentionQuery } from '../chat-mentions';

export function useChatController(connection: Connection, expanded = true) {
  const collapsed = !expanded;
  const [collapsedAt, setCollapsedAt] = useState(0);
  const latestChatSeq = connection.chats.at(-1)?.seq ?? 0;
  useEffect(() => {
    if (expanded) setCollapsedAt(latestChatSeq);
  }, [expanded, latestChatSeq]);
  const unread = collapsed
    ? connection.chats.filter(
        (entry) =>
          entry.seq > collapsedAt && entry.actor !== connection.room?.sessionId,
      ).length
    : 0;
  const [text, setText] = useState(''),
    [scope, setScope] = useState<'public' | 'private'>('public'),
    [recipients, setRecipients] = useState<Player[]>([]);
  const [picker, setPicker] = useState<
    | NonNullable<ReturnType<typeof mentionQuery>>
    | { source: 'button'; query: string }
    | null
  >(null);
  const [choice, setChoice] = useState(0);
  const panel = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const caret = useRef(0);
  const [status, setStatus] = useState(''),
    [error, setError] = useState(''),
    [mode, setMode] = useState<'idle' | 'sending'>('idle');
  const input = useRef<HTMLInputElement>(null),
    list = useRef<HTMLDivElement>(null),
    upload = useRef<AbortController | undefined>(undefined);
  const connected = connection.status === 'connected',
    busy = mode !== 'idle';
  const candidates = connection.players
    .filter(
      (p) =>
        p.connected &&
        p.id !== connection.room?.sessionId &&
        !recipients.some((r) => r.id === p.id) &&
        p.name
          .toLowerCase()
          .includes((picker?.query ?? '').trim().toLowerCase()),
    )
    .sort((a, b) => Number(b.kind !== 'human') - Number(a.kind !== 'human'));
  const activeChoice = candidates.length ? choice % candidates.length : 0;
  const cancel = useCallback(() => {
    upload.current?.abort();
    upload.current = undefined;
    setMode('idle');
    setStatus('');
  }, []);
  useEffect(() => {
    if (!connected) cancel();
  }, [connected, cancel]);
  useEffect(
    () => () => {
      upload.current?.abort();
      upload.current = undefined;
    },
    [],
  );
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [connection.chats.length]);
  const openPicker = () => {
    setPicker({ source: 'button', query: '' });
    setChoice(0);
    setError('');
  };
  const select = (p: Player) => {
    if (recipients.some((r) => r.id === p.id)) return;
    if (recipients.length >= 8) {
      setError('最多选择 8 位接收者，请先移除一位。');
      return;
    }
    const next =
      picker?.source === 'input'
        ? consumeMention(text, picker.start, picker.end)
        : { text, caret: caret.current };
    setText(next.text);
    setRecipients((r) => [...r, p]);
    setPicker(null);
    setError('');
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter confirms an IME candidate; it must never select a player or send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (!picker) return;
    if (e.key === 'Escape') {
      setPicker(null);
      e.preventDefault();
      e.stopPropagation();
      input.current?.focus();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setChoice(
        (n) =>
          (n +
            (e.key === 'ArrowDown' ? 1 : -1) +
            Math.max(1, candidates.length)) %
          Math.max(1, candidates.length),
      );
    }
    if (e.key === 'Enter' || (e.key === 'Tab' && candidates.length)) {
      e.preventDefault();
      if (candidates.length) select(candidates[activeChoice]);
    }
  };
  const send = async (messageText = text) => {
    if (upload.current) return;
    setError('');
    setStatus('');
    if (connection.status !== 'connected') {
      setError('世界连接已断开，未发送；文字已保留，请连接后重试。');
      return;
    }
    const ids = recipients.map((p) => p.id);
    if (scope === 'private' && !ids.length) {
      setError('请先通过 @ 选择私聊对象。');
      return;
    }
    if (
      ids.some(
        (id) => !connection.players.some((p) => p.id === id && p.connected),
      )
    ) {
      setError('接收对象已离线，请移除或重新选择。');
      return;
    }
    if (!messageText.trim()) return;
    setPicker(null);
    setMode('sending');
    const abort = new AbortController();
    upload.current = abort;
    try {
      await connection.requestAction('chat', {
        text: messageText,
        scope,
        recipients: ids,
      });
      if (upload.current !== abort || abort.signal.aborted) return;
      setText('');
      setStatus('');
      if (scope === 'public') setRecipients([]);
      input.current?.focus();
    } catch (e) {
      if (upload.current !== abort) return;
      setStatus('');
      if (!abort.signal.aborted)
        setError(
          `${(e as Error).message} 文字已保留，请确认消息记录后重试。`,
        );
      else setError('发送已取消或超时，请确认消息记录后再重试。');
    } finally {
      if (upload.current === abort) {
        upload.current = undefined;
        setMode('idle');
      }
    }
  };

  return {
    connection,
    collapsed,
    setCollapsedAt,
    unread,
    text,
    setText,
    scope,
    setScope,
    recipients,
    setRecipients,
    picker,
    setPicker,
    setChoice,
    panel,
    search,
    caret,
    status,
    setStatus,
    error,
    setError,
    mode,
    setMode,
    input,
    list,
    upload,
    connected,
    busy,
    candidates,
    activeChoice,
    cancel,
    openPicker,
    select,
    onKey,
    send,
  };
}
export type ChatController = ReturnType<typeof useChatController>;
