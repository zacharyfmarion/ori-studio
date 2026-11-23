/**
 * Pose's live views, checked on the CPU at a step's own camera and a ring of
 * eight. Test-only.
 *
 * The two regressions found on 2026-11-22 showed only away from a step's
 * saved camera — #621's simulated stubs and 90591a0ca's spokes in the 3D
 * picture drew 0–47 px at the saved cameras and hundreds at grazing ones —
 * and the harness drew neither live view at all. For each step Pose shows
 * live (an unspread 3D step, a Simulated step above 0%), at each camera:
 *
 * - **The live view**: the frame the view draws, replayed from its own draws
 *   on a recording canvas (`meshRendererReplay.testSupport.ts`). A 3D step
 *   draws through `FoldedMeshSource`, a simulated one through the GPU
 *   solver's renderer (`WebglSolver.render`), each with the settings Pose's
 *   viewport hands it. So the depth mode, crease bias, passes and pens are
 *   the live view's own, whatever they are on the commit that runs.
 * - **The picture**: what leaving Pose saves at that camera, a 3D step's
 *   scene (`folded3dPaperScene`) or a simulated one's session capture.
 *
 * Both are held to "a line shows only on its own paper"
 * (`folded3dWindowParity.testSupport.ts`), which needs no reference, and the
 * report holds each count to the other side's.
 *
 * A simulated step is drawn from the shape it saved when Pose would put it
 * back, else from a re-solve from flat by the CPU solver the session runs
 * without WebGL2 (`ReferenceSolver`), to the step's fold %. That is not the
 * GPU's shape to the bit, but it is a shape the same mesh folds into, the
 * same on both sides while the solver and mesh are.
 */
import {
  EDGE_CODE,
  OrigamiModel,
  WebglSolver,
  cameraUniforms,
  meshTopologyFor,
  projectVertices,
  sourceFaceGroups,
  withVirtualVertices,
  type MeshTopology,
  type OrbitView,
  type PaperScene,
  type RenderSettings,
} from '@treemaker/origami-simulator';
import { resolveFoldRoute } from '../../cp-workspace/folded/foldRoute';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dMesh, type Folded3dMesh } from '../../cp-workspace/folded/folded3dMesh';
import { folded3dPaperScene, folded3dSceneCamera } from '../../cp-workspace/folded/folded3dScene';
import { folded3dWindowRenderSettings } from '../../cp-workspace/folded/folded3dWindow';
import {
  folded3dCreases,
  folded3dPictureCreases,
  liveFolded3dView,
  ownPaperCheck,
  pictureLines,
  pictureRaster,
  roleOfCode,
  type OwnPaperLine,
  type OwnPaperRecord,
  type PictureCrease,
} from '../../cp-workspace/folded/folded3dWindowParity.testSupport';
import type { OristudioCpFold3dTolerances, OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import { DEFAULT_SIMULATOR_SETTINGS, simulatorMaterialOptions } from '../../lib/simulatorSettings';
import { framingOf } from '../../simulator/framingFollow';
import { recordingCanvas, replayFrame } from '../../simulator/meshRendererReplay.testSupport';
import { resolveRenderSettings } from '../../simulator/simulatorPalette';
import { createSimulatorSession } from '../../simulator/simulatorSession';
import { SIMULATED_FRAME_PX, storeSimulationFold, type DiagramCaptureStore } from '../../store/workspaceStore/diagramCapture';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import { captureModel } from '../capture/captureFolded';
import { chooseStepCreases, knownCreasesOf } from '../capture/captureCreases';
import { stepSheet } from '../capture/linkStatus';
import type { DiagramDocument, DiagramStep } from '../document/diagramDocument';
import { diagramPaperStyle, foldedModelPens } from '../pictures/diagramPaperStyle';
import { poseCreaseReferenceEdge } from '../pictures/poseLineWeight';
import { cpKernel, type LoadedPattern } from './datasetKernel';
import { rasterPng } from './datasetPng';
import type { PoseCameraRecord, PoseRecord } from './datasetResults';
import { lastPreparedModel, withStoreKernel } from './datasetSimulator.testSupport';

/** The live frame's edge, device px: about Pose's stage on a laptop. */
export const POSE_FRAME_PX = 600;
/** Pose's views at one device pixel per CSS pixel: the pens are then the style's at the picture's size. */
const POSE_DEVICE_PIXEL_RATIO = 1;

/**
 * A camera of the ring. The eye's direction is `(−sin p sin y, cos p, sin p cos y)`
 * (`viewRotation`'s depth row): pitch is the angle from the paper's normal and
 * yaw the azimuth, so `(y, −p)` is `(y + π, p)` turned upside down, the same
 * viewpoint. Pitch 1.2 rad looks from 21° above the paper's plane, π − 1.2
 * from 21° below it.
 */
export interface PoseCamera {
  name: string;
  yaw: number;
  pitch: number;
}

/** Grazing: where a buried layer lies closest to the paper over it on screen. */
const GRAZING_PITCH = 1.2;

/**
 * The ring every step is also checked at, the same on every step: four
 * diagonal azimuths, each from just above the paper and just below it.
 * Eight distinct viewpoints, among them the camera #621's stubs were found
 * at (yaw 135°, pitch 1.2).
 */
export const POSE_RING: readonly PoseCamera[] = [45, 135, 225, 315].flatMap((degrees) =>
  (['above', 'below'] as const).map((side) => ({
    name: `yaw ${degrees}° from ${side}`,
    yaw: (degrees * Math.PI) / 180,
    pitch: side === 'above' ? GRAZING_PITCH : Math.PI - GRAZING_PITCH,
  }))
);

/** How many cameras a step is checked at: its own and the ring. */
export const POSE_CAMERA_COUNT = POSE_RING.length + 1;

/** Settle rounds of a re-solve, and the steps in each: at most 200,000 steps, the same on every run. */
const SETTLE_ROUNDS = 10;
const SETTLE_STEPS = 20_000;

/** Where a step's frames go: `write(name, png)` returns the path the record keeps. */
export type PoseImages = (name: string, png: Uint8Array) => string;

/**
 * What Pose's two live views hand their viewport (`DiagramPose3dView`,
 * `DiagramPoseSimulatedView`): a transparent frame whose lines grow and shrink
 * with the stage from the size the step's picture opens at.
 */
const POSE_SURFACE = {
  transparentBackground: true,
  creaseWidthReferenceEdge: poseCreaseReferenceEdge(POSE_DEVICE_PIXEL_RATIO),
  creaseWidthShrinkExponent: 1,
  creaseWidthGrows: true,
} as const;

/** Why Pose shows a step only as its picture, or null when it shows it live. */
export function poseSkipReason(step: DiagramStep): string | null {
  const source = step.source;
  if (step.unknown || source?.kind !== 'cp' || source.layerOrder) return null;
  const { render } = source;
  if (render.mode === 'folded-3d') {
    return render.spread?.kind === 'spatial' && render.spread.amount > 0 ? 'a spatial spread' : null;
  }
  if (render.mode === 'simulated') return render.foldPercent > 0 ? null : 'Simulated at 0%: Pose shows the flat sheet';
  return null;
}

/** Whether Pose shows this step live at all (a 3D or Simulated step): the steps the check is about. */
export function hasPoseView(step: DiagramStep): boolean {
  const source = step.source;
  return !step.unknown && source?.kind === 'cp' && !source.layerOrder && (source.render.mode === 'folded-3d' || source.render.mode === 'simulated');
}

function drawsOf(frames: ReadonlyArray<{ depth: { perspective: boolean[]; creaseBias: number[]; creaseWritesDepth: boolean[] } }>, shaders: string | null): PoseRecord['draws'] {
  const union = <T>(pick: (depth: (typeof frames)[number]['depth']) => T[]) => [...new Set(frames.flatMap((frame) => pick(frame.depth)))];
  return {
    perspective: union((depth) => depth.perspective).sort(),
    creaseBias: union((depth) => depth.creaseBias).sort((a, b) => a - b),
    creaseWritesDepth: union((depth) => depth.creaseWritesDepth).sort(),
    shaders,
  };
}

function cameraRecord(
  name: string,
  live: { check: OwnPaperRecord; png: Uint8Array },
  picture: { check: OwnPaperRecord; png: Uint8Array } | { error: string },
  images: PoseImages,
  index: number
): PoseCameraRecord {
  return {
    name,
    live: live.check,
    liveImage: images(`pose-${index}-live.png`, live.png),
    picture: 'error' in picture ? picture : picture.check,
    pictureImage: 'error' in picture ? null : images(`pose-${index}-picture.png`, picture.png),
  };
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ------------------------------------------------------------------------
 * 3D
 * --------------------------------------------------------------------- */

/**
 * An unspread 3D step folded as Pose's 3D view folds it: the kernel's 3D fold
 * of its creases from the front, with the document's aux lines carried onto
 * it, as one mesh. Null for a step that does not fold in 3D now. The fold is
 * freed after `work`.
 */
export async function withFolded3d<T>(
  pattern: LoadedPattern,
  step: DiagramStep,
  work: (folded: { mesh: Folded3dMesh; render: OristudioCpFolded3dRenderModel; tolerances: OristudioCpFold3dTolerances }) => T | Promise<T>
): Promise<T | null> {
  const source = step.source;
  if (source?.kind !== 'cp' || source.render.mode !== 'folded-3d') return null;
  // A spatial spread at 0 is drawn unspread (`settledFolded3dFigureScene`).
  if (source.render.spread && source.render.spread.amount > 0) return null;
  const choice = chooseStepCreases(pattern.document, source.scope, pattern.sheets, knownCreasesOf(source));
  if (choice.status !== 'found') return null;
  const route = resolveFoldRoute(pattern.document, choice.creases.foldLineIds);
  if (route.kind !== 'spatial') return null;
  const folded = await pattern.runtime.fold3d(route.lineIds, captureModel(pattern.document, 'front'));
  if (folded.status !== 'placed') return null;
  try {
    const aux = await pattern.runtime.aux3d(folded.handle);
    const built = folded3dMesh(folded.render, aux ?? undefined);
    if (built.kind !== 'mesh') return null;
    return await work({ mesh: built.mesh, render: folded.render, tolerances: folded.snapshot.diagnostics.tolerances });
  } finally {
    await pattern.runtime.free(folded.handle);
  }
}

/** Pose's live 3D view and its picture, at the step's camera and the ring. */
async function folded3dPose(pattern: LoadedPattern, diagram: DiagramDocument, step: DiagramStep, images: PoseImages): Promise<PoseRecord | null> {
  const source = step.source;
  if (source?.kind !== 'cp' || source.render.mode !== 'folded-3d') return null;
  const saved = source.render.camera ?? null;
  return withFolded3d(pattern, step, ({ mesh, render, tolerances }) => {
    const style = diagramPaperStyle(diagram.style);
    // As `DiagramPose3dView` builds them and its viewport frames them (`withSurfaceFraming`).
    const settings: RenderSettings = {
      ...folded3dWindowRenderSettings({ style, displayStyle: 'Paper5', devicePixelRatio: POSE_DEVICE_PIXEL_RATIO }),
      displacementScale: 0,
      backgroundAlpha: 0,
      creaseWidthReferenceEdge: POSE_SURFACE.creaseWidthReferenceEdge,
      creaseWidthShrinkExponent: POSE_SURFACE.creaseWidthShrinkExponent,
      creaseWidthGrows: POSE_SURFACE.creaseWidthGrows,
    };
    const live = liveFolded3dView(mesh, settings);
    const creases = folded3dCreases(mesh);
    const cameras: Array<{ name: string; camera: FoldedFigureCamera | null }> = [
      { name: 'saved', camera: saved },
      ...POSE_RING.map((ring) => ({ name: ring.name, camera: { yaw: ring.yaw, pitch: ring.pitch, zoom: 1 } })),
    ];
    const frames: ReturnType<typeof live.render>[] = [];
    const records = cameras.map(({ name, camera }, index) => {
      const uniforms = folded3dSceneCamera(camera, mesh, POSE_FRAME_PX);
      const frame = live.render(uniforms);
      frames.push(frame);
      let picture: { check: OwnPaperRecord; png: Uint8Array } | { error: string };
      try {
        const scene = folded3dPaperScene(mesh, render, uniforms, { style, markHidden: true, tolerances, displayStyle: 'Paper5' });
        picture = pictureCheck(scene, POSE_FRAME_PX, folded3dPictureCreases(mesh, uniforms, creases));
      } catch (error) {
        picture = { error: message(error) };
      }
      return cameraRecord(name, { check: frame.check, png: rasterPng(frame.frame, (id) => frame.lines[id]?.role) }, picture, images, index);
    });
    return {
      view: 'folded-3d' as const,
      frame: 'folded' as const,
      draws: drawsOf(frames.map((frame) => frame.frame), live.shaders),
      cameras: records,
    };
  });
}

function pictureCheck(scene: PaperScene, size: number, creases: readonly PictureCrease[]): { check: OwnPaperRecord; png: Uint8Array } {
  const raster = pictureRaster(scene, size, size);
  const lines = pictureLines(scene, raster, creases);
  return { check: ownPaperCheck(raster, lines), png: rasterPng(raster, (id) => lines[id]?.role) };
}

/* ------------------------------------------------------------------------
 * Simulated
 * --------------------------------------------------------------------- */

/** The store a step's simulated model is built from: the pattern, and what the project says its aux lines are. */
export interface PoseStoreInputs {
  extensions: Record<string, unknown>;
  sourceFold: FoldDocument | null;
}

/** `simulatorShapeOf`, where this commit has it: a commit before saved shapes reads none, as its Pose does. */
const shapeModules = import.meta.glob<{ simulatorShapeOf?: (shape: unknown) => unknown }>('../capture/simulatedShape.ts');

async function savedShapeOf(shape: unknown): Promise<unknown> {
  const load = Object.values(shapeModules)[0];
  if (!load || shape === undefined) return null;
  return (await load()).simulatorShapeOf?.(shape) ?? null;
}

/** A simulated mesh's drawn creases, each with its own paper: the faces of the triangles on it, or a drawn-on aux line's triangle's. */
function simulatedCreases(topology: MeshTopology, faceGroups: ArrayLike<number>): {
  ownOf: (a: number, b: number) => ReadonlySet<number>;
  /** A small number per crease, by its ends. */
  groupOf: (a: number, b: number) => number;
  edges: Array<{ a: number; b: number; own: ReadonlySet<number> }>;
} {
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const byPair = new Map<string, Set<number>>();
  const tri = topology.faceIndices;
  for (let t = 0; t * 3 + 2 < tri.length; t += 1) {
    const group = faceGroups[t] ?? -1;
    for (const [a, b] of [
      [tri[t * 3]!, tri[t * 3 + 1]!],
      [tri[t * 3 + 1]!, tri[t * 3 + 2]!],
      [tri[t * 3 + 2]!, tri[t * 3]!],
    ] as const) {
      let set = byPair.get(key(a, b));
      if (!set) byPair.set(key(a, b), (set = new Set()));
      if (group >= 0) set.add(group);
    }
  }
  const ownByEdge = new Map<string, ReadonlySet<number>>();
  const edges: Array<{ a: number; b: number; own: ReadonlySet<number> }> = [];
  for (let e = 0; e < topology.edgeAssignments.length; e += 1) {
    if (topology.edgeAssignments[e]! > EDGE_CODE.aux) continue;
    const a = topology.edgeIndices[e * 2]!;
    const b = topology.edgeIndices[e * 2 + 1]!;
    const recorded = topology.edgeTriangles?.[e] ?? -1;
    const own: ReadonlySet<number> =
      recorded >= 0 ? new Set([faceGroups[recorded] ?? -1].filter((group) => group >= 0)) : (byPair.get(key(a, b)) ?? new Set());
    ownByEdge.set(key(a, b), own);
    edges.push({ a, b, own });
  }
  const none: ReadonlySet<number> = new Set();
  const groups = new Map<string, number>();
  const groupOf = (a: number, b: number) => {
    let group = groups.get(key(a, b));
    if (group === undefined) groups.set(key(a, b), (group = groups.size));
    return group;
  };
  return { ownOf: (a, b) => ownByEdge.get(key(a, b)) ?? none, groupOf, edges };
}

/** What `sessionCapture` saves, or, on a commit before it, `sessionScene`: the picture leaving Pose stores. */
function sessionPicture(
  session: ReturnType<typeof createSimulatorSession>,
  options: { token: number; view: OrbitView; size: number; style: ReturnType<typeof diagramPaperStyle>; markHidden: boolean }
): PaperScene | null {
  const api = session as unknown as {
    sessionCapture?: (o: typeof options) => { scene: PaperScene | null } | null;
    sessionScene?: (o: typeof options) => PaperScene | null;
  };
  if (api.sessionCapture) return api.sessionCapture(options)?.scene ?? null;
  if (api.sessionScene) return api.sessionScene(options);
  throw new Error('this commit has no way to capture a session');
}

/** Pose's live simulated view and the picture it saves, at the step's camera and the ring. */
async function simulatedPose(
  pattern: LoadedPattern,
  store: PoseStoreInputs,
  diagram: DiagramDocument,
  step: DiagramStep,
  images: PoseImages
): Promise<PoseRecord | { skipped: string }> {
  const source = step.source;
  if (source?.kind !== 'cp' || source.render.mode !== 'simulated') throw new Error('not a simulated step');
  const { render } = source;
  // As `useDiagramSimulatedPose` finds the sheet and builds its model.
  const sheet = stepSheet(source.scope, knownCreasesOf(source), pattern.document, pattern.sheets);
  if (!sheet) return { skipped: 'its sheet is not found' };
  const state = {
    oristudioCpDocument: { document: pattern.document },
    oristudioCpDocumentExtensions: store.extensions,
    importedCreasePattern: { sourceFold: store.sourceFold },
  } as unknown as WorkspaceState;
  const captureStore: DiagramCaptureStore = { get: () => state, set: () => {} };
  const kernel = {
    exportFoldLines: (lineIds: number[]) => cpKernel().exportFoldLines(pattern.handle, lineIds),
    sheetIndex: () => cpKernel().sheetIndex(pattern.handle),
  };
  const fold = await withStoreKernel(kernel, () => storeSimulationFold(captureStore, sheet));
  if (!fold) return { skipped: 'its sheet has no model to simulate' };

  const session = createSimulatorSession();
  const shape = await savedShapeOf(render.shape);
  const solver = { ...simulatorMaterialOptions(DEFAULT_SIMULATOR_SETTINGS), foldPercent: render.foldPercent };
  lastPreparedModel();
  const info = session.load(fold as never, {
    prepare: { triangulate: true },
    solver,
    ...(shape ? { shape: shape as never } : {}),
  });
  try {
    const prepared = lastPreparedModel();
    if (!prepared || prepared.vertexCount !== info.vertexCount || prepared.faceCount !== info.faceCount) {
      throw new Error('the model the session prepared was not seen');
    }
    const restored = (info as { restored?: unknown }).restored ?? null;
    const shapeOutcome: PoseRecord['shape'] = !shape ? 'none' : restored && restored !== 'mismatch' ? 'restored' : 'mismatch';
    let solve: PoseRecord['solve'];
    if (shapeOutcome !== 'restored') {
      let frame = await session.settle(SETTLE_STEPS, { token: info.token });
      for (let round = 1; round < SETTLE_ROUNDS && frame && !frame.converged; round += 1) {
        frame = await session.settle(SETTLE_STEPS, { token: info.token });
      }
      solve = { steps: frame?.step ?? 0, settled: frame?.converged ?? false };
    }
    const positions = new Float32Array(session.exportGeometry().positions);

    // The renderer the GPU solver draws with, on the model the session prepared.
    const { canvas, recording } = recordingCanvas();
    const gpu = new WebglSolver(canvas, new OrigamiModel(prepared), solver);
    const topology = meshTopologyFor(prepared);
    const faceGroups = sourceFaceGroups(topology);
    const creases = simulatedCreases(topology, faceGroups);
    const style = diagramPaperStyle(diagram.style);
    const settings = resolveRenderSettings(null, DEFAULT_SIMULATOR_SETTINGS, foldedModelPens(style), POSE_SURFACE);
    const { center, radius } = framingOf(positions);
    const placed = typeof withVirtualVertices === 'function' ? withVirtualVertices(positions, topology.virtual) : positions;

    const cameras: Array<{ name: string; view: OrbitView }> = [
      { name: 'saved', view: render.view as OrbitView },
      ...POSE_RING.map((ring) => ({ name: ring.name, view: { yaw: ring.yaw, pitch: ring.pitch, zoom: 1 } })),
    ];
    const frames: ReturnType<typeof replayFrame>[] = [];
    const records = cameras.map(({ name, view }, index) => {
      recording.reset();
      gpu.render(cameraUniforms(view, center, radius, POSE_FRAME_PX, POSE_FRAME_PX), settings, null, { highlight: true });
      const frame = replayFrame(recording, { faceOfTriangle: (t) => faceGroups[t] ?? -1, positions });
      frames.push(frame);
      const lines = frame.lines.map(
        (line): OwnPaperLine => ({
          role: roleOfCode(line.code),
          own: creases.ownOf(line.a, line.b),
          // A simulated mesh's layers never coincide: each crease is its own line.
          group: creases.groupOf(line.a, line.b),
          from: line.from,
          to: line.to,
          halfWidthPx: line.halfWidthPx,
          dashOn: line.dashOn,
        })
      );
      const live = { check: ownPaperCheck(frame, lines), png: rasterPng(frame, (id) => lines[id]?.role) };
      let picture: { check: OwnPaperRecord; png: Uint8Array } | { error: string };
      try {
        const scene = sessionPicture(session, { token: info.token, view, size: SIMULATED_FRAME_PX, style, markHidden: true });
        if (!scene) throw new Error('the session drew no picture');
        const camera = cameraUniforms(view, center, radius, SIMULATED_FRAME_PX, SIMULATED_FRAME_PX);
        const { screen } = projectVertices(placed, camera);
        const onPicture = creases.edges.map(
          ({ a, b, own }): PictureCrease => ({ a: [screen[a * 2]!, screen[a * 2 + 1]!], b: [screen[b * 2]!, screen[b * 2 + 1]!], own })
        );
        picture = pictureCheck(scene, SIMULATED_FRAME_PX, onPicture);
      } catch (error) {
        picture = { error: message(error) };
      }
      return cameraRecord(name, live, picture, images, index);
    });
    return {
      view: 'simulated',
      frame: shapeOutcome === 'restored' ? 'saved-shape' : 're-solved',
      ...(solve ? { solve } : {}),
      shape: shapeOutcome,
      draws: drawsOf(frames, recording.shaders()),
      cameras: records,
    };
  } finally {
    session.release(info.token);
  }
}

/**
 * A step's Pose check, or null for a step Pose shows only as its picture.
 * A check that throws is recorded as its error.
 */
export async function poseCheck(
  pattern: LoadedPattern,
  store: PoseStoreInputs,
  diagram: DiagramDocument,
  step: DiagramStep,
  images: PoseImages
): Promise<PoseRecord | { skipped: string } | { error: string } | null> {
  if (!hasPoseView(step)) return null;
  const skip = poseSkipReason(step);
  if (skip) return { skipped: skip };
  try {
    if (step.source?.kind === 'cp' && step.source.render.mode === 'simulated') {
      return await simulatedPose(pattern, store, diagram, step, images);
    }
    return (await folded3dPose(pattern, diagram, step, images)) ?? { skipped: 'it does not fold in 3D now' };
  } catch (error) {
    return { error: message(error) };
  }
}
