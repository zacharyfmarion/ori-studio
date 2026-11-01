import { SpreadPresentationRow } from './SpreadPresentationRow';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DiagramPoseAction } from '../../diagram/actions/diagramPoseActions';
import type { DiagramLinkedPoseAction } from '../../diagram/actions/diagramLinkedPoseActions';
import type {
  DiagramStepLayerOrderEntry,
  DiagramStepLayerOrderRow,
} from '../../diagram/actions/diagramStepLayerOrderActions';
import { useOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import { useDiagramFoldStepPose } from '../../diagram/fold/useDiagramFoldStepPose';
import { isLockedStep, type DiagramStep } from '../../diagram/document/diagramDocument';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { useReferencesStepWays } from '../../diagram/references/useReferencesStepWays';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LayerSpreadRows } from '../paper/LayerSpreadRows';
import { DiagramWayRow } from './DiagramWayChooser';
import type { ControlVerb } from '../../lib/controlVerb';
import { Button } from '../ui/Button';
import { Pager } from '../ui/Pager';
import { FieldRow, NumberRow, SegmentedRow } from '../ui/fieldRows';
import styles from './DiagramStepPose.module.css';

/** A side to show, and the verb that turns the picture over to the other one. */
interface SideChoice {
  side: 'front' | 'back';
  /** Turn Over: absent where the picture has no other side to show. */
  turnOver: { disabled: boolean; waiting?: boolean; hint?: string; run: () => void } | undefined;
}

/**
 * The Step pane's Pose section, while the step is open in Pose (D13): how the
 * step's picture is posed. The verbs that pose it are the detail's toolbar's;
 * here are the facts, and the two a field says better than a button:
 *
 * - **An upload:** its turn and whether it is flipped.
 * - **A step sent from References:** which side of the paper it shows, Front
 *   or Back.
 * - **A linked pattern:** for a crease pattern or a flat fold, its turn as a
 *   field (D5's angle field); a fold's side, Front or Back; a flat fold's
 *   layer order and its spread layers (Phase 13): on or off, and while on,
 *   by depth or affine and how. Its verbs are the open step's own pose controller's
 *   (`useOpenLinkedPose`): one capture session per step, whichever surface
 *   asks. How it is shown is Show as, at the top of the pane (D19).
 * - **A Fold step:** the same, but its layer order, which is the sequence's
 *   (`useDiagramFoldStepPose`; plan D17).
 *
 * Enlarged is not Pose's (Zach's review of #436, 2026-10-08): Pose draws an
 * enlarged step's frame, and Annotate's Step pane turns it on and sets it
 * (`DiagramStepEnlarged`).
 *
 * In a section of its own, or nothing for a step with nothing to say here.
 * `main` gives the main rows alone, for a section of the caller's — the Pages
 * view's Layers inspector (Zach, 2026-10-19): a References step's way and
 * side, and a linked pattern's turn and side; not an upload's facts, nor a
 * flat fold's layer order and spread, which are Pose's.
 */
export function DiagramStepPose({
  step,
  actions,
  layerOrder = null,
  main = false,
}: {
  step: DiagramStep;
  /** An upload's or a References step's pose verbs (`useDiagramPoseActions`). */
  actions: readonly DiagramPoseAction[];
  /** A folded linked step's way into the Layer order dialog, and its note (`useDiagramStepLayerOrder`). */
  layerOrder?: DiagramStepLayerOrderRow | null;
  main?: boolean;
}) {
  const { t } = useTranslation();
  const linkedPose = useOpenLinkedPose(step.id);
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  // A References step's ways to fold its card (D23).
  const ways = useReferencesStepWays(step);
  // A Fold step's angle and spread (plan D17).
  const foldPose = useDiagramFoldStepPose(isLockedStep(step) ? null : step);
  const layerOrderLabelId = useId();
  if (isLockedStep(step)) return null;
  const section = (body: ReactNode) =>
    main ? (
      <div className={styles.pose}>{body}</div>
    ) : (
      <CollapsibleSection title={t('panels:diagram.stepPane.pose', 'Pose')}>
        <div className={styles.pose}>{body}</div>
      </CollapsibleSection>
    );
  const sideRow = ({ side, turnOver }: SideChoice) => (
    <SegmentedRow
      label={t('panels:diagram.pose.side', 'Side')}
      value={side}
      options={[
        { id: 'front', label: t('panels:diagram.pose.front', 'Front') },
        { id: 'back', label: t('panels:diagram.pose.back', 'Back') },
      ]}
      disabled={!turnOver || turnOver.disabled}
      title={turnOver?.hint}
      onChange={(next) => {
        // Waiting for a capture, the choice refuses, as the verb would.
        if (next !== side && turnOver && !turnOver.waiting) turnOver.run();
      }}
    />
  );

  const { source } = step;
  if (source?.kind === 'upload') {
    if (main) return null;
    return section(
      <>
        <FieldRow label={t('panels:diagram.pose.rotation', 'Rotation')} kind="text">
          {t('panels:diagram.pose.degrees', '{{degrees}}° clockwise', {
            degrees: source.rotationQuarterTurns * 90,
          })}
        </FieldRow>
        <FieldRow label={t('panels:diagram.pose.flipped', 'Flipped')} kind="text">
          {source.mirrored ? t('panels:diagram.pose.yes', 'Yes') : t('panels:diagram.pose.no', 'No')}
        </FieldRow>
      </>
    );
  }

  if (source?.kind === 'references-step' && step.picture?.kind === 'step-diagram') {
    return section(
      <>
        <DiagramWayRow choice={ways} readOnly={readOnly} />
        {sideRow({
          side: step.picture.mirrored ? 'back' : 'front',
          turnOver: actions.find((action) => action.id === 'turn-over'),
        })}
      </>
    );
  }

  if (source?.kind === 'fold-step' && step.picture) {
    // A Fold step's pose is a capture from its state (plan D17): its turn, a
    // flat fold's side, and its layers spread (Phase 13). Its layer order is
    // the sequence's, never a choice.
    const { render } = source;
    const perspective=render.mode==='folded-flat'&&render.spread?.kind==='connected'&&render.presentation?.kind==='perspective';
    return section(
      <>
        {!perspective && (render.mode === 'crease-pattern' || render.mode === 'folded-flat') && foldPose && (
          <RotationRow turn={render.rotationDeg} disabled={foldPose.turnHeld} onCommit={foldPose.rotateTo} />
        )}
        {render.mode === 'folded-flat' && !perspective &&
          sideRow({ side: render.side, turnOver: actions.find((action) => action.id === 'turn-over') })}
        {render.mode === 'folded-flat' && foldPose && (
          <>
          <LayerSpreadRows revealVisible={!perspective} toggle={foldPose.spreadToggle} spread={foldPose.spread} />
          {render.spread?.kind === 'connected' && <SpreadPresentationRow key={step.id} value={render.presentation?.kind ?? 'diagram'} onChange={foldPose.setPresentation} disabled={foldPose.presentationHeld} />}
          </>
        )}
      </>
    );
  }

  if (source?.kind !== 'cp' || !linkedPose) return null;
  const { render } = source;
  const perspective=render.mode==='folded-flat'&&render.spread?.kind==='connected'&&render.presentation?.kind==='perspective';
  const linked = linkedPose.actions;
  const turn = render.mode === 'crease-pattern' || render.mode === 'folded-flat' ? render.rotationDeg : null;
  const turnHeld = linked.find((action: DiagramLinkedPoseAction) => action.id === 'rotate-left')?.disabled ?? true;
  const waiting = linked.some((action) => action.waiting);
  const turnOver = linked.find((action) => action.id === 'turn-over');
  const side = render.mode === 'folded-flat' || render.mode === 'folded-3d' ? render.side : null;
  if (turn === null && side === null) return null;
  return section(
    <>
      {turn !== null && !perspective && (
        // Held as the turn verbs are: on a diagram that cannot change, or while a capture runs.
        <RotationRow turn={turn} disabled={turnHeld || waiting} onCommit={linkedPose.rotateTo} />
      )}
      {side !== null && !perspective && sideRow({ side, turnOver })}
      {(render.mode === 'folded-flat' || (render.mode === 'folded-3d' && layerOrder)) && !main && (
        // Any layer order found, back or on (D23), as Pose's own pager has them; then the
        // Layer order dialog, always there so the pager never moves (H7, D13). The pager
        // is named by the row's label, so "Layer order" is said once.
        <FieldRow
          label={t('panels:diagram.pose.layerOrder', 'Layer order')}
          labelId={layerOrderLabelId}
          kind="text"
          disabled={layerOrder?.edit.disabled}
          note={layerOrder?.note?.text}
          noteKind={layerOrder?.note?.kind}
        >
          <span className={styles.layerOrder}>
            {render.mode === 'folded-flat' && (
              <Pager
                labelledBy={layerOrderLabelId}
                previous={layerVerb(linked.find((action) => action.id === 'previous-solution'))}
                next={layerVerb(linked.find((action) => action.id === 'next-solution'))}
              >
                {source.layerOrder === undefined ? (
                  (linkedPose.layerOrder?.count ?? render.foldCase)
                ) : linkedPose.layerOrder ? (
                  // Where it stands among the solutions that fit its record, once a press asked (H9).
                  linkedPose.layerOrder.count
                ) : (
                  // At rest the host never counts (D11): its place is kept, unread, so the chevrons
                  // stay where a count puts them.
                  <span className={styles.reserved} data-reserved="" aria-hidden="true">
                    {t('panels:diagram.pose.layerOrderOf', '{{number}} of {{total}}', { number: 1, total: 1 })}
                  </span>
                )}
              </Pager>
            )}
            {layerOrder && <LayerOrderEntry entry={layerOrder.edit} />}
          </span>
        </FieldRow>
      )}
      {render.mode === 'folded-flat' && !main && (
        // Its layers spread apart (Phase 13): on or off, by depth or affine (13g), and how.
        <>
        <LayerSpreadRows revealVisible={!perspective} toggle={linked.find((action) => action.id === 'spread-layers')} spread={linkedPose.spread} />
        {render.spread?.kind === 'connected' && <SpreadPresentationRow key={step.id} value={render.presentation?.kind ?? 'diagram'} onChange={linkedPose.setPresentation} disabled={readOnly || step.annotations.some((annotation) => !!annotation.unknown)} />}
        </>
      )}
    </>
  );
}

/**
 * A crease pattern's or a flat fold's turn as a field (D5's angle field), a
 * linked pattern's and a Fold step's alike: any angle, to a tenth of a
 * degree (Zach, 2026-10-05) — a 22.5° design stands at 157.5°.
 */
function RotationRow({
  turn,
  disabled,
  onCommit,
}: {
  turn: number;
  disabled: boolean;
  onCommit: (degrees: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <NumberRow
      // A new field for each turn the step lands on: a draft never outlives it.
      key={turn}
      label={t('panels:diagram.pose.rotation', 'Rotation')}
      value={turn}
      min={0}
      max={359.9}
      step={15}
      suffix="°"
      disabled={disabled}
      normalize={(degrees) => ((Math.round(degrees * 10) / 10) % 360 + 360) % 360}
      onCommit={onCommit}
    />
  );
}

/**
 * A way into the Layer order dialog, as a word button (no icon says "layer
 * order"): refused rather than disabled, so it keeps the focus a press gave
 * it, and says why on hover.
 */
function LayerOrderEntry({ entry }: { entry: DiagramStepLayerOrderEntry }) {
  const held = entry.disabled || entry.waiting;
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={entry.name}
      title={held && entry.hint ? entry.hint : entry.name}
      aria-disabled={held || undefined}
      onClick={entry.run}
    >
      {entry.label}
    </Button>
  );
}

/**
 * One of a flat fold's layer order verbs, for the pager: refused rather than
 * disabled while a capture runs or at either end, so it keeps the focus a
 * press gave it.
 */
function layerVerb(action: DiagramLinkedPoseAction | undefined): ControlVerb | undefined {
  if (!action) return undefined;
  return {
    label: action.label,
    disabled: action.disabled || action.waiting,
    hint: action.hint,
    run: action.run,
  };
}
