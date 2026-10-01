// The per-edge code `MeshTopology.edgeAssignments` carries, stated once.
//
// Three consumers read it — the GPU edge pass, the face merge and the scene
// producer — and each used to declare its own copy of the numbers. The two
// flat kinds are told apart on purpose: a source `F` edge is a crease someone
// drew (an auxiliary line, folded flat) and may be inked, while a triangulation
// diagonal is an artifact of `prepareFoldModel` and must never be. The GPU pass
// draws codes 0..2 and skips the rest, so both stay invisible there.

export const EDGE_CODE = {
  /** Paper boundary: `B`, and the unassigned `U` / `C` / `J`, which read as one. */
  border: 0,
  mountain: 1,
  valley: 2,
  /** A source `F` edge: an auxiliary crease lying flat on the sheet. */
  aux: 3,
  /** A triangulation diagonal: two triangles of one source face meet here. */
  facet: 4,
} as const;

export type EdgeCode = (typeof EDGE_CODE)[keyof typeof EDGE_CODE];
