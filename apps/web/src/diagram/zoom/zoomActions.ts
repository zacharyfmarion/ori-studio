import type { TFunction } from 'i18next';
import {
  isLockedStep,
  isTurn,
  stepById,
  stepNumber,
  type DiagramDocument,
  type DiagramEntry,
} from '../document/diagramDocument';
import { lacksPaperFaces } from '../capture/stepPaperFaces';
import { FIT_ZOOM, type LayoutCell } from '../pages/diagramPageLayout';
import { anchorOnPaper, frameHoldsPaper } from './zoomAnchor';
import { areaSource, captureSource, zoomAreas } from './zoomCapture';
import { paperFacesOf } from './zoomImprint';
import { zoomIndex } from './zoomIndex';

/**
 * Enlarged steps' verbs (Revision 2, Controls), for every surface that offers
 * them: the Enlarged toggle (Annotate's Step pane), an area's Update Enlarged Steps, Pick and
 * Reset in the Anchor row, and the Go to verbs between an area and the steps
 * enlarged from it. React-free and store-free, as `foldedFigureActions.ts`
 * is: plain descriptors over plain state, a verb's gate and its words here
 * once, each surface drawing its own.
 */
export type ZoomActionId = 'enlarged' | 'update-enlarged-steps' | 'go-to-enlarged-step' | 'go-to-area' | 'pick-anchor' | 'reset-anchor';

export interface ZoomAction {
  id: ZoomActionId;
  label: string;
  /** What its tooltip says: what it does, or why it cannot. */
  hint: string;
  disabled: boolean;
  /** A toggle's state: Enlarged on, or Pick armed. */
  pressed?: boolean;
  /** Refused while a capture of the step runs: it keeps the focus, as Pose's verbs do. */
  waiting?: boolean;
  run: () => void;
}

/** What the Enlarged toggle reads of a step and the steps before it (Z2). */
export interface EnlargedState {
  /** The step is enlarged now. */
  on: boolean;
  /**
   * The step a capture would take its frame from — the nearest earlier step
   * with an area or a frame — by its number, and which it holds; null with none.
   */
  from: { number: number; frame: boolean } | null;
  /** The step holds enlarge areas of its own, which go when it is enlarged: a step is enlarged or holds areas, not both. */
  ownAreas: boolean;
  readOnly: boolean;
  /** A capture of the step, or the faces a capture needs, is being folded. */
  busy: boolean;
}

/** The Enlarged toggle for a step, from the diagram as it is; null for a turn, a newer build's step or none. */
export function enlargedState(
  document: DiagramDocument,
  stepId: string,
  { readOnly, busy = false }: { readOnly: boolean; busy?: boolean }
): EnlargedState | null {
  const step = stepById(document, stepId);
  if (!step || isLockedStep(step)) return null;
  const source = captureSource(document, stepId);
  const number = source ? stepNumber(document, source.step.id) : null;
  return {
    on: step.zoom !== undefined,
    from: source && number !== null ? { number, frame: 'zoom' in source } : null,
    ownAreas: zoomAreas(step).length > 0,
    readOnly,
    busy,
  };
}

const READ_ONLY = (t: TFunction) =>
  t('panels:diagram.actions.readOnlyHint', 'This diagram was made with a newer Ori Studio and opens read-only');

/**
 * Enlarged (Z2), a switch in Annotate's Step pane (Pose's until Zach's
 * review of #436, 2026-10-08): a pressed toggle, as Spread Layers is. Turned on it
 * captures a frame from the step it names; turned off the step shows its
 * whole picture again. Held, saying why, when no earlier step has an area or
 * a frame to capture from.
 */
export function buildEnlargedAction(
  state: EnlargedState,
  deps: { t: TFunction; enlarge: () => void; unenlarge: () => void }
): ZoomAction {
  const { t } = deps;
  const label = t('panels:diagram.pose.enlarged', 'Enlarged');
  const blocked = state.readOnly
    ? READ_ONLY(t)
    : !state.on && !state.from
      ? t('panels:diagram.pose.enlargeNone', 'No earlier step has an area to enlarge: draw one with Enlarge')
      : null;
  const hint =
    blocked ??
    (state.on
      ? t('panels:diagram.pose.enlargedOff', 'Show the whole picture again')
      : enlargeFromHint(t, state.from!, state.ownAreas));
  const disabled = blocked !== null;
  const waiting = !disabled && state.busy;
  return {
    id: 'enlarged',
    label,
    hint: waiting ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured') : hint,
    disabled,
    waiting,
    pressed: state.on,
    run: () => {
      if (disabled || waiting) return;
      if (state.on) deps.unenlarge();
      else deps.enlarge();
    },
  };
}

/** Where turning Enlarged on captures from, as its tooltip says it: the step, and whether its own areas go. */
function enlargeFromHint(t: TFunction, from: { number: number; frame: boolean }, ownAreas: boolean): string {
  const { number } = from;
  if (from.frame) {
    return ownAreas
      ? t(
          'panels:diagram.pose.enlargeFromFrameRemoving',
          'Enlarge from step {{number}}’s frame, and remove this step’s own enlarge area',
          { number }
        )
      : t('panels:diagram.pose.enlargeFromFrame', 'Enlarge from step {{number}}’s frame', { number });
  }
  return ownAreas
    ? t(
        'panels:diagram.pose.enlargeFromAreaRemoving',
        'Enlarge from step {{number}}’s area, and remove this step’s own enlarge area',
        { number }
      )
    : t('panels:diagram.pose.enlargeFromArea', 'Enlarge from step {{number}}’s area', { number });
}

/** The steps an area has been enlarged on, by provenance (Z7) wherever they sit: their ids and numbers, in order. */
export function stepsEnlargedFrom(document: DiagramDocument, areaId: string): { id: string; number: number }[] {
  const ids = zoomIndex(document).stepsByArea.get(areaId) ?? [];
  return ids.flatMap((id) => {
    const number = stepNumber(document, id);
    return number === null ? [] : [{ id, number }];
  });
}

/** The step an enlarged step's area is on, while it is in the diagram: its id and number. */
export function areaStepOf(document: DiagramDocument, stepId: string): { id: string; number: number } | null {
  const step = stepById(document, stepId);
  const source = step?.zoom ? areaSource(document, step.zoom.from) : null;
  const number = source ? stepNumber(document, source.step.id) : null;
  return source && number !== null ? { id: source.step.id, number } : null;
}

/** "Step 56", or "steps 56–60": the steps an area enlarged, as a row's subtitle says them. */
export function areaSubtitle(t: TFunction, steps: readonly { number: number }[]): string {
  if (steps.length === 0) return t('panels:diagram.annotations.enlargedNone', 'No step is enlarged from it');
  const first = steps[0]!.number;
  const last = steps[steps.length - 1]!.number;
  return first === last
    ? t('panels:diagram.annotations.enlargedOnStep', 'Enlarged on step {{number}}', { number: first })
    : t('panels:diagram.annotations.enlargedOnSteps', 'Enlarged on steps {{first}}–{{last}}', { first, last });
}

/** Where an enlarged step's frame came from, as its row's subtitle says it. */
export function frameSubtitle(t: TFunction, areaStep: { number: number } | null): string {
  return areaStep
    ? t('panels:diagram.annotations.frameFromArea', 'From step {{number}}’s area', { number: areaStep.number })
    : t('panels:diagram.annotations.frameFromGone', 'From an area no longer in the diagram');
}

/**
 * An area's verbs (Z7): Update Enlarged Steps, which captures again every step
 * with its provenance as one undo step — held, saying why, when none is, and
 * waiting while it folds the faces its captures need (`updating`) — and Go to
 * the first of them.
 */
export function buildAreaActions(
  state: { steps: readonly { id: string; number: number }[]; readOnly: boolean; updating?: boolean },
  deps: { t: TFunction; update: () => void; goTo: (stepId: string) => void }
): ZoomAction[] {
  const { t } = deps;
  const { steps } = state;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const blocked = state.readOnly
    ? READ_ONLY(t)
    : !first
      ? t('panels:diagram.annotations.updateNone', 'No step is enlarged from this area')
      : null;
  const hint =
    blocked ??
    (first!.number === last!.number
      ? t(
          'panels:diagram.annotations.updateOne',
          'Place the frame again on step {{number}} from this area as it is now, over any move made on it',
          { number: first!.number }
        )
      : t(
          'panels:diagram.annotations.updateRange',
          'Place the frame again on steps {{first}}–{{last}} from this area as it is now, over any move made on them',
          { first: first!.number, last: last!.number }
        ));
  const waiting = blocked === null && state.updating === true;
  const actions: ZoomAction[] = [
    {
      id: 'update-enlarged-steps',
      label: t('panels:diagram.annotations.updateEnlargedSteps', 'Update Enlarged Steps'),
      hint: waiting ? t('panels:diagram.actions.capturingHint', 'Its picture is being captured') : hint,
      disabled: blocked !== null,
      waiting,
      run: () => {
        if (blocked === null && !waiting) deps.update();
      },
    },
  ];
  if (first) {
    const label = t('panels:diagram.annotations.goToStep', 'Go to Step {{number}}', { number: first.number });
    actions.push({ id: 'go-to-enlarged-step', label, hint: label, disabled: false, run: () => deps.goTo(first.id) });
  }
  return actions;
}

/** A frame's verb: Go to the area it came from, on its step, while that is in the diagram. */
export function buildFrameActions(
  state: { areaStep: { id: string; number: number } | null },
  deps: { t: TFunction; goTo: (stepId: string) => void }
): ZoomAction[] {
  const { areaStep } = state;
  if (!areaStep) return [];
  const label = deps.t('panels:diagram.annotations.goToArea', 'Go to Area on Step {{number}}', { number: areaStep.number });
  return [{ id: 'go-to-area', label, hint: label, disabled: false, run: () => deps.goTo(areaStep.id) }];
}

/**
 * The Anchor row's verbs (Z9): Pick, which arms the pick mode on the canvas —
 * pressed while it is — and Reset, back to the default rule, while an anchor
 * is picked. Neither moves the frame on its own step. Pick only where there
 * is a canvas to pick on (`canvas`): a phone's Annotate has none.
 */
export function buildAnchorActions(
  state: { picked: boolean; picking: boolean; readOnly: boolean; canvas: boolean },
  deps: { t: TFunction; pick: () => void; reset: () => void }
): ZoomAction[] {
  const { t } = deps;
  const readOnly = state.readOnly ? READ_ONLY(t) : null;
  const actions: ZoomAction[] = [];
  if (state.canvas) {
    actions.push({
      id: 'pick-anchor',
      label: t('panels:diagram.annotations.anchorPick', 'Pick'),
      hint:
        readOnly ??
        (state.picking
          ? t('panels:diagram.annotations.anchorPicking', 'Click a face on the canvas to anchor to it; Escape to stop')
          : t('panels:diagram.annotations.anchorPickHint', 'Choose the face the frame is anchored to on the canvas')),
      disabled: readOnly !== null,
      pressed: state.picking,
      run: () => {
        if (readOnly === null) deps.pick();
      },
    });
  }
  if (state.picked) {
    actions.push({
      id: 'reset-anchor',
      label: t('panels:diagram.annotations.anchorReset', 'Reset'),
      hint: readOnly ?? t('panels:diagram.annotations.anchorResetHint', 'Anchor to the backmost face outside the frame again'),
      disabled: readOnly !== null,
      run: () => {
        if (readOnly === null) deps.reset();
      },
    });
  }
  return actions;
}

/** Whether a step id names a step of the diagram that is enlarged and shows a frame: what the frame's row and grips need. */
export function showsFrame(document: DiagramDocument, stepId: string): boolean {
  const entry = document.steps.find((each) => each.id === stepId);
  return entry !== undefined && !isTurn(entry) && !isLockedStep(entry) && entry.picture !== null && entry.zoom?.frame !== undefined;
}

/**
 * What places a frame again once its steps have their faces: Update Enlarged
 * Steps on the area, on the step named — or, with the area gone, Enlarged
 * turned off and on (null).
 */
export type ZoomRecapture = { update: number } | null;

/** What the Step pane says of an enlarged step (Revision 2, Controls): one of its notices. */
export type StepZoomNotice =
  /** The frame takes in none of the step's paper: its anchor face moved against what was framed. */
  | { kind: 'no-paper' }
  /** The anchor's paper point is not on this step's paper: the frame stayed where it was in picture units. */
  | { kind: 'anchor-off-paper' }
  /**
   * A flat capture older than its faces, which only a Refresh of that step
   * gives it (S5) — this step, or the area's while the frame is not anchored —
   * and then `then`, which places the frame again with them.
   */
  | { kind: 'refresh'; stepId: string; number: number; then: ZoomRecapture }
  /**
   * The frame is a copy in picture units on a step whose paper it could be
   * anchored to: its steps have their faces now, and `then` anchors it.
   */
  | { kind: 'unanchored'; then: ZoomRecapture };

/** An enlarged step as the Step pane and its card say it: where its frame came from, and what is wrong with it. */
export interface StepZoomStatus {
  /** The step its area is on, while it is in the diagram. */
  areaStep: { id: string; number: number } | null;
  /** A fixed Size, or null for Fill. */
  scale: number | null;
  notices: StepZoomNotice[];
}

/**
 * An enlarged step's status, from the diagram as it is; null for a step that
 * is not enlarged. `notices` reads the step's faces (`zoomAnchor.ts`) and its
 * frame: one with no imprint on a step whose paper it could be anchored to
 * is a copy in picture units, which a refresh of its steps does not place
 * again by itself. So a notice names the whole remedy — Refresh whichever of
 * this step and the area's is a flat capture made before steps kept their
 * faces, then capture again (`ZoomRecapture`) — and stays until the frame is
 * anchored.
 */
export function stepZoomStatus(document: DiagramDocument, stepId: string): StepZoomStatus | null {
  const step = stepById(document, stepId);
  if (!step?.zoom || isLockedStep(step)) return null;
  const areaStep = areaStepOf(document, stepId);
  const notices: StepZoomNotice[] = [];
  if (step.picture) {
    if (frameHoldsPaper(step) === false) notices.push({ kind: 'no-paper' });
    if (anchorOnPaper(step) === false) notices.push({ kind: 'anchor-off-paper' });
  }
  const then: ZoomRecapture = areaStep ? { update: areaStep.number } : null;
  const own = stepNumber(document, stepId);
  const area = areaStep ? stepById(document, areaStep.id) : null;
  const unanchored =
    step.picture !== null && step.zoom.imprint === undefined && (lacksPaperFaces(step) || paperFacesOf(step) !== null);
  const refreshes: { stepId: string; number: number }[] = [];
  if (lacksPaperFaces(step) && own !== null) refreshes.push({ stepId, number: own });
  if (unanchored && area && areaStep && lacksPaperFaces(area)) refreshes.push({ stepId: areaStep.id, number: areaStep.number });
  for (const refresh of refreshes) notices.push({ kind: 'refresh', ...refresh, then });
  if (unanchored && refreshes.length === 0) notices.push({ kind: 'unanchored', then });
  return { areaStep, scale: step.zoom.scale ?? null, notices };
}

/**
 * Each enlarged step's card chip (Revision 2, Controls): the number of the
 * step its area is on, or null once the area is gone from the diagram. Steps
 * that are not enlarged are not in it. One pass over the order.
 */
export function enlargedChips(entries: readonly DiagramEntry[]): ReadonlyMap<string, number | null> {
  const areaSteps = new Map<string, number>();
  const chips = new Map<string, number | null>();
  let number = 0;
  for (const entry of entries) {
    if (isTurn(entry)) continue;
    number += 1;
    if (isLockedStep(entry)) continue;
    for (const area of zoomAreas(entry)) areaSteps.set(area.id, number);
  }
  for (const entry of entries) {
    if (isTurn(entry) || isLockedStep(entry) || !entry.zoom) continue;
    chips.set(entry.id, areaSteps.get(entry.zoom.from) ?? null);
  }
  return chips;
}

/**
 * What an enlarged step prints at against its area, as the pages lay it out
 * (Z4, `LayoutCell.zoom`), as its read-outs say it: how many times the area
 * it prints — a fixed Size as it was typed, to two decimals (×1.25, not
 * ×1.3), and what Fill or a room makes of it to one; amber (`warn`) when a
 * fixed Size asked more than its room holds, or Fill comes out under a change
 * of size that reads as an enlargement ({@link FIT_ZOOM}) — the area takes in
 * too much. Null before the pages are laid out.
 */
export interface ZoomReadout {
  kind: 'prints' | 'room' | 'barely';
  /** The Size asked, for `room`. */
  asked: number | null;
  printed: number;
  warn: boolean;
}

export function zoomReadout(zoom: LayoutCell['zoom'] | null): ZoomReadout | null {
  if (!zoom) return null;
  const tenths = Math.round(zoom.printed * 10) / 10;
  const asked = zoom.asked === null ? null : Math.round(zoom.asked * 100) / 100;
  if (asked !== null && zoom.reduced) return { kind: 'room', asked, printed: tenths, warn: true };
  if (asked === null && zoom.printed < FIT_ZOOM) return { kind: 'barely', asked: null, printed: tenths, warn: true };
  // A fixed Size its room holds prints as typed.
  return { kind: 'prints', asked, printed: asked ?? tenths, warn: false };
}

/** A Size or a read-out's number as `language` writes it, to two decimals at most: 1.25, or 1,25 in German. */
export function zoomNumber(value: number, language: string): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value);
}

/**
 * A read-out in words, its numbers as `language` writes them: "Prints ×4.4",
 * "Asked ×3 · prints ×2.4 — the room is too small", "Prints only ×1.1 — draw
 * a smaller area".
 */
export function zoomReadoutText(t: TFunction, readout: ZoomReadout, language: string): string {
  const printed = zoomNumber(readout.printed, language);
  switch (readout.kind) {
    case 'room':
      return t('panels:diagram.annotations.enlargePrintsRoom', 'Asked ×{{asked}} · prints ×{{printed}} — the room is too small', {
        asked: readout.asked === null ? '' : zoomNumber(readout.asked, language),
        printed,
      });
    case 'barely':
      return t('panels:diagram.annotations.enlargePrintsBarely', 'Prints only ×{{printed}} — draw a smaller area', { printed });
    case 'prints':
      return t('panels:diagram.annotations.enlargePrints', 'Prints ×{{printed}}', { printed });
  }
}
