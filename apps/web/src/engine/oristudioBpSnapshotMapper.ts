import type {
  OristudioBpDiagnostic,
  OristudioBpDevice,
  OristudioBpDocumentState,
  OristudioBpExportStatus,
  OristudioBpFlap,
  OristudioBpGraphicPrimitive,
  OristudioBpGrid,
  OristudioBpHistorySummary,
  OristudioBpInvalidJunction,
  OristudioBpOptimizerState,
  OristudioBpPackingView,
  OristudioBpProjectSnapshot,
  OristudioBpProjectSummary,
  OristudioBpRawConfiguration,
  OristudioBpRawDevice,
  OristudioBpRawEdge,
  OristudioBpRawFlap,
  OristudioBpRawPattern,
  OristudioBpRawProject,
  OristudioBpRawSheet,
  OristudioBpRawStretch,
  OristudioBpRawVertex,
  OristudioBpRiver,
  OristudioBpSheet,
  OristudioBpSourceRef,
  OristudioBpStretch,
  OristudioBpTreeEdge,
  OristudioBpTreeVertex,
  OristudioBpTreeView,
  OristudioBpWasmGraphicsData,
  OristudioBpWasmInvalidJunction,
  OristudioBpWasmLayoutSnapshot,
  OristudioBpWasmPackingValidation,
  OristudioBpWasmProjectSummary,
  OristudioBpWasmTreeData,
  OristudioBpWasmTreeNode,
} from './oristudioBpTypes';
import type { Point } from '../lib/geometry';

const MAX_TREE_HEIGHT = 11_586;

export interface OristudioBpStateFromRawInput {
  handle: number;
  project: OristudioBpRawProject;
  summary?: OristudioBpWasmProjectSummary | null;
  treeData?: OristudioBpWasmTreeData | null;
  layoutSnapshot?: OristudioBpWasmLayoutSnapshot | null;
  packingValidation?: OristudioBpWasmPackingValidation | null;
  source: OristudioBpSourceRef;
  activeSurface?: OristudioBpDocumentState['activeSurface'];
  dirty?: boolean;
}

export function oristudioBpProjectStateFromRaw(
  input: OristudioBpStateFromRawInput
): OristudioBpDocumentState {
  return {
    workflowTarget: 'box-pleat',
    kind: 'box-pleat-project',
    handle: input.handle,
    source: input.source,
    activeSurface:
      input.activeSurface ?? (input.project.design.mode === 'layout' ? 'packing' : 'tree'),
    snapshot: oristudioBpProjectSnapshotFromRaw(
      input.project,
      input.summary ?? null,
      input.treeData ?? null,
      input.layoutSnapshot ?? null,
      input.packingValidation ?? null
    ),
    history: historySummary(input.project),
    optimizer: defaultOptimizerState(),
    exportStatus: defaultExportStatus(),
    dirty: input.dirty ?? false,
  };
}

export function oristudioBpProjectSnapshotFromRaw(
  project: OristudioBpRawProject,
  wasmSummary: OristudioBpWasmProjectSummary | null = null,
  treeData: OristudioBpWasmTreeData | null = null,
  layoutSnapshot: OristudioBpWasmLayoutSnapshot | null = null,
  packingValidation: OristudioBpWasmPackingValidation | null = null
): OristudioBpProjectSnapshot {
  const tree = treeView(
    project.design.tree.sheet,
    project.design.tree.nodes,
    treeData?.edges ?? project.design.tree.edges,
    project.design.layout.flaps,
    treeData
  );
  const packing = packingView(project, tree, layoutSnapshot, packingValidation);
  return {
    summary: projectSummary(project, packing, wasmSummary),
    tree,
    packing,
    diagnostics: projectDiagnostics(project, packing, layoutSnapshot, packingValidation),
    stale: {
      packing: project.design.layout.flaps.length === 0 && project.design.tree.nodes.length > 0,
      creasePattern: true,
      exports: true,
      reasons: staleReasons(project, packing, layoutSnapshot, packingValidation),
    },
  };
}

function projectSummary(
  project: OristudioBpRawProject,
  packing: OristudioBpPackingView,
  wasmSummary: OristudioBpWasmProjectSummary | null
): OristudioBpProjectSummary {
  const degrees = vertexDegrees(project.design.tree.edges);
  return {
    title: project.design.title || wasmSummary?.title || 'Untitled BP',
    description: project.design.description ?? null,
    upstreamVersion: project.version || wasmSummary?.version || null,
    treeVertices: wasmSummary?.tree_nodes ?? project.design.tree.nodes.length,
    treeEdges: wasmSummary?.tree_edges ?? project.design.tree.edges.length,
    leafVertices: project.design.tree.nodes.filter((node) => (degrees.get(node.id) ?? 0) <= 1).length,
    flaps: wasmSummary?.layout_flaps ?? project.design.layout.flaps.length,
    rivers: packing.rivers.length,
    stretches: wasmSummary?.layout_stretches ?? project.design.layout.stretches.length,
    devices: packing.devices.length,
    invalidJunctions: packing.invalidJunctions.length,
    packingValidity: packing.validity,
  };
}

function projectDiagnostics(
  project: OristudioBpRawProject,
  packing: OristudioBpPackingView,
  layoutSnapshot: OristudioBpWasmLayoutSnapshot | null,
  packingValidation: OristudioBpWasmPackingValidation | null
): OristudioBpDiagnostic[] {
  const diagnostics: OristudioBpDiagnostic[] = [];
  if (project.error) {
    diagnostics.push({
      id: 'bp-core-error',
      kind: 'unsupported',
      severity: 'error',
      message: project.error.message,
    });
  }
  if (layoutSnapshot?.patternNotFound) {
    const patternlessStretches = packing.stretches.filter(
      (stretch) => stretch.patternFound === false
    );
    if (patternlessStretches.length > 0) {
      for (const stretch of patternlessStretches) {
        diagnostics.push({
          id: `bp-pattern-not-found:${stretch.id}`,
          kind: 'pattern-not-found',
          severity: 'warning',
          message: `Stretch ${stretch.id} did not find the selected pattern.`,
          selection: { kind: 'bp-stretch', id: stretch.id },
        });
      }
    } else {
      diagnostics.push({
        id: 'bp-pattern-not-found',
        kind: 'pattern-not-found',
        severity: 'warning',
        message: 'One or more stretch repositories did not find a selected pattern.',
      });
    }
  }
  if (packingValidation && !packingValidation.valid) {
    for (const [index, error] of packingValidation.errors.entries()) {
      diagnostics.push({
        id: `bp-invalid-packing:${index}`,
        kind: 'invalid-packing',
        severity: 'error',
        message: manualPackingValidationMessage(error.message),
      });
    }
  }
  for (const junction of packing.invalidJunctions) {
    diagnostics.push({
      id: `bp-invalid-junction:${junction.id}`,
      kind: 'invalid-junction',
      severity: 'error',
      message: junction.message,
      selection: { kind: 'bp-invalid-junction', id: junction.id },
    });
  }
  return diagnostics;
}

function staleReasons(
  project: OristudioBpRawProject,
  packing: OristudioBpPackingView,
  layoutSnapshot: OristudioBpWasmLayoutSnapshot | null,
  packingValidation: OristudioBpWasmPackingValidation | null
): string[] {
  const reasons: string[] = [];
  if (project.design.layout.flaps.length === 0 && project.design.tree.nodes.length > 0) {
    reasons.push('Packing has not been materialized for the current tree');
  }
  if (packing.validity === 'invalid') {
    reasons.push('Packing has invalid flap junctions');
  }
  if (packingValidation && !packingValidation.valid) {
    reasons.push('Packing violates current tree, sheet, or distance constraints');
  }
  if (layoutSnapshot?.patternNotFound) {
    reasons.push('A selected BP stretch pattern was not found');
  }
  return reasons;
}

function treeView(
  treeSheet: OristudioBpRawSheet,
  vertices: OristudioBpRawVertex[],
  edges: OristudioBpRawEdge[],
  flaps: OristudioBpRawFlap[],
  treeData: OristudioBpWasmTreeData | null
): OristudioBpTreeView {
  const degrees = vertexDegrees(edges);
  const flapIds = new Set(flaps.map((flap) => flap.id));
  const nodeData = new Map((treeData?.nodes ?? []).map((node) => [node.id, node]));
  const rootVertexId =
    treeData?.edges[0]?.n1 ??
    vertices.find((vertex) => (degrees.get(vertex.id) ?? 0) > 1)?.id ??
    vertices[0]?.id ??
    null;
  const maxTreeHeight = vertices.length > 0 ? MAX_TREE_HEIGHT : null;
  return {
    rootVertexId,
    sheet: sheet(treeSheet),
    maxTreeHeight,
    vertices: vertices.map((vertex) =>
      treeVertex(vertex, degrees.get(vertex.id) ?? 0, rootVertexId, flapIds, nodeData.get(vertex.id) ?? null)
    ),
    edges: edges.map((edge, index) => treeEdge(edge, index + 1, degrees, nodeData)),
  };
}

function treeVertex(
  vertex: OristudioBpRawVertex,
  degree: number,
  rootVertexId: number | null,
  flapIds: Set<number>,
  nodeData: OristudioBpWasmTreeNode | null
): OristudioBpTreeVertex {
  const dist = nodeData?.dist ?? (rootVertexId === vertex.id ? 0 : vertex.y);
  return {
    id: vertex.id,
    name: vertex.name,
    loc: { x: vertex.x, y: vertex.y },
    isRoot: rootVertexId === vertex.id,
    isLeaf: degree <= 1,
    degree,
    dist,
    height: nodeData?.height ?? 0,
    maxHeight: MAX_TREE_HEIGHT,
    maxNewLeafLength: Math.max(1, MAX_TREE_HEIGHT - dist),
    dualFlapId: flapIds.has(vertex.id) ? vertex.id : null,
  };
}

function treeEdge(
  edge: OristudioBpRawEdge,
  id: number,
  degrees: Map<number, number>,
  nodeData: Map<number, OristudioBpWasmTreeNode>
): OristudioBpTreeEdge {
  const firstNode = nodeData.get(edge.n1);
  const secondNode = nodeData.get(edge.n2);
  const child =
    firstNode && secondNode
      ? firstNode.dist > secondNode.dist
        ? firstNode
        : secondNode
      : firstNode ?? secondNode ?? null;
  return {
    id,
    vertices: [edge.n1, edge.n2],
    length: edge.length,
    maxLength: child ? Math.max(1, MAX_TREE_HEIGHT - (child.dist + child.height) + edge.length) : null,
    isLeafEdge: (degrees.get(edge.n1) ?? 0) <= 1 || (degrees.get(edge.n2) ?? 0) <= 1,
    dualRiverId:
      (degrees.get(edge.n1) ?? 0) > 1 && (degrees.get(edge.n2) ?? 0) > 1 ? id : null,
  };
}

function packingView(
  project: OristudioBpRawProject,
  tree: OristudioBpTreeView,
  layoutSnapshot: OristudioBpWasmLayoutSnapshot | null,
  packingValidation: OristudioBpWasmPackingValidation | null
): OristudioBpPackingView {
  const flaps = project.design.layout.flaps.map((flap) =>
    packingFlap(flap, project.design.tree.nodes, project.design.tree.edges)
  );
  const invalidJunctions = (layoutSnapshot?.invalidJunctions ?? []).map((junction) =>
    packingInvalidJunction(junction)
  );
  const stretches = project.design.layout.stretches.map(packingStretch);
  const deviceGraphics = new Map(
    (layoutSnapshot?.deviceGraphics ?? []).map((entry) => [deviceIdFromGraphicsId(entry.id), entry.data])
  );
  const devices = project.design.layout.stretches.flatMap((stretch) =>
    packingDevices(stretch, deviceGraphics)
  );
  const leafCount = tree.vertices.filter((vertex) => vertex.isLeaf).length;
  return {
    sheet: sheet(project.design.layout.sheet),
    flaps,
    rivers: packingRivers(tree),
    invalidJunctions,
    stretches,
    devices,
    graphics: packingGraphics(layoutSnapshot),
    validity: packingValidity(flaps.length, leafCount, invalidJunctions.length, packingValidation),
  };
}

function packingRivers(tree: OristudioBpTreeView): OristudioBpRiver[] {
  return tree.edges
    .filter((edge) => edge.dualRiverId !== null)
    .map((edge) => ({
      id: edge.dualRiverId ?? edge.id,
      edgeId: edge.id,
      vertices: edge.vertices,
      width: edge.length,
      length: edge.length,
    }));
}

function packingInvalidJunction(
  junction: OristudioBpWasmInvalidJunction
): OristudioBpInvalidJunction {
  return {
    id: junction.id,
    flapIds: [...junction.flapIds],
    riverIds: [],
    paths: junction.polygon,
    overlap: junction.narrowness,
    message: `Flaps ${junction.flapIds.join(' and ')} overlap by ${formatSigned(Math.abs(junction.narrowness))}`,
  };
}

function packingGraphics(
  layoutSnapshot: OristudioBpWasmLayoutSnapshot | null
): OristudioBpGraphicPrimitive[] {
  if (!layoutSnapshot) return [];
  return [
    ...layoutSnapshot.nodeGraphics.flatMap((entry) =>
      graphicsDataPrimitives(entry.id, entry.data, entry.id.startsWith('f') ? 'flap' : 'river')
    ),
    ...layoutSnapshot.deviceGraphics.flatMap((entry) =>
      graphicsDataPrimitives(entry.id, entry.data, 'device')
    ),
  ];
}

function graphicsDataPrimitives(
  id: string,
  data: OristudioBpWasmGraphicsData,
  sourceLayer: 'flap' | 'river' | 'device'
): OristudioBpGraphicPrimitive[] {
  const primitives: OristudioBpGraphicPrimitive[] = [];
  data.contours.forEach((contour, index) => {
    if (contour.outer.length > 1) {
      primitives.push({
        kind: 'polyline',
        id: `${id}:contour:${index}`,
        layer: sourceLayer === 'device' ? 'device' : 'hinge',
        points: contour.outer,
        stroke: 'currentColor',
        width: 1.3,
        closed: true,
      });
    }
    (contour.inner ?? []).forEach((inner, innerIndex) => {
      if (inner.length <= 1) return;
      primitives.push({
        kind: 'polyline',
        id: `${id}:contour:${index}:inner:${innerIndex}`,
        layer: 'hinge',
        points: inner,
        stroke: 'currentColor',
        width: 1,
        closed: true,
      });
    });
  });
  data.ridges.forEach((line, index) => {
    primitives.push({
      kind: 'line',
      id: `${id}:ridge:${index}`,
      layer: 'ridge',
      points: line,
      stroke: 'currentColor',
      width: sourceLayer === 'device' ? 1.15 : 1,
    });
  });
  (data.axisParallel ?? []).forEach((line, index) => {
    primitives.push({
      kind: 'line',
      id: `${id}:axis:${index}`,
      layer: 'axis-parallel',
      points: line,
      stroke: 'currentColor',
      width: 0.9,
    });
  });
  if (data.location) {
    primitives.push({
      kind: 'circle',
      id: `${id}:location`,
      layer: sourceLayer,
      center: data.location,
      radius: 0.16,
      fill: 'currentColor',
    });
  }
  return primitives;
}

function packingValidity(
  flapCount: number,
  leafCount: number,
  invalidJunctionCount: number,
  packingValidation: OristudioBpWasmPackingValidation | null
): OristudioBpPackingView['validity'] {
  if (flapCount === 0 && leafCount > 0) return 'stale';
  if (invalidJunctionCount > 0) return 'invalid';
  if (packingValidation && !packingValidation.valid) return 'invalid';
  if (flapCount >= leafCount) return 'valid';
  return 'stale';
}

function manualPackingValidationMessage(message: string): string {
  return message
    .replace(/^Box Pleating Studio optimization failed: /u, '')
    .replace(/^invalid Box Pleating Studio input: /u, '')
    .replaceAll('Optimizer result', 'Current packing')
    .replaceAll('Optimizer returns', 'Current packing has')
    .replaceAll('optimizer hierarchy', 'BP tree hierarchy');
}

function packingFlap(
  flap: { id: number; x: number; y: number; width: number; height: number },
  vertices: OristudioBpRawVertex[],
  edges: OristudioBpRawEdge[]
): OristudioBpFlap {
  const vertex = vertices.find((candidate) => candidate.id === flap.id);
  return {
    id: flap.id,
    vertexId: flap.id,
    name: vertex?.name ?? `f${flap.id}`,
    anchor: { x: flap.x, y: flap.y },
    width: flap.width,
    height: flap.height,
    radius: radiusForFlap(flap.id, edges) ?? Math.max(flap.width, flap.height) / 2,
    constrained: true,
  };
}

function packingStretch(stretch: OristudioBpRawStretch): OristudioBpStretch {
  const configuration = activeConfiguration(stretch);
  const pattern = activePattern(stretch, configuration);
  const patternCount = configuration?.patterns?.length ?? null;
  return {
    id: stretch.id,
    flapIds: [],
    riverIds: [],
    completed: Boolean(stretch.repo || stretch.configuration),
    configIndex: stretch.repo?.index ?? configuration?.index ?? null,
    configCount: stretch.repo?.configurations.length ?? (configuration ? 1 : null),
    patternIndex: configuration?.index ?? null,
    patternCount,
    patternFound: pattern ? true : patternCount === null ? null : false,
  };
}

function packingDevices(
  stretch: OristudioBpRawStretch,
  deviceGraphics: Map<string, OristudioBpWasmGraphicsData>
): OristudioBpDevice[] {
  const configuration = activeConfiguration(stretch);
  const pattern = activePattern(stretch, configuration);
  return (pattern?.devices ?? []).map((device, index) => {
    const id = `${stretch.id}:device:${index}`;
    const data = deviceGraphics.get(id) ?? null;
    const position = data?.location ?? devicePosition(device);
    const forward = data?.forward ?? null;
    const rangeScalar = data?.range ?? null;
    return {
      id,
      stretchId: stretch.id,
      position,
      range: deviceRange(position, rangeScalar, forward),
      rangeScalar,
      forward,
    };
  });
}

function activeConfiguration(stretch: OristudioBpRawStretch): OristudioBpRawConfiguration | null {
  if (stretch.configuration) return stretch.configuration;
  const index = stretch.repo?.index ?? null;
  if (index === null) return null;
  return stretch.repo?.configurations[index] ?? null;
}

function activePattern(
  stretch: OristudioBpRawStretch,
  configuration: OristudioBpRawConfiguration | null
): OristudioBpRawPattern | null {
  if (stretch.pattern) return stretch.pattern;
  const index = configuration?.index ?? null;
  if (index === null) return null;
  return configuration?.patterns?.[index] ?? null;
}

function devicePosition(device: OristudioBpRawDevice) {
  const firstPiece = device.gadgets
    .flatMap((gadget) =>
      typeof gadget === 'object' && gadget && 'pieces' in gadget
        ? (gadget as { pieces?: unknown[] }).pieces ?? []
        : []
    )
    .find((piece): piece is { ox?: number; oy?: number } => typeof piece === 'object' && piece !== null);
  return {
    x: typeof firstPiece?.ox === 'number' ? firstPiece.ox : 0,
    y: typeof firstPiece?.oy === 'number' ? firstPiece.oy : 0,
  };
}

function deviceRange(
  location: Point,
  range: [number, number] | null,
  forward: boolean | null
): [Point, Point] | null {
  if (!range || forward === null) return null;
  return [
    deviceLocationAt(location, range[0], forward),
    deviceLocationAt(location, range[1], forward),
  ];
}

function deviceLocationAt(location: Point, dx: number, forward: boolean): Point {
  return {
    x: location.x + dx,
    y: location.y + (forward ? dx : -dx),
  };
}

function deviceIdFromGraphicsId(id: string): string {
  const match = /^s(.+)\.(\d+)$/.exec(id);
  return match ? `${match[1]}:device:${match[2]}` : id;
}


function sheet(raw: OristudioBpRawSheet): OristudioBpSheet {
  const kind = raw.type === 'diag' ? 'diagonal' : 'rectangular';
  return {
    kind,
    width: raw.width,
    height: raw.height,
    grid: grid(raw),
  };
}

function grid(raw: OristudioBpRawSheet): OristudioBpGrid {
  return {
    kind: raw.type === 'diag' ? 'diagonal' : 'rectangular',
    interval: 1,
    snap: true,
  };
}

function vertexDegrees(edges: OristudioBpRawEdge[]): Map<number, number> {
  const degrees = new Map<number, number>();
  for (const edge of edges) {
    degrees.set(edge.n1, (degrees.get(edge.n1) ?? 0) + 1);
    degrees.set(edge.n2, (degrees.get(edge.n2) ?? 0) + 1);
  }
  return degrees;
}

function radiusForFlap(id: number, edges: OristudioBpRawEdge[]): number | null {
  const edge = edges.find((candidate) => candidate.n1 === id || candidate.n2 === id);
  return edge?.length ?? null;
}

function formatSigned(value: number): string {
  const rounded = Math.abs(value) < 0.000_001 ? 0 : value;
  return rounded.toLocaleString(undefined, {
    maximumFractionDigits: 3,
  });
}

function historySummary(project: OristudioBpRawProject): OristudioBpHistorySummary {
  const index = project.history?.index ?? 0;
  const steps = project.history?.steps.length ?? 0;
  return {
    pastCount: index,
    futureCount: Math.max(0, steps - index),
    activeLabel: null,
  };
}

function defaultOptimizerState(): OristudioBpOptimizerState {
  return {
    running: false,
    options: {
      openNew: false,
      useDimension: true,
      layoutMode: 'view',
      useBasinHopping: true,
      respectSymmetry: true,
      randomCandidateCount: 100,
      seed: null,
    },
    progress: {
      stage: 'idle',
      label: 'Idle',
      current: null,
      total: null,
      canSkip: false,
      canCancel: false,
      message: null,
    },
    lastError: null,
    lastResultValid: null,
  };
}

function defaultExportStatus(): OristudioBpExportStatus {
  return {
    busy: false,
    lastFormat: null,
    lastError: null,
  };
}
