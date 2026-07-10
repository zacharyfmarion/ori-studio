import type {
  OristudioBpDocumentState,
  OristudioBpSelection,
} from '../engine/oristudioBpTypes';

export interface OristudioBpLinkedSelection {
  vertices: Set<number>;
  edges: Set<number>;
  flaps: Set<number>;
  rivers: Set<number>;
  stretches: Set<string>;
  devices: Set<string>;
  invalidJunctions: Set<string>;
}

export function bpLinkedSelection(
  selection: OristudioBpSelection,
  document: OristudioBpDocumentState
): OristudioBpLinkedSelection {
  const linked: OristudioBpLinkedSelection = {
    vertices: new Set(),
    edges: new Set(),
    flaps: new Set(),
    rivers: new Set(),
    stretches: new Set(),
    devices: new Set(),
    invalidJunctions: new Set(),
  };
  const addVertex = (id: number) => {
    linked.vertices.add(id);
    const vertex = document.snapshot.tree.vertices.find((candidate) => candidate.id === id);
    if (vertex?.dualFlapId !== null && vertex?.dualFlapId !== undefined) {
      linked.flaps.add(vertex.dualFlapId);
    }
  };
  const addEdge = (id: number) => {
    linked.edges.add(id);
    const edge = document.snapshot.tree.edges.find((candidate) => candidate.id === id);
    if (!edge) return;
    if (edge.dualRiverId !== null) {
      linked.rivers.add(edge.dualRiverId);
      return;
    }
    for (const vertexId of edge.vertices) {
      const vertex = document.snapshot.tree.vertices.find((candidate) => candidate.id === vertexId);
      if (vertex?.isLeaf && vertex.dualFlapId !== null) linked.flaps.add(vertex.dualFlapId);
    }
  };
  const addFlap = (id: number) => {
    linked.flaps.add(id);
    const flap = document.snapshot.packing.flaps.find((candidate) => candidate.id === id);
    if (flap) linked.vertices.add(flap.vertexId);
  };
  const addRiver = (id: number) => {
    linked.rivers.add(id);
    const river = document.snapshot.packing.rivers.find((candidate) => candidate.id === id);
    if (river) linked.edges.add(river.edgeId);
  };
  const addStretch = (id: string) => {
    linked.stretches.add(id);
    const stretch = document.snapshot.packing.stretches.find((candidate) => candidate.id === id);
    if (!stretch) return;
    for (const flapId of stretch.flapIds) addFlap(flapId);
    for (const riverId of stretch.riverIds) addRiver(riverId);
    for (const device of document.snapshot.packing.devices) {
      if (device.stretchId === id) linked.devices.add(device.id);
    }
  };
  const addDevice = (id: string) => {
    linked.devices.add(id);
    const device = document.snapshot.packing.devices.find((candidate) => candidate.id === id);
    if (device) addStretch(device.stretchId);
  };
  const addInvalidJunction = (id: string) => {
    linked.invalidJunctions.add(id);
    const junction = document.snapshot.packing.invalidJunctions.find(
      (candidate) => candidate.id === id
    );
    if (!junction) return;
    for (const flapId of junction.flapIds) addFlap(flapId);
    for (const riverId of junction.riverIds) addRiver(riverId);
  };

  if (selection.kind === 'bp-vertex') addVertex(selection.id);
  if (selection.kind === 'bp-edge') addEdge(selection.id);
  if (selection.kind === 'bp-flap') addFlap(selection.id);
  if (selection.kind === 'bp-river') addRiver(selection.id);
  if (selection.kind === 'bp-stretch') addStretch(selection.id);
  if (selection.kind === 'bp-device') addDevice(selection.id);
  if (selection.kind === 'bp-invalid-junction') addInvalidJunction(selection.id);
  if (selection.kind === 'bp-multi') {
    selection.vertices.forEach(addVertex);
    selection.edges.forEach(addEdge);
    selection.flaps.forEach(addFlap);
    selection.rivers.forEach(addRiver);
    selection.stretches.forEach(addStretch);
    selection.devices.forEach(addDevice);
    selection.invalidJunctions.forEach(addInvalidJunction);
  }

  return linked;
}

export function isBpVertexSelected(selection: OristudioBpSelection, id: number): boolean {
  if (selection.kind === 'bp-vertex') return selection.id === id;
  if (selection.kind === 'bp-multi') return selection.vertices.includes(id);
  return false;
}

export function isBpEdgeSelected(selection: OristudioBpSelection, id: number): boolean {
  if (selection.kind === 'bp-edge') return selection.id === id;
  if (selection.kind === 'bp-multi') return selection.edges.includes(id);
  return false;
}

export function isBpFlapSelected(selection: OristudioBpSelection, id: number): boolean {
  if (selection.kind === 'bp-flap') return selection.id === id;
  if (selection.kind === 'bp-multi') return selection.flaps.includes(id);
  return false;
}

export function isBpRiverSelected(selection: OristudioBpSelection, id: number): boolean {
  if (selection.kind === 'bp-river') return selection.id === id;
  if (selection.kind === 'bp-multi') return selection.rivers.includes(id);
  return false;
}

export function isBpInvalidJunctionSelected(
  selection: OristudioBpSelection,
  id: string
): boolean {
  if (selection.kind === 'bp-invalid-junction') return selection.id === id;
  if (selection.kind === 'bp-multi') return selection.invalidJunctions.includes(id);
  return false;
}

export function bpSelectionSize(selection: OristudioBpSelection): number {
  if (selection.kind === 'bp-tree') return 0;
  if (selection.kind !== 'bp-multi') return 1;
  return (
    selection.vertices.length +
    selection.edges.length +
    selection.flaps.length +
    selection.rivers.length +
    selection.stretches.length +
    selection.devices.length +
    selection.invalidJunctions.length
  );
}

export function toggleBpVertexSelection(
  selection: OristudioBpSelection,
  id: number
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const vertices = multi.vertices.includes(id)
    ? multi.vertices.filter((candidate) => candidate !== id)
    : [...multi.vertices, id];
  return normalizeBpMultiSelection({ ...multi, vertices });
}

export function toggleBpEdgeSelection(
  selection: OristudioBpSelection,
  id: number
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const edges = multi.edges.includes(id)
    ? multi.edges.filter((candidate) => candidate !== id)
    : [...multi.edges, id];
  return normalizeBpMultiSelection({ ...multi, edges });
}

export function toggleBpFlapSelection(
  selection: OristudioBpSelection,
  id: number
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const flaps = multi.flaps.includes(id)
    ? multi.flaps.filter((candidate) => candidate !== id)
    : [...multi.flaps, id];
  return normalizeBpMultiSelection({ ...multi, flaps });
}

export function toggleBpRiverSelection(
  selection: OristudioBpSelection,
  id: number
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const rivers = multi.rivers.includes(id)
    ? multi.rivers.filter((candidate) => candidate !== id)
    : [...multi.rivers, id];
  return normalizeBpMultiSelection({ ...multi, rivers });
}

export function toggleBpInvalidJunctionSelection(
  selection: OristudioBpSelection,
  id: string
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const invalidJunctions = multi.invalidJunctions.includes(id)
    ? multi.invalidJunctions.filter((candidate) => candidate !== id)
    : [...multi.invalidJunctions, id];
  return normalizeBpMultiSelection({ ...multi, invalidJunctions });
}

export function toggleBpDeviceSelection(
  selection: OristudioBpSelection,
  id: string
): OristudioBpSelection {
  const multi = toBpMultiSelection(selection);
  const devices = multi.devices.includes(id)
    ? multi.devices.filter((candidate) => candidate !== id)
    : [...multi.devices, id];
  return normalizeBpMultiSelection({ ...multi, devices });
}

export function bpSelectionSummary(selection: OristudioBpSelection): string {
  if (selection.kind === 'bp-tree') return 'Tree';
  if (selection.kind === 'bp-vertex') return `Vertex ${selection.id}`;
  if (selection.kind === 'bp-edge') return `Edge ${selection.id}`;
  if (selection.kind === 'bp-flap') return `Flap ${selection.id}`;
  if (selection.kind === 'bp-river') return `River ${selection.id}`;
  if (selection.kind === 'bp-stretch') return `Stretch ${selection.id}`;
  if (selection.kind === 'bp-device') return `Device ${selection.id}`;
  if (selection.kind === 'bp-invalid-junction') return `Conflict ${selection.id}`;

  const parts: string[] = [];
  if (selection.vertices.length > 0) parts.push(`${selection.vertices.length} vertices`);
  if (selection.edges.length > 0) parts.push(`${selection.edges.length} edges`);
  if (selection.flaps.length > 0) parts.push(`${selection.flaps.length} flaps`);
  if (selection.rivers.length > 0) parts.push(`${selection.rivers.length} rivers`);
  if (selection.stretches.length > 0) parts.push(`${selection.stretches.length} stretches`);
  if (selection.devices.length > 0) parts.push(`${selection.devices.length} devices`);
  if (selection.invalidJunctions.length > 0) {
    parts.push(`${selection.invalidJunctions.length} conflicts`);
  }
  return parts.join(', ') || 'Tree';
}

function toBpMultiSelection(
  selection: OristudioBpSelection
): Extract<OristudioBpSelection, { kind: 'bp-multi' }> {
  if (selection.kind === 'bp-multi') return selection;
  return {
    kind: 'bp-multi',
    vertices: selection.kind === 'bp-vertex' ? [selection.id] : [],
    edges: selection.kind === 'bp-edge' ? [selection.id] : [],
    flaps: selection.kind === 'bp-flap' ? [selection.id] : [],
    rivers: selection.kind === 'bp-river' ? [selection.id] : [],
    stretches: selection.kind === 'bp-stretch' ? [selection.id] : [],
    devices: selection.kind === 'bp-device' ? [selection.id] : [],
    invalidJunctions: selection.kind === 'bp-invalid-junction' ? [selection.id] : [],
  };
}

function normalizeBpMultiSelection(
  selection: Extract<OristudioBpSelection, { kind: 'bp-multi' }>
): OristudioBpSelection {
  const size = bpSelectionSize(selection);
  if (size === 0) return { kind: 'bp-tree' };
  if (
    size === 1 &&
    selection.vertices.length === 1 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-vertex', id: selection.vertices[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 1 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-edge', id: selection.edges[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 1 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-flap', id: selection.flaps[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 1 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-river', id: selection.rivers[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 1 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-stretch', id: selection.stretches[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 1 &&
    selection.invalidJunctions.length === 0
  ) {
    return { kind: 'bp-device', id: selection.devices[0] };
  }
  if (
    size === 1 &&
    selection.vertices.length === 0 &&
    selection.edges.length === 0 &&
    selection.flaps.length === 0 &&
    selection.rivers.length === 0 &&
    selection.stretches.length === 0 &&
    selection.devices.length === 0 &&
    selection.invalidJunctions.length === 1
  ) {
    return { kind: 'bp-invalid-junction', id: selection.invalidJunctions[0] };
  }
  return selection;
}
