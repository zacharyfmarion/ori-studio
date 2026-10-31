// Lays a packed model out for the WebGPU passes (passes.ts): every read-only
// array in one `staticData` buffer, and the uniform that says where each one
// starts.
//
// The arrays are exactly the ones webgl/packing.ts builds for the WebGL2
// textures, padding included, so both GPU backends read the same bytes. Only
// the container differs: thirteen textures there, one buffer here, because the
// force pass would otherwise need more storage buffers than WebGPU guarantees.
import { packBeamMeta, packCreaseMeta, type PackedModel, type SolverMaterial } from '../webgl/packing.js';
import { PARAMS_VEC4S } from './passes.js';

/**
 * staticData's arrays, in the order the kernels' `off0`..`off3` slots name
 * them. Changing the order means changing PARAMS in passes.ts with it.
 */
export const STATIC_ARRAYS = [
  'originalPosition',
  'externalForces',
  'mass',
  'meta',
  'meta2',
  'beamMeta',
  'creaseMeta',
  'creaseMeta2',
  'creaseVectors',
  'nodeCreaseMeta',
  'nodeFaceMeta',
  'faceVertexIndices',
  'nominalTriangles',
] as const;

export type StaticArray = (typeof STATIC_ARRAYS)[number];

export interface StaticLayout {
  /** Every array, concatenated in {@link STATIC_ARRAYS} order. */
  data: Float32Array;
  /** Where each array starts, in vec4s (the unit the kernels index by). */
  offsets: Record<StaticArray, number>;
}

/** The arrays whose contents depend on the material, rebuilt on `setMaterial`. */
export function materialArrays(
  packed: PackedModel,
  material: SolverMaterial
): Pick<Record<StaticArray, Float32Array>, 'beamMeta' | 'creaseMeta'> {
  return { beamMeta: packBeamMeta(packed, material), creaseMeta: packCreaseMeta(packed, material) };
}

export function packStaticData(packed: PackedModel, material: SolverMaterial): StaticLayout {
  const arrays: Record<StaticArray, Float32Array> = {
    originalPosition: packed.originalPosition,
    externalForces: packed.externalForces,
    mass: packed.mass,
    meta: packed.meta,
    meta2: packed.meta2,
    ...materialArrays(packed, material),
    creaseMeta2: packed.creaseMeta2,
    creaseVectors: packed.creaseVectors,
    nodeCreaseMeta: packed.nodeCreaseMeta,
    nodeFaceMeta: packed.nodeFaceMeta,
    faceVertexIndices: packed.faceVertexIndices,
    nominalTriangles: packed.nominalTriangles,
  };
  const offsets = {} as Record<StaticArray, number>;
  let total = 0;
  for (const name of STATIC_ARRAYS) {
    offsets[name] = total / 4;
    total += arrays[name].length;
  }
  const data = new Float32Array(total);
  for (const name of STATIC_ARRAYS) data.set(arrays[name], offsets[name] * 4);
  return { data, offsets };
}

/** What the `Params` uniform holds, apart from the offsets. */
export interface SolverParams {
  nodes: number;
  faces: number;
  creases: number;
  /** The fold target as a fraction, 0..1. */
  creasePercent: number;
  dt: number;
  axialStiffness: number;
  faceStiffness: number;
  /** Creases aim at the rest angles theta carries, not the fold target. */
  posed: boolean;
  /** How far a posed fold crease yields during a pull, in radians; 0 when not pulling. */
  yieldRadians: number;
  /** The pull's grip, or null when nothing is pulled. */
  grip: GripUniform | null;
}

/** The pull as the force pass reads it: pull.ts's grip and its parameters. */
export interface GripUniform {
  nodes: readonly [number, number, number];
  weights: readonly [number, number, number];
  rayOrigin: readonly [number, number, number];
  rayDirection: readonly [number, number, number];
  stiffness: number;
  damping: number;
  maxForce: number;
  bias: number;
}

/** The `Params` uniform: {@link PARAMS_VEC4S} vec4s, laid out as PARAMS in passes.ts declares them. */
export function packParams(params: SolverParams, offsets: Record<StaticArray, number>): Float32Array {
  const out = new Float32Array(PARAMS_VEC4S * 4);
  out.set([params.nodes, params.faces, params.creases, 0], 0);
  out.set([params.creasePercent, params.dt, params.axialStiffness, params.faceStiffness], 4);
  // flags.x, calcFaceStrain: off, as WebglSolver runs it.
  out.set(STATIC_ARRAYS.map((name) => offsets[name]), 12);
  const grip = params.grip;
  out.set([params.posed ? 1 : 0, grip ? 1 : 0, params.yieldRadians, grip ? 1 : 0], 28);
  if (grip) {
    out.set(grip.nodes, 32);
    out.set(grip.weights, 36);
    out.set(grip.rayOrigin, 40);
    out.set(grip.rayDirection, 44);
    out.set([grip.stiffness, grip.damping, grip.maxForce, grip.bias], 48);
  }
  return out;
}
