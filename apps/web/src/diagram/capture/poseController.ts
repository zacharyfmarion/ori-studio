import {
  trackDiagramPicturePosed,
  type DiagramPoseAction as TrackedPoseAction,
  type DiagramSpreadDirection,
} from '../../analytics';
import {
  ensureCpSegmentationArtifacts,
  peekCpSegmentationArtifacts,
} from '../../cp-workspace/cpSegmentationArtifacts';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import type { LayerSpreadOptions, SpreadDirection } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  foldedFigureHandleEpoch,
  releaseFoldedFigureHandle,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import type { FoldArtifacts } from '../../engine/types';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  beginStepCapture,
  captureFailure,
  endStepCapture,
  runStepFold,
  stepCaptureRuntime,
  storeSimulateFlat,
  type DiagramCaptureOutcome,
  type StepCaptureStart,
} from '../../store/workspaceStore/diagramCapture';
import {
  nearestEarlierSpread,
  stepById,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramScenePicture,
} from '../document/diagramDocument';
import { storedCpSource } from '../document/diagramFile';
import { isRelativeFingerprint } from '../../cp-workspace/regions/regionIdentity';
import {
  chooseStepCreases,
  creasesFingerprint,
  creasesMatch,
  followedScope,
  knownCreasesOf,
  type StepCreases,
} from './captureCreases';
import { CaptureSessionClosedError, createCaptureSession, type CaptureSession } from './captureSession';
import { creasesThumbnail } from './captureThumbnail';
import { abandonOnEngineLoss } from './engineLoss';
import { linkStatus } from './linkStatus';
import { lightingChanged } from '../pictures/lighting';
import { poseLinkedStep, type FlatSolutions, type LinkedPoseRequest } from './linkedPose';
import { captureKind, sayCaptureOutcome } from './stepCaptureActions';

/** How long the 3D view must rest before its camera is captured: one orbit, one undo step. */
export const ORBIT_SETTLE_MS = 450;

const TRACKED: Record<LinkedPoseRequest['verb'], TrackedPoseAction> = {
  'show-crease-pattern': 'show_crease_pattern',
  'show-folded': 'show_folded',
  'show-simulated': 'show_simulated',
  'rotate-left': 'rotate_left',
  'rotate-right': 'rotate_right',
  'turn-over': 'turn_over',
  'next-solution': 'next_solution',
  'previous-solution': 'previous_solution',
  'view-top': 'view_top',
  'view-front': 'view_front',
  'view-iso': 'view_iso',
  reset: 'reset',
  orbit: 'orbit',
  'rotate-to': 'rotate_to',
  simulate: 'simulate',
  // On, or off when the verb left none (`trackPose`).
  'spread-layers': 'spread_on',
  'spread-amount': 'spread_amount',
  'spread-direction': 'spread_direction',
};

/** The verbs that spread a flat fold's layers: they say how it is spread after them. */
const SPREAD_VERBS: ReadonlySet<LinkedPoseRequest['verb']> = new Set([
  'spread-layers',
  'spread-amount',
  'spread-direction',
]);

/**
 * A pose that changed the step's picture, counted: by its verb — Spread
 * Layers as on or off by what it left — and for a spread verb that left the
 * layers spread, the direction and the amount bucketed.
 */
function trackPose(verb: LinkedPoseRequest['verb'], render: DiagramCpRender): void {
  const spread = render.mode === 'folded-flat' ? render.spread : undefined;
  const action = verb === 'spread-layers' && !spread ? 'spread_off' : TRACKED[verb];
  const how =
    SPREAD_VERBS.has(verb) && spread ? { direction: trackedDirection(spread.toward), amount: spread.amount } : undefined;
  trackDiagramPicturePosed(action, captureKind(render), how);
}

function trackedDirection(toward: SpreadDirection): DiagramSpreadDirection {
  return toward.replace('-', '_') as DiagramSpreadDirection;
}

/** Where Pose's simulator came to rest, and the model there. */
export type SimulatedRest = Omit<Extract<LinkedPoseRequest, { verb: 'simulate' }>, 'verb'>;

/**
 * A spread shown before it is committed — under a drag of its amount — and
 * the step's picture with it, drawn from the fold the session holds; null
 * while no fold is held to draw it from.
 */
export interface SpreadPreview {
  spread: LayerSpreadOptions;
  picture: DiagramScenePicture | null;
}

/** The 3D fold the live view draws, held by the session. */
export interface DiagramPoseSpatialView {
  model: OristudioCpFolded3dRenderModel;
  aux: OristudioCpFolded3dAuxLines | null;
}

/**
 * What a controller tells its view as it learns it. Each fact comes with the
 * {@link linkedFoldKey} of the creases it was learnt from, so a view shows it
 * only while the step still links to them: a Relink or an undo moves the step
 * to other creases, and the fold held for the old ones is not theirs.
 */
export interface PoseControllerListener {
  /** The live 3D fold, once held; null when let go. */
  spatial: (view: DiagramPoseSpatialView | null, key: string | null) => void;
  /** The held flat fold's layer orders as the search knows them; null when unknown. */
  solutions: (solutions: FlatSolutions | null, key: string) => void;
  /** A spread previewed before it is committed; null when the preview ends. */
  preview: (preview: SpreadPreview | null, key: string | null) => void;
}

/** Which creases a step's fold is of: its scope and their fingerprint. */
export function linkedFoldKey(stepId: string, source: Pick<DiagramCpSource, 'scope' | 'fingerprint'>): string {
  return JSON.stringify([stepId, source.scope, source.fingerprint]);
}

/**
 * Pose for one linked step (D4, D5), bound to the store: each verb captured
 * and committed as one undo step, as an upload's pose verbs are, so there is
 * never a pose waiting to be captured and every way out of the detail is the
 * same. Between verbs the fold is held open by a capture session.
 *
 * React-free: `useDiagramLinkedPose` makes one per open step and disposes it.
 */
export interface PoseController {
  /**
   * `tracked: false` for a verb counted by its own surface — Show as from the
   * Step pane or a card, which `diagram step shown as` counts — so it is not
   * also counted as a pose.
   */
  run: (request: LinkedPoseRequest, options?: { tracked?: boolean }) => Promise<void>;
  /** The 3D view moved: capture it once it rests, if it is not where the step already is. */
  orbit: (camera: FoldedFigureCamera, stored: FoldedFigureCamera | null) => void;
  /**
   * Pose's simulator came to rest (D19): capture the model where it is, if
   * that is not the picture the step already has — another fold % or camera,
   * creases changed since, or another light. Nothing for a step no longer
   * shown Simulated: the rest was of a view it has left.
   */
  simulate: (rest: SimulatedRest) => Promise<void>;
  /**
   * Whether a rest at this pose would be captured now: the step is shown
   * Simulated, and the pose is not the picture it has, or that picture is out
   * of date. Asked before a rest's scene is drawn, so a rest that would be
   * dropped costs the worker nothing.
   */
  wantsRest: (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => boolean;
  /** Fold a step shown in 3D for its live view. */
  prepareSpatial: () => Promise<void>;
  /**
   * Show the step's flat fold with this spread before it is committed — a
   * drag of its amount: drawn from the fold the session holds, with no call
   * to the kernel, or once one is held (the first preview folds it).
   */
  previewSpread: (spread: LayerSpreadOptions) => void;
  /**
   * Commit the amount previewed — the end of a drag, or a key — as one undo
   * step. The newest wins: one waits while another is captured, and a newer
   * one takes its place. The preview ends once it lands, unless a newer one
   * was asked for meanwhile.
   */
  commitSpread: () => Promise<void>;
  /** An undo or redo: stop what is still folding for a source the step no longer has. */
  historyMoved: () => void;
  /** The crease pattern replaced: its handle went with it. */
  documentReplaced: () => void;
  /** The engine is gone: forget the fold without freeing it, since its slots are reused. */
  engineLost: () => void;
  dispose: () => void;
}

const store = { get: useWorkspaceStore.getState, set: useWorkspaceStore.setState };

export function createPoseController(stepId: string, listener: PoseControllerListener): PoseController {
  let start: StepCaptureStart | null = null;
  let orbitTimer: ReturnType<typeof setTimeout> | null = null;
  /** The simulator's rests: the one being captured, and the newest waiting for it. */
  let simulating: Promise<void> | null = null;
  let nextRest: SimulatedRest | null = null;
  /**
   * The creases, of which crease pattern, the session's flat fold was last
   * posed for: what a preview may be drawn from. The session checks its side,
   * layer order and the pattern; this, that the step still links to them.
   */
  let heldFor: { key: string; document: OristudioCpDocumentSnapshot } | null = null;
  /** The newest spread previewed, and how many have been: a commit ends the preview only if none came after. */
  let previewing: LayerSpreadOptions | null = null;
  let previews = 0;
  /** A fold held for a preview, while it folds. */
  let holding: Promise<unknown> | null = null;
  /** This controller's own capture in flight: a spread commit waits for it rather than being refused as busy. */
  let own: Promise<unknown> | null = null;
  /** The spread commits: the one being captured, and the newest amount waiting for it. */
  let spreading: Promise<void> | null = null;
  let nextAmount: number | null = null;
  const session: CaptureSession = createCaptureSession({
    search: (work) => {
      if (!start) throw new Error('A pose fold ran outside a capture');
      return runStepFold(store, start, 'diagram-capture', work);
    },
    runtime: () => {
      if (!start) throw new Error('A pose read ran outside a capture');
      return stepCaptureRuntime(start);
    },
    retain: retainFoldedFigureHandle,
    release: releaseFoldedFigureHandle,
    epoch: foldedFigureHandleEpoch,
  });

  /** Run kernel work as this step's capture: marked capturing, its fold stoppable. */
  const capturing = <T>(
    work: (begun: StepCaptureStart, linked: DiagramCpSource) => Promise<T>
  ): Promise<T | DiagramCaptureOutcome | null> => {
    const task = (async (): Promise<T | DiagramCaptureOutcome | null> => {
      const linked = currentLinkedSource(stepId);
      if (!linked) return null;
      const begun = beginStepCapture(store, stepId);
      if ('status' in begun) return begun;
      start = begun;
      try {
        return await work(begun, linked);
      } catch (error) {
        // The detail closed, or a newer verb took over, while this folded.
        if (error instanceof CaptureSessionClosedError) return { status: 'discarded' };
        return captureFailure(error);
      } finally {
        start = null;
        endStepCapture(store, stepId);
      }
    })();
    own = task;
    const settled = () => {
      if (own === task) own = null;
    };
    task.then(settled, settled);
    return task;
  };

  const creasesFor = async (begun: StepCaptureStart, linked: DiagramCpSource) => {
    const document = begun.cp.document;
    const segmentation = await abandonOnEngineLoss(ensureCpSegmentationArtifacts(document));
    return {
      document,
      segmentation,
      choice: chooseStepCreases(document, linked.scope, segmentation, knownCreasesOf(linked)),
    };
  };

  const run = async (request: LinkedPoseRequest, options?: { tracked?: boolean }): Promise<void> => {
    const outcome = await capturing(async (begun, linked): Promise<DiagramCaptureOutcome> => {
      // Shown another way since the simulator came to rest: an undo, or a verb.
      if (request.verb === 'simulate' && linked.render.mode !== 'simulated') return { status: 'discarded' };
      const { document, segmentation, choice } = await creasesFor(begun, linked);
      if (choice.status !== 'found') return choice;
      if (!segmentation) return { status: 'unknown' };
      const result = await abandonOnEngineLoss(
        poseLinkedStep(
          session,
          {
            document,
            creases: choice.creases,
            render: linked.render,
            remembered: linked.remembered,
            style: begun.style,
            simulateFlat: storeSimulateFlat({ get: useWorkspaceStore.getState, set: useWorkspaceStore.setState }),
            spreadStart: spreadStartOf(stepId),
          },
          request
        )
      );
      if (result.status === 'refused' || result.status === 'unavailable') return result;
      const source = linkedSource(linked, choice.creases, segmentation, result.render);
      const committed = await useWorkspaceStore
        .getState()
        .commitDiagramCapture(begun, { source, picture: result.picture }, 'Adjust pose');
      if (!committed) return { status: 'discarded' };
      if (committed.changed && options?.tracked !== false) trackPose(request.verb, result.render);
      const key = linkedFoldKey(stepId, source);
      // What a preview may draw from: the flat fold just posed, of these creases.
      heldFor = result.render.mode === 'folded-flat' ? { key, document } : null;
      listener.solutions(result.solutions ?? null, key);
      if (result.spatial) listener.spatial({ model: result.spatial.fold.render, aux: result.spatial.aux }, key);
      return {
        status: 'captured',
        changed: committed.changed,
        render: result.render,
        noLayerOrder: result.noLayerOrder,
        tooDetailed: committed.tooDetailed,
      };
    });
    if (!outcome || !('status' in outcome)) return;
    // Only what is news: a see-through fold says so as it is first folded.
    const repeated = outcome.status === 'captured' && outcome.noLayerOrder && request.verb !== 'show-folded';
    if (!repeated) sayCaptureOutcome(outcome);
  };

  const wantsRest = (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>): boolean => {
    const linked = currentLinkedSource(stepId);
    if (linked?.render.mode !== 'simulated') return false;
    return !sameSimulatedPose(linked.render, pose) || needsRecapture(stepId, linked);
  };

  const cancelOrbit = () => {
    if (orbitTimer) clearTimeout(orbitTimer);
    orbitTimer = null;
  };

  /**
   * The step's flat fold with a spread, from the fold the session holds: the
   * picture, or null when it cannot be drawn cheaply (past the budget, or a
   * fold with no layer order) — the commit draws it — or undefined when no
   * fold of these creases is held.
   */
  const drawPreview = (spread: LayerSpreadOptions): DiagramScenePicture | null | undefined => {
    const linked = currentLinkedSource(stepId);
    const document = useWorkspaceStore.getState().oristudioCpDocument?.document;
    if (linked?.render.mode !== 'folded-flat' || !document) return null;
    if (heldFor?.key !== linkedFoldKey(stepId, linked) || heldFor.document !== document) return undefined;
    const { side, foldCase, rotationDeg } = linked.render;
    const drawn = session.heldFlatPicture({ document, side, foldCase }, rotationDeg, spread);
    if (!drawn) return undefined;
    return drawn.kind === 'picture' && drawn.picture.kind === 'scene' ? drawn.picture : null;
  };

  /** Tell the view the newest preview; fold for it, once, when nothing is held to draw it from. */
  const showPreview = (hold: boolean) => {
    const linked = currentLinkedSource(stepId);
    if (!previewing || !linked) return;
    const picture = drawPreview(previewing);
    listener.preview({ spread: previewing, picture: picture ?? null }, linkedFoldKey(stepId, linked));
    if (picture === undefined && hold) holdForPreview();
  };

  /** Fold the step's flat fold and read it, for previews to draw from: a capture with nothing to commit. */
  const holdForPreview = () => {
    holding ??= capturing(async (begun, linked) => {
      if (linked.render.mode !== 'folded-flat') return null;
      const { document, choice } = await creasesFor(begun, linked);
      if (choice.status !== 'found') return null;
      const { side, foldCase, rotationDeg } = linked.render;
      await abandonOnEngineLoss(session.flat(document, choice.creases.foldLineIds, side, foldCase));
      await abandonOnEngineLoss(session.flatPicture(rotationDeg));
      heldFor = { key: linkedFoldKey(stepId, linked), document };
      return null;
    }).then(() => {
      holding = null;
      // Drawn now, if it can be; never folded for again.
      showPreview(false);
    });
  };

  const endPreview = () => {
    if (previewing === null) return;
    previewing = null;
    listener.preview(null, null);
  };

  return {
    run,

    orbit(camera, stored) {
      cancelOrbit();
      if (!stored || sameCamera(camera, stored)) return;
      orbitTimer = setTimeout(() => {
        orbitTimer = null;
        void run({ verb: 'orbit', camera });
      }, ORBIT_SETTLE_MS);
    },

    wantsRest,

    simulate(rest) {
      // One rest at a time, the newest waiting: a rest that came after the
      // one being captured is what the view shows, so it must not be refused
      // as busy and lose to it.
      nextRest = rest;
      simulating ??= (async () => {
        // Held before the first rest is looked at, so a rest that needs no
        // capture cannot finish — and let `simulating` go — before it is set.
        await null;
        try {
          while (nextRest) {
            const next = nextRest;
            nextRest = null;
            if (!wantsRest(next)) continue;
            await run({ verb: 'simulate', ...next });
          }
        } finally {
          simulating = null;
        }
      })();
      return simulating;
    },

    previewSpread(spread) {
      previewing = spread;
      previews += 1;
      showPreview(true);
    },

    commitSpread() {
      if (previewing === null) return Promise.resolve();
      nextAmount = previewing.amount;
      const asked = previews;
      spreading ??= (async () => {
        await null;
        try {
          while (nextAmount !== null) {
            // Its own capture first — a fold a preview asked for, a verb — rather than refused as busy.
            while (own) await own;
            const amount = nextAmount;
            nextAmount = null;
            await run({ verb: 'spread-amount', amount });
          }
        } finally {
          spreading = null;
        }
      })();
      return spreading.then(() => {
        if (previews === asked) endPreview();
      });
    },

    async prepareSpatial() {
      await capturing(async (begun, linked) => {
        const { document, choice } = await creasesFor(begun, linked);
        if (choice.status !== 'found') return null;
        const held = await abandonOnEngineLoss(session.spatial(document, choice.creases.foldLineIds));
        // A refusal leaves the captured picture to look at; a verb will say why.
        if (held.kind !== 'refused') {
          listener.spatial(
            { model: held.fold.render, aux: held.aux },
            linkedFoldKey(stepId, {
              scope: linked.scope,
              // The step's own fingerprint while its creases match it (a `cs1:`
              // one included): the key the live view is looked for by.
              fingerprint: creasesMatch(choice.creases, knownCreasesOf(linked))
                ? linked.fingerprint
                : creasesFingerprint(choice.creases, linked.render),
            })
          );
        }
        return null;
      });
    },

    historyMoved() {
      cancelOrbit();
      // A rest or an amount still waiting is of a pose the undo just took back.
      nextRest = null;
      nextAmount = null;
      endPreview();
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
    },

    documentReplaced() {
      cancelOrbit();
      nextRest = null;
      nextAmount = null;
      heldFor = null;
      endPreview();
      useWorkspaceStore.getState().stopDiagramCapture(stepId);
      session.dispose();
      listener.spatial(null, null);
    },

    engineLost() {
      cancelOrbit();
      nextRest = null;
      nextAmount = null;
      heldFor = null;
      endPreview();
      session.forget();
      listener.spatial(null, null);
    },

    dispose() {
      cancelOrbit();
      nextAmount = null;
      heldFor = null;
      previewing = null;
      // Its own fold, if one is still searching: the detail it was for is gone.
      if (start) useWorkspaceStore.getState().stopDiagramCapture(stepId);
      session.dispose();
    },
  };
}

/** The spread Spread Layers turns on with for this step: the nearest earlier step's, if any. */
function spreadStartOf(stepId: string) {
  const { diagram } = useWorkspaceStore.getState();
  return (diagram && nearestEarlierSpread(diagram, stepId)) ?? undefined;
}

/** The step's source, if it is still in the diagram and linked. */
function currentLinkedSource(stepId: string): DiagramCpSource | null {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  return step && !step.unknown && step.source?.kind === 'cp' ? step.source : null;
}

/** Whether a rest is where the step's simulated picture already is, to well under a slider's step. */
function sameSimulatedPose(
  render: Extract<DiagramCpSource['render'], { mode: 'simulated' }>,
  rest: Pick<SimulatedRest, 'foldPercent' | 'view'>
): boolean {
  return Math.abs(render.foldPercent - rest.foldPercent) < SAME_FOLD_PERCENT && sameCamera(render.view, rest.view);
}

/** Fold % closer than this is one pose: the 0.1 a pose is stored to, halved. */
const SAME_FOLD_PERCENT = 0.05;

/**
 * Whether a step's picture is not of its pattern as it is now, or not in the
 * diagram's light: what Pose again is for (D19). Unknown — the segmentation
 * not ready — is not out of date: a capture would find out no more.
 */
function needsRecapture(stepId: string, linked: DiagramCpSource): boolean {
  const { diagram, oristudioCpDocument } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (!diagram || !step) return false;
  const document = oristudioCpDocument?.document ?? null;
  const segmentation = document ? peekCpSegmentationArtifacts(document) : null;
  const status = linkStatus(linked, document, segmentation);
  return status === 'stale' || (status === 'current' && lightingChanged(step, diagram.style));
}

/**
 * The step's source after a pose: the same scope — or its sheet where it moved
 * to — its creases fingerprinted as the new render shows them. A pose of a
 * step that keeps a fingerprint from before (`cs1:`) keeps it while its
 * creases still match it and the render takes it over the same lines: a turn
 * is not a new picture, and its annotations carry. Show as, Refresh and
 * Relink write the relative one.
 */
function linkedSource(
  previous: DiagramCpSource,
  creases: StepCreases,
  segmentation: FoldArtifacts,
  render: DiagramCpSource['render']
): DiagramCpSource {
  const sameLines = (previous.render.mode === 'crease-pattern') === (render.mode === 'crease-pattern');
  const keep = !isRelativeFingerprint(previous.fingerprint) && sameLines && creasesMatch(creases, knownCreasesOf(previous));
  const stored = storedCpSource({
    kind: 'cp',
    scope: followedScope(previous.scope, creases),
    fingerprint: keep ? previous.fingerprint : creasesFingerprint(creases, render),
    thumbnail: creasesThumbnail(creases, segmentation),
    render,
  });
  if (!stored) throw new Error('The pose made a link the file cannot read');
  return stored;
}

export function sameCamera(a: FoldedFigureCamera, b: FoldedFigureCamera): boolean {
  const close = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  if (!close(a.yaw, b.yaw) || !close(a.pitch, b.pitch) || !close(a.zoom, b.zoom)) return false;
  if (!a.orient || !b.orient) return !a.orient && !b.orient;
  return a.orient.every((value, index) => close(value, b.orient![index]!));
}
