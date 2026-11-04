import { memo, useId, useMemo, useRef, type MouseEvent, type PointerEvent } from 'react';
import { Redo2, Trash2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { shortcutLabelForAction } from '../../keyboard/shortcuts';
import { listControls, rowGroupsView, type LayerRowGroupView } from '../../layer-order/model/layerOrderSelectors';
import type { LayerOrderAction, LayerOrderDialogState } from '../../layer-order/model/layerOrderState';
import { useShortcutStore } from '../../store/shortcutStore';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { LayerOrderFaceChip } from './LayerOrderFaceChip';
import type { LayerOrderCopy } from './layerOrderInspectorCopy';
import { samePastPaneHover } from './layerOrderInspectorRenders';
import styles from './LayerOrderConstraintList.module.css';

export interface LayerOrderConstraintListProps {
  readonly state: LayerOrderDialogState;
  readonly dispatch: (action: LayerOrderAction) => void;
  readonly copy: LayerOrderCopy;
}

/** A finger down on a row lights its faces, as pointing at it does (D6). */
function touched(event: PointerEvent): boolean {
  return event.pointerType === 'touch';
}

/**
 * Before a control pressed from the keyboard goes, hand the focus to `to`,
 * which stays. A pointer's press (a click with a count) has no focus to keep.
 */
function handFocus(event: MouseEvent<HTMLElement>, to: Element | null | undefined) {
  if (event.detail === 0 && to instanceof HTMLElement && event.currentTarget.contains(document.activeElement)) to.focus();
}

/** Undo's and Redo's keys as the registry resolves them now, so a rebinding shows. */
function useHistoryShortcuts(): { undo: string | undefined; redo: string | undefined } {
  const overrides = useShortcutStore((state) => state.overrides);
  const defaultsSource = useShortcutStore((state) => state.defaultsSource);
  return useMemo(() => {
    const resolution = { overrides, defaultsSource };
    return { undo: shortcutLabelForAction('edit.undo', resolution), redo: shortcutLabelForAction('edit.redo', resolution) };
  }, [overrides, defaultsSource]);
}

/**
 * The constraints list (A3; A5's grouped rows; `Round4-States`' rows by
 * status): one row per subject and verb, "D in front of H, K", each the
 * sentence that made it, read from the side shown.
 *
 * - A row is one button, named by its whole sentence: a press anywhere on it
 *   puts its subject in the builder; pointing at it, focusing it or pressing
 *   it lights its faces on both panes.
 * - Its trash removes the whole row as one undo step. A row has no
 *   per-object remove (D21; your words after trying it, 2026-10-26: "I don't
 *   want individual xs in the constraints list if there are multiple
 *   objects, they can delete the whole constraint if they want").
 * - A row in the clash shown carries the danger dot, and in a row of two or
 *   more the clashing objects are marked on their chips; a saved row that is
 *   not applied is dimmed with the warning dot, and its reason is its title.
 *   A face that no longer exists keeps its chip's place, with no letter.
 * - The heading counts constraints, as Properties does (D11), not rows.
 * - Trashing a row from the keyboard leaves the focus on the row after it,
 *   else on Undo.
 *
 * Memoised past a pane hover: pointing at a face changes nothing here.
 */
export const LayerOrderConstraintList = memo(function LayerOrderConstraintList({
  state,
  dispatch,
  copy,
}: LayerOrderConstraintListProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const undoRef = useRef<HTMLButtonElement>(null);
  const groups = rowGroupsView(state);
  const controls = listControls(state);
  const keys = useHistoryShortcuts();
  const count = state.rows.committed.length + state.rows.carried.length;
  const leave = () => dispatch({ type: 'row_hovered', key: null });
  // While a change is in flight there is something to undo, once it lands: say so, not "Nothing to undo".
  const undoTitle = controls.undo
    ? keys.undo
      ? t('dialogs:layerOrder.list.undoShortcut', 'Undo ({{shortcut}})', { shortcut: keys.undo })
      : t('dialogs:layerOrder.list.undo', 'Undo')
    : controls.undoWaits
      ? t('dialogs:layerOrder.list.undoWaits', 'Undo waits for the change in progress')
      : t('dialogs:layerOrder.list.nothingToUndo', 'Nothing to undo');
  const redoTitle = controls.redo
    ? keys.redo
      ? t('dialogs:layerOrder.list.redoShortcut', 'Redo ({{shortcut}})', { shortcut: keys.redo })
      : t('dialogs:layerOrder.list.redo', 'Redo')
    : controls.redoWaits
      ? t('dialogs:layerOrder.list.redoWaits', 'Redo waits for the change in progress')
      : t('dialogs:layerOrder.list.nothingToRedo', 'Nothing to redo');

  return (
    <section className={styles.list} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h3 className={styles.title} id={titleId}>
          {count > 0
            ? t('dialogs:layerOrder.list.titleCount', 'Constraints · {{count}}', { count })
            : t('dialogs:layerOrder.list.title', 'Constraints')}
        </h3>
        <IconButton
          ref={undoRef}
          size="sm"
          aria-label={t('dialogs:layerOrder.list.undo', 'Undo')}
          title={undoTitle}
          aria-disabled={!controls.undo || undefined}
          onClick={() => {
            if (controls.undo) dispatch({ type: 'undo' });
          }}
        >
          <Undo2 size={14} />
        </IconButton>
        <IconButton
          size="sm"
          aria-label={t('dialogs:layerOrder.list.redo', 'Redo')}
          title={redoTitle}
          aria-disabled={!controls.redo || undefined}
          onClick={() => {
            if (controls.redo) dispatch({ type: 'redo' });
          }}
        >
          <Redo2 size={14} />
        </IconButton>
        <Button
          size="sm"
          variant="ghost"
          aria-disabled={!controls.clearAll || undefined}
          onClick={() => {
            if (controls.clearAll) dispatch({ type: 'clear_all' });
          }}
        >
          {t('dialogs:layerOrder.list.clearAll', 'Clear all')}
        </Button>
      </div>
      {groups.length === 0 ? (
        <p className={styles.empty}>
          {t('dialogs:layerOrder.list.empty', 'None yet. Each constraint you add is listed here as its sentence, in the order made.')}
        </p>
      ) : (
        <ul className={styles.rows} onPointerLeave={leave}>
          {groups.map((group) => (
            <ConstraintRow
              key={group.key}
              group={group}
              copy={copy}
              removable={controls.remove}
              dispatch={dispatch}
              onLeave={leave}
              undo={undoRef}
            />
          ))}
        </ul>
      )}
    </section>
  );
}, samePastPaneHover);

function ConstraintRow({
  group,
  copy,
  removable,
  dispatch,
  onLeave,
  undo,
}: {
  group: LayerRowGroupView;
  copy: LayerOrderCopy;
  removable: boolean;
  dispatch: (action: LayerOrderAction) => void;
  onLeave: () => void;
  /** Where the focus goes when the last row is trashed. */
  undo: { readonly current: HTMLButtonElement | null };
}) {
  const { t } = useTranslation();
  const { key, sentence, members, mark, reason } = group;
  const multi = members.length > 1;
  const text = copy.sentence(sentence);
  const enter = () => dispatch({ type: 'row_hovered', key });
  const title =
    reason !== null && mark !== 'none'
      ? copy.reason(reason)
      : sentence.subject !== null
        ? t('dialogs:layerOrder.list.reveal', 'Put {{face}} in the builder', { face: copy.letter(sentence.subject) })
        : undefined;
  const dim = mark === 'not_applied';
  const removeLabel = t('dialogs:layerOrder.list.remove', 'Remove {{sentence}}', { sentence: copy.clause(sentence) });

  const parts = copy.sentenceParts().map((part, index) => {
    switch (part.kind) {
      case 'subject':
        return (
          <span key="subject" className={styles.lead}>
            <LayerOrderFaceChip letter={copy.letter(sentence.subject)} gone={sentence.subject === null} dim={dim} />
          </span>
        );
      case 'verb':
        return (
          <span key="verb" className={styles.verb} data-dim={dim || undefined} aria-hidden="true">
            {sentence.verb === null ? t('dialogs:layerOrder.verb.against', 'against') : copy.verb(sentence.verb)}
          </span>
        );
      case 'objects':
        return (
          <span key="objects" className={styles.objects}>
            {members.map((member, i) => (
              <span key={member.id} className={styles.object}>
                <LayerOrderFaceChip
                  letter={copy.letter(member.object)}
                  gone={member.object === null}
                  tone={multi && member.clash ? 'danger' : 'plain'}
                  dim={dim}
                />
                {i < members.length - 1 && (
                  <span className={styles.separator} aria-hidden="true">
                    {t('dialogs:layerOrder.list.separator', ',')}
                  </span>
                )}
              </span>
            ))}
          </span>
        );
      case 'text':
        return (
          <span key={`text-${index}`} className={styles.verb} aria-hidden="true">
            {part.text}
          </span>
        );
    }
  });

  return (
    <li
      className={styles.row}
      data-hot={group.hot || undefined}
      data-mark={mark}
      data-flagged={group.flagged || undefined}
      onPointerEnter={enter}
      onPointerDown={(event) => {
        if (touched(event)) enter();
      }}
      onPointerUp={(event) => {
        if (touched(event)) onLeave();
      }}
      onPointerCancel={(event) => {
        if (touched(event)) onLeave();
      }}
    >
      <div className={styles.line}>
        <button
          type="button"
          className={styles.hit}
          data-row-button=""
          aria-label={text}
          title={title}
          onClick={() => dispatch({ type: 'row_clicked', key })}
          onFocus={enter}
          onBlur={onLeave}
        />
        <span className={styles.dot} aria-hidden="true" />
        {/* What it reads, drawn: its chips and words are hidden from a reader, which hears the row's button. */}
        <span className={styles.sentence}>{parts}</span>
      </div>
      <IconButton
        size="sm"
        aria-label={removeLabel}
        title={removeLabel}
        aria-disabled={!removable || undefined}
        onFocus={enter}
        onBlur={onLeave}
        onClick={(event) => {
          if (!removable) return;
          // The row goes: the next row's button takes the focus, else Undo.
          const row = event.currentTarget.closest('li');
          const next = row?.nextElementSibling?.querySelector('[data-row-button]');
          handFocus(event, next ?? undo.current);
          dispatch({ type: 'row_removed', key });
        }}
      >
        <Trash2 size={14} />
      </IconButton>
    </li>
  );
}
