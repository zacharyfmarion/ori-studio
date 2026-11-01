import { forwardRef, useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { ControlVerb } from '../../lib/controlVerb';
import { Button } from '../ui/Button';
import { Pager } from '../ui/Pager';
import { FieldRow, StackedRow } from '../ui/fieldRows';
import styles from './LayerOrderRow.module.css';

/** A way into the Layer order dialog, as the row's word button draws it. */
export interface LayerOrderRowEntry {
  /** What the button says ("Edit…"). */
  label: string;
  /** Its name, said in full where the row's label is not read with it ("Edit Layer Order…"). */
  name: string;
  disabled: boolean;
  /** Something the dialog would open on is still running: it does nothing until that lands, but keeps the focus. */
  waiting?: boolean;
  hint?: string;
  run: () => void;
}

/**
 * A flat fold's Layer order row (`implementation-plans/layer-order-dialog.md`,
 * H7; the approved Entry points board): ‹ where it stands among its layer
 * orders › and Edit…, which opens the Layer order dialog, under one label.
 * The Diagram's Step pane, the Export crease pattern dialog and the Share
 * modal all draw this one, with the same words.
 *
 * Edit… is always there, so the pager never moves, and the note under the
 * label says what the chosen order holds ("3 constraints") or why the row can
 * do nothing. The pager is named by the row's label, so "Layer order" is said
 * once. `editRef` is the button, for a host that gives it focus back when the
 * dialog closes; `onEditIntent` runs as a pointer or focus comes to it, for a
 * host that loads the dialog's code ahead of the press.
 */
export const LayerOrderRow = forwardRef<
  HTMLButtonElement,
  {
    /** ‹ › and where it stands; absent for a row with nothing to step through (a fold in 3D). */
    pager?: { previous?: ControlVerb; next?: ControlVerb; readout: ReactNode } | null;
    edit?: LayerOrderRowEntry | null;
    disabled?: boolean;
    note?: string;
    noteKind?: 'reason' | 'status';
    /**
     * The pager and Edit… beside the label, or stacked under it with the note
     * after them, for a column too narrow for both (the Share modal's).
     */
    layout?: 'row' | 'stacked';
    onEditIntent?: () => void;
  }
>(function LayerOrderRow({ pager, edit, disabled, note, noteKind = 'reason', layout = 'row', onEditIntent }, editRef) {
  const { t } = useTranslation();
  const labelId = useId();
  const label = t('panels:diagram.pose.layerOrder', 'Layer order');
  const controls = (
    <span className={styles.layerOrder} data-layout={layout}>
      {pager && (
        <Pager labelledBy={labelId} previous={pager.previous} next={pager.next}>
          {pager.readout}
        </Pager>
      )}
      {edit && <LayerOrderEntry ref={editRef} entry={edit} onIntent={onEditIntent} />}
    </span>
  );
  if (layout === 'stacked') {
    return (
      <StackedRow label={label} labelId={labelId} disabled={disabled}>
        {controls}
        {note !== undefined && (
          <span className={styles.note} data-note={noteKind}>
            {note}
          </span>
        )}
      </StackedRow>
    );
  }
  return (
    <FieldRow
      label={label}
      labelId={labelId}
      kind="text"
      disabled={disabled}
      note={note}
      noteKind={noteKind}
    >
      {controls}
    </FieldRow>
  );
});

/**
 * Where a constrained fold stands before anything has counted it (D11): the
 * width a count takes, kept and unread, so the chevrons stay where a count
 * puts them.
 */
export function LayerOrderReadoutReserved() {
  const { t } = useTranslation();
  return (
    <span className={styles.reserved} data-reserved="" aria-hidden="true">
      {t('panels:diagram.pose.layerOrderOf', '{{number}} of {{total}}', { number: 1, total: 1 })}
    </span>
  );
}

/**
 * A way into the Layer order dialog, as a word button (no icon says "layer
 * order"): refused rather than disabled, so it keeps the focus a press gave
 * it, and says why on hover.
 */
const LayerOrderEntry = forwardRef<HTMLButtonElement, { entry: LayerOrderRowEntry; onIntent?: () => void }>(
  function LayerOrderEntry({ entry, onIntent }, ref) {
    const held = entry.disabled || entry.waiting;
    return (
      <Button
        ref={ref}
        size="sm"
        variant="secondary"
        aria-label={entry.name}
        title={held && entry.hint ? entry.hint : entry.name}
        aria-disabled={held || undefined}
        onPointerEnter={onIntent}
        onFocus={onIntent}
        onClick={entry.run}
      >
        {entry.label}
      </Button>
    );
  }
);
