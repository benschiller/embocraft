import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUp, LoaderCircle, AtSign, Plus, X } from 'lucide-react';
import { useI18n } from '../../../i18n';
import { mentionQuery } from '../chat-mentions';
import type { ChatController } from '../hooks/useChatController';
import { MentionPicker } from './MentionPicker';
import { ComposerNotice } from './ComposerNotice';

export function ChatComposer({
  controller: c,
}: {
  controller: ChatController;
}) {
  const { t } = useI18n();
  const [more, setMore] = useState(false);
  const { setPicker } = c;
  const openNotice = useCallback(() => {
    setMore(false);
    setPicker(null);
  }, [setPicker]);
  const actionSelected = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const actionsId = useId();
  const composer = useRef<HTMLFormElement>(null);
  const wasOccupied = useRef(c.busy);
  useEffect(() => {
    const occupied = c.busy;
    if (wasOccupied.current && !occupied && !c.collapsed)
      c.input.current?.focus();
    wasOccupied.current = occupied;
  }, [c.busy, c.collapsed, c.input]);
  const sendLabel = t('chat.send');
  const showMore = more && !c.busy && !c.picker && !c.collapsed;
  const cancelLabel = t('chat.cancelSending');
  const closeForAction = () => {
    actionSelected.current = true;
    setMore(false);
  };

  return (
    <Popover.Root
      open={showMore}
      onOpenChange={(open) => {
        if (open) {
          actionSelected.current = false;
          c.setPicker(null);
        }
        setMore(open);
      }}
    >
      <div className="chat-composer-wrap">
        <Popover.Portal>
          <Popover.Content
            className="chat-more-actions"
            id={actionsId}
            data-hud
            aria-label={t('chat.moreActions')}
            side="top"
            align="start"
            sideOffset={10}
            collisionPadding={12}
            onCloseAutoFocus={(event) => {
              // Picker and draft actions manage their own destination focus.
              if (actionSelected.current) event.preventDefault();
            }}
            onEscapeKeyDown={(event) => {
              if (event.isComposing) event.preventDefault();
              event.stopPropagation();
            }}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                closeForAction();
                c.openPicker();
              }}
            >
              <AtSign size={16} aria-hidden="true" />
              {t('chat.pickMention')}
            </button>
          </Popover.Content>
        </Popover.Portal>
        <form
          ref={composer}
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            if (!c.connected) return;
            if (!c.busy) void c.send();
          }}
        >
          {c.busy ? (
            <button
              type="button"
              className="chat-composer-icon"
              aria-label={cancelLabel}
              title={cancelLabel}
              onClick={() => c.upload.current?.abort()}
            >
              <X size={18} aria-hidden="true" />
            </button>
          ) : (
            <Popover.Trigger asChild>
              <button
                ref={trigger}
                type="button"
                className="chat-composer-icon"
                aria-label={t('chat.moreActions')}
                title={t('chat.moreActions')}
                aria-expanded={showMore}
                aria-controls={showMore ? actionsId : undefined}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
            </Popover.Trigger>
          )}
          {c.busy ? (
            <div className="chat-recording">
              <LoaderCircle
                className="chat-progress-spinner"
                size={15}
                aria-hidden="true"
              />
              <span className="chat-recording-label" role="status">
                {t('chat.sending')}
              </span>
            </div>
          ) : (
            <input
              ref={c.input}
              className="chat-composer-input"
              aria-label={t('chat.inputAria')}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={c.picker?.source === 'input'}
              aria-activedescendant={
                c.picker?.source === 'input' && c.candidates.length
                  ? `mention-${c.candidates[c.activeChoice].id}`
                  : undefined
              }
              aria-controls={c.picker ? 'chat-mentions' : undefined}
              placeholder={
                c.scope === 'private'
                  ? c.recipients.length
                    ? t('chat.placeholderPrivate')
                    : t('chat.placeholderPickFirst')
                  : t('chat.placeholderPublic')
              }
              value={c.text}
              maxLength={240}
              onKeyDown={c.onKey}
              onChange={(event) => {
                setMore(false);
                c.setText(event.target.value);
                const pos = event.target.selectionStart ?? 0;
                c.caret.current = pos;
                c.setPicker(mentionQuery(event.target.value, pos));
                c.setChoice(0);
              }}
              onSelect={(event) => {
                c.caret.current = event.currentTarget.selectionStart ?? 0;
                if (c.picker?.source === 'input')
                  c.setPicker(
                    mentionQuery(event.currentTarget.value, c.caret.current),
                  );
              }}
            />
          )}
          {!c.busy && c.error && (
            <ComposerNotice
              error={c.error}
              overflow=""
              canRestore={false}
              anchor={composer}
              onOpen={openNotice}
              onRestore={() => {}}
            />
          )}
          <button
            type="submit"
            className="chat-send"
            disabled={
              !c.connected ||
              c.busy ||
              !c.text.trim() ||
              (c.scope === 'private' && !c.recipients.length)
            }
            aria-label={sendLabel}
            title={sendLabel}
          >
            <ArrowUp size={20} aria-hidden="true" />
          </button>
        </form>
        <MentionPicker
          controller={c}
          anchor={composer}
          fallbackFocus={trigger}
        />
      </div>
    </Popover.Root>
  );
}
