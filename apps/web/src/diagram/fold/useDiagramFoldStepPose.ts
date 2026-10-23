import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  spreadSliderEdit,
  type LayerSpreadDrag,
  type SpreadSlider,
} from '../../cp-workspace/folded/layerSpreadControls';
import { withSpreadField, type LayerSpreadEdit } from '../../cp-workspace/folded/layerSpreadSettings';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { loadedFold, loadFold } from '../../workspaces/foldGateway';
import {
  buildDiagramLinkedPoseActions,
  buildDiagramSpreadControls,
  type DiagramLinkedPoseAction,
  type DiagramLinkedPoseState,
} from '../actions/diagramLinkedPoseActions';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import type { DiagramFoldStepSource, DiagramScenePicture, DiagramStep } from '../document/diagramDocument';
import type { FoldStepCaptureInput } from './foldStepCapture';
import { rotateDiagramFoldStepTo, spreadDiagramFoldStep } from './foldStepActions';

/**
 * Pose for a Diagram step linked to a Fold step (plan D17), beyond the
 * toolbar's turns: its flat fold's layers spread (Phase 13) — Spread Layers
 * on or off, its kind and values, the rows the linked pattern's Pose section
 * lays out — and its turn to any angle. Each is a capture from the step's
 * Fold state (`foldStepActions.ts`), one undo step, and none changes the
 * link's status: a pose is not an edit upstream.
 *
 * A slider's drag shows the picture before it is committed, as a linked
 * pattern's does: the states the picture is made from are read once from the
 * Fold session as the drag starts, and each move draws the picture again
 * from them with no call to the engine; the drag's end captures it. The Step
 * pane, which has the sliders, and the step detail, which shows the picture,
 * each call this; the drag and what it is drawn from are shared between them.
 * Reading them is Fold's code (`foldGateway`), loaded as the first drag
 * starts: until it has been read there is nothing to draw from.
 *
 * Null for a step that is not a Fold step's.
 */
export interface DiagramFoldStepPose {
  /** Spread Layers, the pose verb: absent unless the step shows a flat fold. */
  spreadToggle: DiagramLinkedPoseAction | undefined;
  /** The spread's kind and values while the layers are spread; null while they are not. */
  spread: LayerSpreadDrag | null;
  /** Turn its crease pattern or flat fold to an angle, in degrees clockwise. */
  rotateTo: (degrees: number) => void;
  /** Whether the angle cannot be changed now: a read-only diagram, marks a newer build made, or a capture running. */
  turnHeld: boolean;
  /** The step as a slider's drag shows it, for the detail to show in its place; null when nothing is previewed. */
  preview: DiagramStep | null;
}

/** The drag in progress, if any: one at a time, wherever its slider is. */
interface FoldSpreadDrag {
  stepId: string;
  /** Which picture the drag is of: a new capture of the step ends it. */
  key: string;
  /** Each slider dragged and where to, the newest last: the step's spread with each applied is what it shows. */
  slides: Map<SpreadSlider, LayerSpreadEdit>;
  /** The spread shown. */
  spread: LayerSpreadOptions;
  /** The picture drawn with it; null until what it is drawn from is read. */
  picture: DiagramScenePicture | null;
}

let drag: FoldSpreadDrag | null = null;
const listeners = new Set<() => void>();
/** What each step's picture is drawn from, by {@link pictureKey}: read once a drag starts. */
const inputs = new Map<string, FoldStepCaptureInput | 'reading'>();
/** The captures a drag's ends asked for, one after another, so none is refused as busy. */
let committing: Promise<unknown> = Promise.resolve();

function publish(next: FoldSpreadDrag | null): void {
  drag = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which picture a Fold step shows: its state and moment — and a run's last step — which a pose leaves as they are. */
function pictureKey(stepId: string, source: DiagramFoldStepSource): string {
  return JSON.stringify([stepId, source.sequence, source.step, source.through ?? null, source.moment, source.path, source.state]);
}

/** The picture `source` would show with `spread`, from what it is drawn from; null when that is not read yet. */
function drawWith(key: string, source: DiagramFoldStepSource, spread: LayerSpreadOptions): DiagramScenePicture | null {
  const input = inputs.get(key);
  // An input is only ever read once Fold's code has loaded (`readInput`).
  const fold = loadedFold();
  if (!fold || !input || input === 'reading' || source.render.mode !== 'folded-flat') return null;
  const { captured } = fold.foldStepPicture(input.picture, { ...source.render, spread });
  return captured.kind === 'picture' && captured.picture.kind === 'scene' ? captured.picture : null;
}

/**
 * Commit the drag of `key`'s picture: each slider's newest value, captured
 * once the captures before it land, so none is refused as busy. The preview
 * comes down once it has landed, unless a newer drag began meanwhile.
 */
function commitDrag(key: string, stepId: string): void {
  const ended = drag?.key === key ? drag : null;
  if (!ended) return;
  const edits = [...ended.slides.values()];
  committing = committing
    .then(async () => {
      for (const edit of edits) await spreadDiagramFoldStep(stepId, edit);
    })
    .finally(() => {
      if (drag === ended) publish(null);
    });
}

/** How many steps' pictures are kept to draw drags from: the few a session poses. */
const INPUTS_KEPT = 8;

/** Read what the step's picture is drawn from, once, and draw the drag again with it when it comes. */
function readInput(key: string, source: DiagramFoldStepSource, t: TFunction): void {
  if (inputs.has(key)) return;
  // The oldest let go first: a Map keeps the order its keys came in.
  if (inputs.size >= INPUTS_KEPT) inputs.delete(inputs.keys().next().value!);
  inputs.set(key, 'reading');
  void loadFold()
    .then((fold) => {
      const session = fold.foldSession();
      const release = session.retain();
      return fold.readFoldStepCapture(session, source, t).finally(release);
    })
    .then((read) => {
      if (read.status !== 'ready') {
        inputs.delete(key);
        return;
      }
      inputs.set(key, read.input);
      if (drag?.key === key) publish({ ...drag, picture: drawWith(key, source, drag.spread) });
    })
    .catch(() => inputs.delete(key));
}

/** The step's Fold source, if it is a Fold step's and this build may pose it. */
function foldSource(step: DiagramStep | null): DiagramFoldStepSource | null {
  return step && !step.unknown && step.source?.kind === 'fold-step' ? step.source : null;
}

export function useDiagramFoldStepPose(step: DiagramStep | null): DiagramFoldStepPose | null {
  const { t } = useTranslation();
  const source = foldSource(step);
  const stepId = source ? step!.id : null;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const busy = useWorkspaceStore((state) => stepId !== null && Object.hasOwn(state.diagramCaptures, stepId));
  const assets = useWorkspaceStore((state) => state.diagram?.assets);
  const dragged = useSyncExternalStore(subscribe, () => drag);
  const unknownMarks = step?.annotations.some((annotation) => annotation.unknown !== undefined) ?? false;
  const key = source && stepId ? pictureKey(stepId, source) : null;
  // A drag of this picture: one of another step, or of this step before a
  // capture changed what it shows, is not this one's.
  const ours = dragged && dragged.key === key ? dragged : null;

  const poseState = useMemo(
    (): DiagramLinkedPoseState | null =>
      source
        ? {
            render: source.render,
            readOnly,
            busy,
            solutions: null,
            // A flat fold drawn see-through has no layers to spread.
            seeThrough: source.render.mode === 'folded-flat' && step?.picture?.kind === 'fixed',
          }
        : null,
    [source, readOnly, busy, step?.picture?.kind]
  );

  const annotationsHint = t(
    'panels:diagram.pose.annotationsHint',
    'Its annotations were made with a newer Ori Studio, which could not turn with it'
  );
  const spreadToggle = useMemo((): DiagramLinkedPoseAction | undefined => {
    if (!poseState || stepId === null || poseState.render.mode !== 'folded-flat') return undefined;
    const toggle = buildDiagramLinkedPoseActions(poseState, {
      t,
      pose: () => void spreadDiagramFoldStep(stepId, { verb: 'spread-layers' }),
    }).find((action) => action.id === 'spread-layers');
    // Marks a newer build made could not go with the paper.
    return toggle && unknownMarks ? { ...toggle, disabled: true, waiting: false, hint: annotationsHint } : toggle;
  }, [poseState, stepId, t, unknownMarks, annotationsHint]);

  const spread = useMemo((): LayerSpreadDrag | null => {
    if (!poseState || !source || stepId === null || key === null) return null;
    const controls = buildDiagramSpreadControls(poseState, ours?.spread ?? null, {
      t,
      kind: (kind) => void spreadDiagramFoldStep(stepId, { verb: 'spread-kind', kind }),
      direction: (toward) => void spreadDiagramFoldStep(stepId, { verb: 'spread-direction', toward }),
      keep: (keep) => void spreadDiagramFoldStep(stepId, { verb: 'spread-keep', keep }),
    });
    if (!controls) return null;
    const held = controls.disabled || unknownMarks;
    return {
      ...controls,
      ...(unknownMarks ? { disabled: true, hint: annotationsHint } : {}),
      start: () => {
        if (held) return false;
        readInput(key, source, t);
        return true;
      },
      preview: (slider, value) => {
        const stored = source.render.mode === 'folded-flat' ? source.render.spread : undefined;
        if (held || !stored) return;
        readInput(key, source, t);
        const slides = new Map(drag?.key === key ? drag.slides : []);
        slides.delete(slider);
        slides.set(slider, spreadSliderEdit(slider, stored.kind, value));
        const shown = [...slides.values()].reduce(withSpreadField, stored);
        publish({ stepId, key, slides, spread: shown, picture: drawWith(key, source, shown) });
      },
      commit: () => commitDrag(key, stepId),
    };
  }, [poseState, source, stepId, key, ours, t, unknownMarks, annotationsHint]);

  const preview = useMemo((): DiagramStep | null => {
    if (!step || !source || !ours?.picture || source.render.mode !== 'folded-flat') return null;
    const shown: DiagramStep = {
      ...step,
      source: { ...source, render: { ...source.render, spread: ours.spread } },
      picture: ours.picture,
    };
    // Its marks on the paper they lie on, as they will be once it is captured.
    return withCarriedAnnotations(step, shown, assets ?? {});
  }, [step, source, ours, assets]);

  const rotateTo = useCallback(
    (degrees: number) => {
      if (stepId !== null && !busy && !readOnly && !unknownMarks) void rotateDiagramFoldStepTo(stepId, degrees);
    },
    [stepId, busy, readOnly, unknownMarks]
  );

  return useMemo(
    () =>
      source
        ? { spreadToggle, spread, rotateTo, turnHeld: readOnly || busy || unknownMarks, preview }
        : null,
    [source, spreadToggle, spread, rotateTo, readOnly, busy, unknownMarks, preview]
  );
}
