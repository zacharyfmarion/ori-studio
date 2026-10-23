import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { foldCapWords, type FoldCap } from '../../fold/foldCaps';
import type { FoldStartSide } from '../../fold/document/foldSequenceDocument';
import { foldStepSentence, type FoldSentenceStep } from '../../fold/stepSentence';
import {
  cpOriginLabel,
  creaseDiffLines,
  extentLabel,
  lineLabel,
  operationBadge,
  operationLabel,
  secondLineLabel,
  type FoldCpOrigin,
  type FoldCreaseCounts,
  type FoldCreaseDiff,
} from '../../fold/stepWords';
import type { FoldStepSpreadControls } from '../../fold/sequence/foldStepSpreadControls';
import { vertexRows } from '../../fold/stepSentenceVertex';
import { turnCardWords } from '../../lib/steps/turnWords';
import { LayerSpreadRows } from '../paper/LayerSpreadRows';
import { Badge } from '../ui/Badge';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { FieldRow } from '../ui/fieldRows';
import { Notice, type NoticeAction } from '../ui/Notice';
import styles from './FoldStepPane.module.css';

/**
 * A step's standing, derived from its path and never stored (plan D6):
 * - `changed`: same inputs, a different state than when it was saved — an
 *   engine change, not an error;
 * - `broken`: its own inputs no longer resolve on the state before it;
 * - `brokenAbove`: a step before it is broken, so it cannot be replayed;
 * - `locked`: an operation a newer build wrote, kept verbatim.
 */
export type FoldStepStatus = 'ok' | 'changed' | 'broken' | 'brokenAbove' | 'locked';

/** What the pane shows of the step at the cursor: the engine's per-step summary (plan D14) and its place. */
export interface FoldStepPaneStep {
  /** The step as its sentence reads it. */
  words: FoldSentenceStep;
  /** Its number on the active path; null for a turn, which takes none. */
  number: number | null;
  /**
   * The deepest stack along the line, in display layers (plan D14): layers
   * joined across a flat crease count as one. Null for a step with no line,
   * or one that did not replay.
   */
  layers: number | null;
  /** The crease pattern after the step, front-relative; null when it did not replay. */
  creases: FoldCreaseCounts | null;
  /** What the step changed; null when it did not replay. */
  diff: FoldCreaseDiff | null;
  status: FoldStepStatus;
  /** Broken because it is over one of Fold's caps (too many faces, stacked too deep): its counts. */
  cap?: FoldCap;
  /** For Import CP: where the pattern came from. */
  origin?: FoldCpOrigin;
  /** For a compound fold: what it chose and how its paper moved (`foldCompoundPaneRows`). */
  compound?: FoldCompoundPaneRows;
}

/**
 * A compound fold's rows in the Step pane: how many stacks of paper turned
 * as one (its blocks), and whether its opening and its layer order were
 * chosen among several or were the only ones.
 */
export interface FoldCompoundPaneRows {
  blocks: number;
  /** Null for a fold with no opening (a flap moving whole). */
  opening: 'chosen' | 'only' | null;
  /** A closed sink's pocket; absent or null for every other fold. */
  pocket?: 'chosen' | 'only' | null;
  /** Whether the layer order was chosen among several. */
  orderChosen: boolean;
  /** Whose blocks they are, for their help: a vertex fold's are its motion classes; absent for a reverse fold's openings. */
  blocksOf?: 'vertex';
}

/** The fold being made and not yet committed, as the preview landed it. */
export interface FoldPendingFold {
  words: FoldSentenceStep;
  /** What committing it would change; null until the engine has said. */
  diff: FoldCreaseDiff | null;
  /** The engine refused it: the tool window says why, and there is nothing to change yet. */
  refused?: boolean;
}

/**
 * Where the cursor is when folding there starts a branch: after numbered step
 * `at` (0 is the flat sheet) of the active path's `total`.
 */
export interface FoldBranchPosition {
  at: number;
  total: number;
}

/**
 * The Step pane: the step at the cursor in words and numbers — its sentence,
 * operation, line, layers and what it did to the crease pattern — how its
 * folded picture spreads its layers, then the fold in progress, if there is
 * one.
 *
 * Presentation only: every value arrives in props, from the engine's
 * per-step summary and the sequence's derived state. The words are
 * `fold/stepWords`' and the sentence `fold/stepSentence`'s, so the strip, the
 * grid and the tool window say a step as this does.
 *
 * Mountain and valley are counted as the crease pattern stores them, from the
 * front (plan D2). A sequence started back up says so, because there the
 * counts read the other way to the folds the viewer made.
 */
export function FoldStepPane({
  step,
  pending = null,
  startSide,
  branch = null,
  fixes = [],
  spread = null,
}: {
  /** The step at the cursor; null is the flat sheet. */
  step: FoldStepPaneStep | null;
  pending?: FoldPendingFold | null;
  startSide: FoldStartSide;
  /** Set when the cursor is not at the active path's tip: folding there starts a branch. */
  branch?: FoldBranchPosition | null;
  /** What a broken step's notice offers — its delete, from the action catalog. */
  fixes?: readonly NoticeAction[];
  /** How the step's folded picture spreads its layers (`useFoldStepSpread`); null for none to offer. */
  spread?: FoldStepSpreadControls | null;
}) {
  const { t } = useTranslation();

  const branchNotice = branch && (
    <Notice>
      {branch.at === 0
        ? t('panels:fold.step.branchSheet', 'You are at the flat sheet: folding here starts a new branch.')
        : t('panels:fold.step.branchStep', 'You are at step {{at}} of {{total}}: folding here starts a new branch.', {
            at: branch.at,
            total: branch.total,
          })}
    </Notice>
  );
  const pendingSection = pending && <PendingFold pending={pending} />;

  if (!step) {
    return (
      <div className={styles.pane}>
        <header className={styles.header}>
          <h3 className={styles.title}>{t('panels:fold.step.sheet', 'Flat sheet')}</h3>
        </header>
        <p className={styles.sentence}>
          {t('panels:fold.step.sheetNote', 'Nothing is folded yet. Fold the sheet to make step 1.')}
        </p>
        {branchNotice && <div className={styles.notices}>{branchNotice}</div>}
        {pendingSection}
      </div>
    );
  }

  const { words } = step;
  const line = lineLabel(t, words);
  // A precrease says how much of its line it creased.
  const extent = extentLabel(t, words);
  // A crimp names both its lines: the first, nearer the body, and the second beyond it.
  const secondLine = secondLineLabel(t, words);
  const title =
    step.number !== null
      ? t('panels:fold.step.title', 'Step {{number}}', { number: step.number })
      : words.op === 'turn'
        ? turnCardWords(words.turn, t).title
        : operationLabel(t, words);
  // A turn's title is already what it is; anything numbered says it in a badge.
  const badge = step.number !== null ? operationBadge(t, words) : null;

  return (
    <div className={styles.pane}>
      <header className={styles.header}>
        <h3 className={styles.title}>{title}</h3>
        {badge && <Badge tone="neutral">{badge}</Badge>}
      </header>
      <p className={styles.sentence}>{foldStepSentence(t, words)}</p>

      <StatusNotices step={step} fixes={fixes} branchNotice={branchNotice} />

      <div className={styles.rows}>
        <FieldRow label={t('panels:fold.step.operation', 'Operation')} kind="static">
          {operationLabel(t, words)}
        </FieldRow>
        {line !== null && (
          <FieldRow
            label={secondLine !== null ? t('panels:fold.step.firstLine', 'First line') : t('panels:fold.step.line', 'Line')}
            kind="static"
          >
            {line}
          </FieldRow>
        )}
        {secondLine !== null && (
          <FieldRow label={t('panels:fold.step.secondLine', 'Second line')} kind="static">
            {secondLine}
          </FieldRow>
        )}
        {/* A vertex fold's own: a petal fold's hinge, a swivel's target and ridge. */}
        {words.op === 'vertex' &&
          vertexRows(t, words.form).map((row) => (
            <FieldRow key={row.label} label={row.label} kind="static" {...(row.help ? { help: row.help } : {})}>
              {row.value}
            </FieldRow>
          ))}
        {step.layers !== null && (
          <FieldRow
            label={t('panels:fold.step.layers', 'Layers')}
            kind="static"
            help={t(
              'panels:fold.step.layersHelp',
              'The deepest stack along the fold line. Layers that lie flat across a precrease count as one.'
            )}
          >
            {step.layers}
          </FieldRow>
        )}
        {words.op === 'cp-jump' && step.origin && (
          <FieldRow label={t('panels:fold.step.source', 'Source')} kind="static">
            {cpOriginLabel(t, step.origin)}
          </FieldRow>
        )}
        {step.compound && <CompoundRows rows={step.compound} />}
        {extent !== null && (
          <FieldRow
            label={t('panels:fold.step.extent', 'Extent')}
            kind="static"
            help={t(
              'panels:fold.step.extentHelp',
              'How much of the line the precrease creased: all of it, the stretch between two points, or a short pinch.'
            )}
          >
            {extent}
          </FieldRow>
        )}
        {step.diff && (
          <FieldRow label={t('panels:fold.step.changes', 'Changes')} kind="static">
            <ChangeLines lines={creaseDiffLines(t, step.diff, words)} />
          </FieldRow>
        )}
      </div>

      {spread && <SpreadSection spread={spread} />}
      {step.creases && <CreaseCounts creases={step.creases} startSide={startSide} />}
      {pendingSection}
    </div>
  );
}

/**
 * How the step's folded picture spreads its layers (Wave 5): the rows the
 * Diagram's Pose section lays a spread out with, and where the spread comes
 * from — a change here is the step's own, and the steps after it take it.
 */
function SpreadSection({ spread }: { spread: FoldStepSpreadControls }) {
  const { t } = useTranslation();
  const origin =
    spread.origin === 'own'
      ? t('panels:fold.step.spreadOwn', 'Set on this step. The steps after it take it too.')
      : spread.origin === 'earlier'
        ? t('panels:fold.step.spreadEarlier', 'As an earlier step sets it. A change here applies from this step on.')
        : t('panels:fold.step.spreadDefault', 'The default spread. A change here applies from this step on.');
  return (
    <CollapsibleSection title={t('panels:fold.step.spread', 'Spread')} description={origin}>
      <LayerSpreadRows toggle={spread.toggle} spread={spread.spread} />
    </CollapsibleSection>
  );
}

/**
 * What stands in the way of reading or folding from the step, worst first,
 * then the branch it would start.
 */
function StatusNotices({
  step,
  fixes,
  branchNotice,
}: {
  step: FoldStepPaneStep;
  fixes: readonly NoticeAction[];
  branchNotice: ReactNode;
}) {
  const { t } = useTranslation();
  const status = (() => {
    switch (step.status) {
      case 'ok':
        return null;
      case 'broken':
        return (
          <Notice tone="warning" actions={fixes}>
            {step.cap
              ? foldCapWords(t, step.cap, 'step').text
              : t(
                  'panels:fold.step.broken',
                  'This step no longer folds: what it was made from is not on the paper before it. It and the steps after it can only be deleted.'
                )}
          </Notice>
        );
      case 'brokenAbove':
        return (
          <Notice tone="warning">
            {t('panels:fold.step.brokenAbove', 'A step before this one no longer folds, so this one cannot be shown.')}
          </Notice>
        );
      case 'locked':
        return (
          <Notice>
            {t(
              'panels:fold.step.locked',
              'This step was made with a newer Ori Studio. It can be deleted here, and is saved exactly as it came.'
            )}
          </Notice>
        );
      case 'changed':
        return (
          <Notice>
            {t(
              'panels:fold.step.changed',
              'This step folds differently than when it was saved. Check its inputs and the steps above it.'
            )}
          </Notice>
        );
    }
  })();
  const imported = step.words.op === 'cp-jump' && !step.words.collapse && (
    <Notice>
      {t(
        'panels:fold.step.imported',
        'Imported crease pattern: this step replaces the folded state with the pattern’s own.'
      )}
    </Notice>
  );
  if (!status && !imported && !branchNotice) return null;
  return (
    <div className={styles.notices}>
      {status}
      {imported}
      {branchNotice}
    </div>
  );
}

/** A compound fold's opening, layer order and blocks, as rows. */
function CompoundRows({ rows }: { rows: FoldCompoundPaneRows }) {
  const { t } = useTranslation();
  const chosen = t('panels:fold.step.chosen', 'Chosen among several');
  return (
    <>
      {rows.opening && (
        <FieldRow
          label={t('panels:fold.step.opening', 'Opening')}
          kind="static"
          help={t(
            'panels:fold.step.openingHelp',
            'Where the flap parts to let the tip through: the layers that stay below it and the ones above.'
          )}
        >
          {rows.opening === 'chosen' ? chosen : t('panels:fold.step.onlyOne', 'The only one')}
        </FieldRow>
      )}
      {rows.pocket && (
        <FieldRow
          label={t('panels:fold.step.pocket', 'Pocket')}
          kind="static"
          help={t(
            'panels:fold.step.pocketHelp',
            'The gap between the point’s layers its tip was sunk into: the layers above it and the ones below stay together.'
          )}
        >
          {rows.pocket === 'chosen' ? chosen : t('panels:fold.step.onlyOne', 'The only one')}
        </FieldRow>
      )}
      {rows.orderChosen && (
        <FieldRow label={t('panels:fold.step.layerOrder', 'Layer order')} kind="static">
          {chosen}
        </FieldRow>
      )}
      <FieldRow
        label={t('panels:fold.step.blocks', 'Blocks')}
        kind="static"
        help={
          rows.blocksOf === 'vertex'
            ? t(
                'panels:fold.step.vertex.blocksHelp',
                'Pieces of paper that turn as one: each turns about the same creases, in the same order, to where it lands.'
              )
            : t(
                'panels:fold.step.blocksHelp',
                'Stacks of paper that turn as one: each opening’s lower and upper part, and each flap that moves whole.'
              )
        }
      >
        {rows.blocks}
      </FieldRow>
    </>
  );
}

/** One line per kind of change, as the value of a row. */
function ChangeLines({ lines }: { lines: readonly string[] }) {
  return (
    <span className={styles.changes}>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </span>
  );
}

/** The crease pattern's creases by letter, labelled as counted from the front. */
function CreaseCounts({ creases, startSide }: { creases: FoldCreaseCounts; startSide: FoldStartSide }) {
  const { t } = useTranslation();
  return (
    <CollapsibleSection
      title={t('panels:fold.step.creases', 'Creases')}
      description={
        startSide === 'back'
          ? t(
              'panels:fold.step.creasesBackUp',
              'As seen from the front of the paper, which starts face down: they can read the other way to the folds you see.'
            )
          : t('panels:fold.step.creasesFront', 'As seen from the front of the paper.')
      }
    >
      <FieldRow label={t('panels:fold.step.mountain', 'Mountain')} kind="static">
        {creases.mountain}
      </FieldRow>
      <FieldRow label={t('panels:fold.step.valley', 'Valley')} kind="static">
        {creases.valley}
      </FieldRow>
      <FieldRow
        label={t('panels:fold.step.flat', 'Flat')}
        kind="static"
        divider={false}
        help={t(
          'panels:fold.step.flatHelp',
          'Folded once and unfolded: these lie flat now, and remember which way they went.'
        )}
      >
        {creases.flat}
      </FieldRow>
    </CollapsibleSection>
  );
}

/** The fold in progress: its sentence and what committing it would change. */
function PendingFold({ pending }: { pending: FoldPendingFold }) {
  const { t } = useTranslation();
  return (
    <CollapsibleSection title={t('panels:fold.step.pending', 'Pending fold')} collapsible defaultOpen>
      <p className={styles.pendingSentence}>{foldStepSentence(t, pending.words)}</p>
      {pending.refused ? (
        <p className={styles.pendingSentence}>
          {t('panels:fold.step.pendingRefused', 'Resolve the issue in the tool window to see the creases it makes.')}
        </p>
      ) : (
        pending.diff && (
          <ul className={styles.pendingChanges}>
            {creaseDiffLines(t, pending.diff, pending.words).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )
      )}
    </CollapsibleSection>
  );
}
