import { FileUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { FoldPaperShape, FoldStartSide } from '../../fold/document/foldSequenceDocument';
import { sheetShapeName } from '../../fold/sequence/foldSequenceWords';
import { documentPaperStyleOf, type DocumentPaperStyle, type DocumentPaperStyleChoice } from '../../lib/paper/documentPaperStyle';
import { PaperStyleChoiceRow } from '../paper/PaperStyleChoiceRow';
import { Button } from '../ui/Button';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { FieldRow, SegmentedRow } from '../ui/fieldRows';
import { Notice } from '../ui/Notice';
import styles from './FoldPaperPane.module.css';

/**
 * The Paper tab: the paper style the sequence is drawn in, and the sheet it
 * starts from (plan D11).
 *
 * The style is the sequence's own, picked as the Diagram's Page pane picks a
 * diagram's (`PaperStyleChoiceRow`): a built-in — the Diagram style, which a
 * new sequence is drawn in — the export style from Settings, or a preset
 * saved there, copied into the sequence when chosen. The folded form and the
 * step cards paint from it; the crease pattern pane is drawn as Edit draws a
 * crease pattern, but for the step's own fold lines, in the style's diagram
 * crease pens.
 *
 * The style and the sheet are the sequence's document state, so they arrive
 * in props and leave through callbacks. Which side starts up is labelled
 * Front and Back rather than by colour, because the presets disagree about
 * which face is the coloured one. The sheet's shape is shown, not edited: a
 * new one is a crease pattern's outline, taken through Import CP's dialog
 * in its sheet mode (`onImportSheet`, `foldStartingSheet`) — any convex
 * outline of 3 to 8 sides, its creases left behind. A new sheet starts the
 * sequence over (plan D7), as one undoable edit, which the tab says
 * beforehand rather than asking.
 */
export function FoldPaperPane({
  style,
  shape,
  startSide,
  stepCount,
  readOnly = false,
  onStyleChange,
  onImportSheet,
  onStartSideChange,
}: {
  /** The paper style the sequence keeps. */
  style: DocumentPaperStyle;
  /** The sheet's shape, as the document stores it. */
  shape: FoldPaperShape;
  startSide: FoldStartSide;
  /** Every step of the sequence, on every branch: what a new sheet clears. */
  stepCount: number;
  /** A sequence from a newer build: its sheet cannot change. */
  readOnly?: boolean;
  /** Draw the sequence in another style. */
  onStyleChange: (choice: DocumentPaperStyleChoice) => void;
  /** Open Import CP's dialog in its sheet mode. */
  onImportSheet: () => void;
  onStartSideChange: (side: FoldStartSide) => void;
}) {
  const { t } = useTranslation();
  const paper = documentPaperStyleOf(style).paper;

  return (
    <div className={styles.pane}>
      <CollapsibleSection title={t('panels:fold.paper.look', 'Look')}>
        <PaperStyleChoiceRow
          value={style}
          disabled={readOnly}
          label={t('panels:fold.paper.style', 'Style')}
          help={t(
            'panels:fold.paper.styleHint',
            'The paper, pens and diagram creases this sequence is drawn in. A style from Settings is copied into the sequence when you pick it.'
          )}
          keptLabel={t('panels:fold.paper.keptStyle', 'This sequence’s own')}
          onChange={onStyleChange}
        />
      </CollapsibleSection>

      <CollapsibleSection title={t('panels:fold.paper.sheet', 'Sheet')}>
        <SegmentedRow
          label={t('panels:fold.paper.start', 'Start')}
          help={t(
            'panels:fold.paper.startHelp',
            'Which side of the paper faces you before the first fold. The crease pattern is always drawn from the front.'
          )}
          value={startSide}
          disabled={readOnly}
          options={[
            {
              id: 'front',
              label: t('panels:fold.paper.frontUp', 'Front up'),
              icon: (
                <span className={styles.swatch} style={{ background: paper.front }} aria-hidden="true" />
              ),
            },
            {
              id: 'back',
              label: t('panels:fold.paper.backUp', 'Back up'),
              icon: (
                <span className={styles.swatch} style={{ background: paper.back }} aria-hidden="true" />
              ),
            },
          ]}
          onChange={(side) => {
            if (side === 'front' || side === 'back') onStartSideChange(side);
          }}
        />
        <FieldRow label={t('panels:fold.paper.shape', 'Shape')} kind="text" disabled={readOnly}>
          {sheetShapeName(t, shape)}
        </FieldRow>
        <div className={styles.sheetActions}>
          <Button size="sm" variant="secondary" disabled={readOnly} onClick={onImportSheet}>
            <FileUp size={14} aria-hidden="true" />
            {t('panels:fold.paper.importSheet', 'Import starting sheet…')}
          </Button>
        </div>
        {stepCount > 0 && !readOnly && (
          <div className={styles.notice}>
            <Notice tone="warning">
              {t('panels:fold.paper.sheetStartsOver', {
                count: stepCount,
                defaultValue_one:
                  'A new starting sheet starts over: the sequence’s {{count}} step is cleared. Undo brings it back.',
                defaultValue_other:
                  'A new starting sheet starts over: the sequence’s {{count}} steps are cleared. Undo brings them back.',
              })}
            </Notice>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
