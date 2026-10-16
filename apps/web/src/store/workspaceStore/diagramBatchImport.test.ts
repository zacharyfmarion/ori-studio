import { beforeEach, it, expect, vi } from "vitest";
import { useWorkspaceStore } from "../workspaceStore";
import {
  createStep,
  createDiagram,
} from "../../diagram/document/diagramDocument";
import { createStarterOristudioCpDocument } from "../../lib/oristudioCpStarterDocument";
import type { OristudioCpDocumentState } from "../../engine/oristudioCpTypes";
import {
  commitDiagramImport,
  importTarget,
  compoundImportTravel,
  ensureDiagramImportTarget,
} from "./diagramBatchImport";
import type { CpGeometryTransport } from "../../engine/oristudioCpGeometry";
const runtime = vi.hoisted(() => ({
  getOristudioCpClient: vi.fn(),
  refreshOristudioCpDocument: vi.fn(),
  restoreOristudioCpDocumentInPlace: vi.fn(),
}));
vi.mock("./oristudioCpRuntime", async (original) => ({
  ...(await original<typeof import("./oristudioCpRuntime")>()),
  ...runtime,
}));
const initial = useWorkspaceStore.getInitialState();
const get = useWorkspaceStore.getState;
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initial, true);
});
it("publishes SVG-only batches in one history entry and refuses a changed target", async () => {
  const target = importTarget();
  const step = createStep();
  expect(await commitDiagramImport([{ steps: [step] }], target, 1, 100)).toBe(
    1,
  );
  expect(get().diagram?.steps[0]?.id).toBe(step.id);
  expect(get().diagramHistory.past).toHaveLength(1);
  await expect(
    commitDiagramImport([{ steps: [createStep()] }], target, 1, 100),
  ).rejects.toThrow("destination changed");
});
it("undoes and redoes both histories together, but never rewinds intervening edits", async () => {
  const before = createStarterOristudioCpDocument();
  const after = { ...before, title: "after" };
  const state = {
    handle: 1,
    loadSerial: 1,
    document: after,
    source: { format: "cp", filename: "test.cp", path: null },
    geometry: null,
  } as OristudioCpDocumentState;
  const diagramBefore = createDiagram(),
    diagramAfter = { ...diagramBefore, title: "after" };
  const cpEntry = {
    document: before,
    selection: get().oristudioCpSelection,
    annotations: [],
    foldedFigures: [],
    activeFoldedFigureId: null,
    label: "Import steps",
    timestamp: "now",
    compoundId: "paired",
  };
  const diagramEntry = {
    snapshot: diagramBefore,
    label: "Import steps",
    timestamp: "now",
    compoundId: "paired",
  };
  useWorkspaceStore.setState({
    oristudioCpDocument: state,
    oristudioCpHistoryPast: [cpEntry],
    diagram: diagramAfter,
    diagramHistory: { past: [diagramEntry], future: [] },
  });
  runtime.restoreOristudioCpDocumentInPlace.mockImplementation(
    async (document) => ({ ...state, document }),
  );
  get().setDiagramTitle("later");
  expect(await compoundImportTravel("undo")).toBe(false);
  expect(runtime.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();
  get().undoDiagram();
  expect(await compoundImportTravel("undo")).toBe(true);
  expect(get().diagram).toBe(diagramBefore);
  expect(get().oristudioCpDocument?.document).toBe(before);
  expect(await compoundImportTravel("redo")).toBe(true);
  expect(get().diagram?.title).toBe("after");
  expect(get().oristudioCpDocument?.document).toBe(after);
});

function geometry(): CpGeometryTransport {
  const document = createStarterOristudioCpDocument();
  return {
    segEndpoints: new Float64Array([
      -200, -200, 200, -200, 200, -200, 200, 200, 200, 200, -200, 200, -200,
      200, -200, -200,
    ]),
    segAttr: new Int32Array(20),
    segCustomColor: new Uint8Array(12),
    auxEndpoints: new Float64Array(),
    auxAttr: new Int32Array(),
    auxCustomColor: new Uint8Array(),
    pointCoords: new Float64Array(),
    circleData: new Float64Array(),
    circleAttr: new Int32Array(),
    circleCustomColor: new Uint8Array(),
    tail: {
      texts: [],
      grid: document.crease_pattern.grid,
      operation_frame: document.operation_frame!,
      metadata: {},
    },
  };
}
it("rolls the live kernel back if reading the committed batch fails, without publishing either surface", async () => {
  const document = createStarterOristudioCpDocument();
  const state = {
    handle: 1,
    loadSerial: 1,
    document,
    source: { format: "cp", filename: "test.cp", path: null },
    geometry: null,
  } as OristudioCpDocumentState;
  useWorkspaceStore.setState({ oristudioCpDocument: state });
  const api = {
    appendDisjoint: vi.fn().mockResolvedValue([]),
    restoreDocument: vi.fn().mockResolvedValue(undefined),
  };
  runtime.getOristudioCpClient.mockResolvedValue(api);
  runtime.refreshOristudioCpDocument.mockRejectedValue(
    new Error("transport failed"),
  );
  await expect(
    commitDiagramImport(
      [{ geometry: geometry(), steps: [createStep()] }],
      importTarget(),
      0,
      100,
    ),
  ).rejects.toThrow("transport failed");
  expect(api.restoreDocument).toHaveBeenCalledWith(1, document);
  expect(get().diagram).toBeNull();
  expect(get().oristudioCpDocument).toBe(state);
  expect(get().oristudioCpHistoryPast).toHaveLength(0);
  expect(get().diagramImportBusy).toBe(false);
});
it("expires the paired redo branch when a new diagram edit replaces it", async () => {
  const document = createStarterOristudioCpDocument();
  const state = {
    handle: 1,
    loadSerial: 1,
    document,
    source: { format: "cp", filename: "test.cp", path: null },
    geometry: null,
  } as OristudioCpDocumentState;
  useWorkspaceStore.setState({ oristudioCpDocument: state });
  runtime.getOristudioCpClient.mockResolvedValue({
    appendDisjoint: vi.fn().mockResolvedValue([]),
  });
  runtime.refreshOristudioCpDocument.mockResolvedValue(state);
  runtime.restoreOristudioCpDocumentInPlace.mockResolvedValue(state);
  await commitDiagramImport(
    [{ geometry: geometry(), steps: [createStep()] }],
    importTarget(),
    0,
    100,
  );
  expect(await compoundImportTravel("undo")).toBe(true);
  expect(get().oristudioCpHistoryFuture).toHaveLength(1);
  get().setDiagramTitle("new branch");
  expect(get().oristudioCpHistoryFuture).toHaveLength(0);
});
it("expires the CP history prefix when diagram history reaches its retention limit", async () => {
  const document = createStarterOristudioCpDocument();
  const state = {
    handle: 1,
    loadSerial: 1,
    document,
    source: { format: "cp", filename: "test.cp", path: null },
    geometry: null,
  } as OristudioCpDocumentState;
  useWorkspaceStore.setState({ oristudioCpDocument: state });
  runtime.getOristudioCpClient.mockResolvedValue({
    appendDisjoint: vi.fn().mockResolvedValue([]),
  });
  runtime.refreshOristudioCpDocument.mockResolvedValue(state);
  await commitDiagramImport(
    [{ geometry: geometry(), steps: [createStep()] }],
    importTarget(),
    0,
    100,
  );
  for (let i = 0; i < 100; i++) get().setDiagramTitle(`edit ${i}`);
  expect(get().oristudioCpHistoryPast).toHaveLength(0);
  expect(get().diagramHistory.past).toHaveLength(100);
});

it("fills a selected empty step when importing one SVG, as the existing picture importer does", async () => {
  const step = createStep();
  useWorkspaceStore.setState({
    diagram: { ...createDiagram(), steps: [step] },
    diagramSelectedStepId: step.id,
  });
  const asset = {
    id: "svg-1",
    kind: "svg" as const,
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
    widthPx: 10,
    heightPx: 10,
    bytes: 70,
  };
  await commitDiagramImport(
    [
      {
        steps: [
          {
            ...createStep(),
            source: {
              kind: "upload",
              assetId: asset.id,
              rotationQuarterTurns: 0,
              mirrored: false,
            },
          },
        ],
        assets: [asset],
      },
    ],
    importTarget(),
    0,
    100,
  );
  expect(get().diagram?.steps).toHaveLength(1);
  expect(get().diagram?.steps[0]?.id).toBe(step.id);
  expect((get().diagram?.steps[0] as typeof step)?.picture).toMatchObject({
    kind: "asset",
    assetId: asset.id,
  });
});

it("provisions an empty Edit canvas through the existing self-provisioning action", async () => {
  const document = createStarterOristudioCpDocument();
  const state = {
    handle: 1,
    loadSerial: 7,
    document,
    geometry: null,
  } as OristudioCpDocumentState;
  const ensure = vi.fn(async () => {
    useWorkspaceStore.setState({ oristudioCpDocument: state });
  });
  useWorkspaceStore.setState({ ensureEditCreasePattern: ensure });
  const target = await ensureDiagramImportTarget(importTarget());
  expect(ensure).toHaveBeenCalledOnce();
  expect(target.cpLoadSerial).toBe(7);
  expect(get().diagram).toBeNull();
  await ensureDiagramImportTarget(target);
  expect(ensure).toHaveBeenCalledOnce();
});

it("rejects a destination replaced while the empty Edit canvas is being provisioned", async () => {
  const ensure = vi.fn(async () => {
    useWorkspaceStore.setState({ diagramLoadId: 99 });
  });
  useWorkspaceStore.setState({ ensureEditCreasePattern: ensure });
  await expect(ensureDiagramImportTarget(importTarget())).rejects.toThrow(
    "destination changed",
  );
});

it("places new geometry beyond existing simulation windows, including their rotation", async () => {
  const document = createStarterOristudioCpDocument();
  const state = {
    handle: 1,
    loadSerial: 1,
    document,
    geometry: null,
  } as OristudioCpDocumentState;
  useWorkspaceStore.setState({
    oristudioCpDocument: state,
    oristudioCpInlineSimulations: [
      {
        id: "simulation",
        box: {
          center: { x: 1000, y: 0 },
          width: 200,
          height: 400,
          rotation: Math.PI / 2,
        },
        z: 0,
        view: { yaw: 0, pitch: 0, zoom: 1 },
        sourceBoundary: null,
        sourceBounds: null,
        sourceFingerprint: null,
        segmentIdHint: null,
      },
    ],
  });
  const appendDisjoint = vi.fn().mockResolvedValue([]);
  runtime.getOristudioCpClient.mockResolvedValue({ appendDisjoint });
  runtime.refreshOristudioCpDocument.mockResolvedValue(state);
  await commitDiagramImport(
    [{ geometry: geometry(), steps: [createStep()] }],
    importTarget(),
    0,
    100,
  );
  const placed = appendDisjoint.mock.calls[0]![1][0] as CpGeometryTransport;
  expect(
    Math.min(...Array.from(placed.segEndpoints).filter((_, i) => i % 2 === 0)),
  ).toBe(1300);
  expect(appendDisjoint.mock.calls[0]![2]).toBe(false);
});

it("uses the same localized defaults as adding the first step, including undo/redo", async () => {
  get().addDiagramStep();
  const expected = get().diagram!;
  useWorkspaceStore.setState(initial, true);
  await commitDiagramImport([{ steps: [createStep()] }], importTarget(), 1, 100);
  expect(get().diagram!.title).toBe(expected.title);
  expect(get().diagram!.titleBlockContent).toEqual(expected.titleBlockContent);
  expect(get().diagram!.hanStyle).toBe(expected.hanStyle);
  expect(get().diagram!.page).toEqual(expected.page);
  get().undoDiagram();
  expect(get().diagram).toBeNull();
  get().redoDiagram();
  expect(get().diagram!.titleBlockContent).toEqual(expected.titleBlockContent);
});

it("preserves authored fields, including intentionally blank fields, when appending", async () => {
  get().setDiagramTitle('My model');
  get().setDiagramTitleBlockContent({ subtitle: '' });
  const before = get().diagram!;
  await commitDiagramImport([{ steps: [createStep()] }], importTarget(), 1, 100);
  expect(get().diagram!.title).toBe('My model');
  expect(get().diagram!.titleBlockContent).toEqual(before.titleBlockContent);
  get().setDiagramTitle('');
  await commitDiagramImport([{ steps: [createStep()] }], importTarget(), 1, 100);
  expect(get().diagram!.title).toBe('');
});
