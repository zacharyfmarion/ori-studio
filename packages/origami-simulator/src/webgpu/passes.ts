// The solver's compute passes for WebGPU: both integrators, the pull and the
// pose, as kernels over storage buffers.
//
// Adapted from the WebGPU port of Origami Simulator
// (github.com/jamescarruthers/OrigamiSimulatorWebGPU, js/dynamic/WebGPUSolver.js
// at 05466ff, MIT), which transliterates upstream's shader blocks. The changes
// from that port bring it to what webgl/passes.ts does, so that both GPU
// backends agree with ReferenceSolver where upstream is undefined or silent:
//
//   - safeNormalize in normalCalc and thetaCalc;
//   - a beam whose ends have collapsed onto each other is skipped;
//   - each acos input is clamped to [-1, 1];
//   - Verlet pins non-finite results to 0, as ReferenceSolver does;
//   - the pull's grip force and the pose's rest angles (pull.ts).
//
// One deliberate difference from webgl/passes.ts: the per-node loops have no
// cap. GLSL ES 1.00 needs a constant bound, so the WebGL2 shaders stop at 100
// beams, creases or faces per node; WGSL does not, and with no cap the loops
// match ReferenceSolver on any valence.
//
// Data layout: every packed array webgl/packing.ts builds is concatenated, in
// the order of STATIC_ARRAYS (packing.ts here), into one read-only `staticData`
// buffer, with each array's start in `params.off*`. One buffer instead of
// thirteen keeps the Verlet force pass at WebGPU's guaranteed limit of 8
// storage buffers per stage, rather than over it.

import { POSE_REST_LENGTH_TOLERANCE } from '../pull.js';

/** Invocations per workgroup, for every pass. */
export const WORKGROUP_SIZE = 64;

/** Vec4s in the `Params` uniform; packParams (packing.ts) fills them. */
export const PARAMS_VEC4S = 13;

const PARAMS = /* wgsl */ `
struct Params {
  counts      : vec4<f32>,   // (nodes, faces, creases, _)
  sim         : vec4<f32>,   // (creasePercent, dt, axialStiffness, faceStiffness)
  flags       : vec4<f32>,   // (calcFaceStrain, _, _, _)
  off0        : vec4<f32>,   // (originalPosition, externalForces, mass, meta)
  off1        : vec4<f32>,   // (meta2, beamMeta, creaseMeta, creaseMeta2)
  off2        : vec4<f32>,   // (creaseVectors, nodeCreaseMeta, nodeFaceMeta, faceVertexIndices)
  off3        : vec4<f32>,   // (nominalTriangles, _, _, _)
  pose        : vec4<f32>,   // (posed, pulling, yield, gripActive)
  gripNodes   : vec4<f32>,   // (node0, node1, node2, _)
  gripWeights : vec4<f32>,   // (w0, w1, w2, _)
  rayOrigin   : vec4<f32>,
  rayDir      : vec4<f32>,
  grip        : vec4<f32>,   // (stiffness, damping, maxForce, bias)
};
`;

const STATIC = /* wgsl */ `
fn sOriginalPosition(i : u32) -> vec4<f32> { return staticData[u32(params.off0.x) + i]; }
fn sExternalForces(i : u32)   -> vec4<f32> { return staticData[u32(params.off0.y) + i]; }
fn sMass(i : u32)             -> vec4<f32> { return staticData[u32(params.off0.z) + i]; }
fn sMeta(i : u32)             -> vec4<f32> { return staticData[u32(params.off0.w) + i]; }
fn sMeta2(i : u32)            -> vec4<f32> { return staticData[u32(params.off1.x) + i]; }
fn sBeamMeta(i : u32)         -> vec4<f32> { return staticData[u32(params.off1.y) + i]; }
fn sCreaseMeta(i : u32)       -> vec4<f32> { return staticData[u32(params.off1.z) + i]; }
fn sCreaseMeta2(i : u32)      -> vec4<f32> { return staticData[u32(params.off1.w) + i]; }
fn sCreaseVectors(i : u32)    -> vec4<f32> { return staticData[u32(params.off2.x) + i]; }
fn sNodeCreaseMeta(i : u32)   -> vec4<f32> { return staticData[u32(params.off2.y) + i]; }
fn sNodeFaceMeta(i : u32)     -> vec4<f32> { return staticData[u32(params.off2.z) + i]; }
fn sFaceVertexIndices(i : u32)-> vec4<f32> { return staticData[u32(params.off2.w) + i]; }
fn sNominalTriangles(i : u32) -> vec4<f32> { return staticData[u32(params.off3.x) + i]; }
fn getPos(i : u32) -> vec3<f32> { return lastPosition[i].xyz + sOriginalPosition(i).xyz; }

// Ori Studio: see SAFE_NORMALIZE in webgl/passes.ts.
fn safeNormalize(v : vec3<f32>) -> vec3<f32> {
  let len = length(v);
  if (len <= 0.000001) { return vec3<f32>(0.0, 1.0, 0.0); }
  return v / len;
}
`;

export const NORMAL_CALC = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> normals      : array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             params       : Params;
${STATIC}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.y)) { return; }
  let idx = sFaceVertexIndices(i);
  let a = getPos(u32(idx.x));
  let b = getPos(u32(idx.y));
  let c = getPos(u32(idx.z));
  normals[i] = vec4<f32>(safeNormalize(cross(b - a, c - a)), 0.0); // Ori Studio: safeNormalize
}`;

export const THETA_CALC = /* wgsl */ `
${PARAMS}
const TWO_PI : f32 = 6.283185307179586;
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       normals      : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       lastTheta    : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> theta        : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read>       creasePull   : array<vec4<f32>>;
@group(0) @binding(6) var<uniform>             params       : Params;
${STATIC}

// Ori Studio: restSlot in webgl/passes.ts. Upstream writes the step's change of
// angle into .y and nothing reads it; a posed crease carries its rest angle
// there instead, yielding during a pull as pull.ts's yieldedRest does.
fn restSlot(i : u32, th : f32, diff : f32, lastRest : f32) -> f32 {
  if (params.pose.x < 0.5) { return diff; }
  if (params.pose.y < 0.5) { return lastRest; }
  let pull = creasePull[i];
  if (pull.y < 0.5) { return lastRest; }
  let freeAngle = th - pull.x;
  return clamp(lastRest, freeAngle - params.pose.z, freeAngle + params.pose.z);
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.z)) { return; }
  let lt = lastTheta[i];
  if (lt.z < 0.0) { theta[i] = vec4<f32>(lt.x, 0.0, -1.0, -1.0); return; }
  let normal1 = normals[u32(lt.z)].xyz;
  let normal2 = normals[u32(lt.w)].xyz;
  let dotNormals = clamp(dot(normal1, normal2), -1.0, 1.0);
  let cv = sCreaseVectors(i);
  let node0 = getPos(u32(cv.x));
  let node1 = getPos(u32(cv.y));
  let creaseVector = safeNormalize(node1 - node0); // Ori Studio: safeNormalize
  let x = dotNormals;
  let y = dot(cross(normal1, creaseVector), normal2);
  let th0 = atan2(y, x);
  var diff = th0 - lt.x;
  if (diff < -5.0) { diff = diff + TWO_PI; } else if (diff > 5.0) { diff = diff - TWO_PI; }
  let th = lt.x + diff;
  theta[i] = vec4<f32>(th, restSlot(i, th, diff, lt.y), lt.z, lt.w);
}`;

export const CREASE_GEO_CALC = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> creaseGeo    : array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             params       : Params;
${STATIC}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.z)) { return; }
  let cm = sCreaseMeta2(i);
  let node1 = getPos(u32(cm.x));
  let node2 = getPos(u32(cm.y));
  let node3 = getPos(u32(cm.z));
  let node4 = getPos(u32(cm.w));
  let tol = 0.000001;
  var creaseVector = node4 - node3;
  let creaseLength = length(creaseVector);
  if (abs(creaseLength) < tol) { creaseGeo[i] = vec4<f32>(-1.0); return; }
  creaseVector = creaseVector / creaseLength;
  let vector1 = node1 - node3;
  let vector2 = node2 - node3;
  let proj1Length = dot(creaseVector, vector1);
  let proj2Length = dot(creaseVector, vector2);
  let dist1 = sqrt(abs(dot(vector1, vector1) - proj1Length * proj1Length));
  let dist2 = sqrt(abs(dot(vector2, vector2) - proj2Length * proj2Length));
  if (dist1 < tol || dist2 < tol) { creaseGeo[i] = vec4<f32>(-1.0); return; }
  creaseGeo[i] = vec4<f32>(dist1, dist2, proj1Length / creaseLength, proj2Length / creaseLength);
}`;

/**
 * The per-node force, shared by both integrators as webgl/passes.ts shares it:
 * they differ only in what they do with it. `POSED` is a pipeline-overridable
 * constant rather than a runtime branch, as the GLSL uses a compile-time
 * variant: the unposed fold target must be formed exactly as upstream forms it.
 */
const FORCE = /* wgsl */ `
override POSED : bool = false;

// pull.ts's gripForce: toward the ray across it, damped across it, toward the
// eye by the bias, capped.
fn gripForce() -> vec3<f32> {
  let n = vec3<u32>(params.gripNodes.xyz);
  let w = params.gripWeights.xyz;
  let point = w.x * getPos(n.x) + w.y * getPos(n.y) + w.z * getPos(n.z);
  let vel = w.x * lastVelocity[n.x].xyz + w.y * lastVelocity[n.y].xyz + w.z * lastVelocity[n.z].xyz;
  let origin = params.rayOrigin.xyz;
  let dir = params.rayDir.xyz;
  let toRay = origin + dir * dot(point - origin, dir) - point;
  let across = vel - dir * dot(vel, dir);
  let stiffness = params.grip.x;
  var force = stiffness * toRay - params.grip.y * across - params.grip.w * stiffness * length(toRay) * dir;
  let size = length(force);
  if (size > params.grip.z && size > 0.0) { force = force * (params.grip.z / size); }
  return force;
}

// This node's share of the grip: its weight, summed if it fills two slots.
fn gripShare(i : u32) -> f32 {
  var share = 0.0;
  let n = vec3<u32>(params.gripNodes.xyz);
  if (n.x == i) { share = share + params.gripWeights.x; }
  if (n.y == i) { share = share + params.gripWeights.y; }
  if (n.z == i) { share = share + params.gripWeights.z; }
  return share;
}

struct Force { force : vec3<f32>, nodeError : f32 };

fn nodeForce(i : u32) -> Force {
  let creasePercent = params.sim.x;
  let faceStiffness = params.sim.w;
  let calcFaceStrain = params.flags.x > 0.5;

  var force = sExternalForces(i).xyz;
  let lastPositionI = lastPosition[i].xyz;
  let lastVelocityI = lastVelocity[i].xyz;
  let originalPositionI = sOriginalPosition(i).xyz;
  let metaI = sMeta(i);
  let meta2I = sMeta2(i).xy;
  var nodeError = 0.0;

  // beams
  let numBeams = u32(metaI.y);
  for (var j = 0u; j < numBeams; j = j + 1u) {
    let bm = sBeamMeta(u32(metaI.x) + j);       // (k, d, length, otherNodeIndex)
    let nIdx = u32(bm.w);
    let nominalDist = sOriginalPosition(nIdx).xyz - originalPositionI;
    var deltaP = lastPosition[nIdx].xyz - lastPositionI + nominalDist;
    let deltaPLength = length(deltaP);
    // Ori Studio: skip a collapsed beam, as webgl/passes.ts does, rather than divide by zero.
    if (deltaPLength < 0.000001) { continue; }
    deltaP = deltaP - deltaP * (bm.z / deltaPLength);
    if (!calcFaceStrain) { nodeError = nodeError + abs(deltaPLength / length(nominalDist) - 1.0); }
    let deltaV = lastVelocity[nIdx].xyz - lastVelocityI;
    force = force + deltaP * bm.x + deltaV * bm.y;
  }
  if (!calcFaceStrain) { nodeError = nodeError / metaI.y; }

  // creases
  let numCreases = u32(metaI.w);
  for (var j = 0u; j < numCreases; j = j + 1u) {
    let ncm = sNodeCreaseMeta(u32(metaI.z) + j); // (creaseIndex, nodeNum, _, _)
    let cIdx = u32(ncm.x);
    let thetas = theta[cIdx];                    // (theta, rest or diff, n1Index, n2Index)
    let cMeta = sCreaseMeta(cIdx).xyz;           // (k, d, targetTheta)
    let cGeo = creaseGeo[cIdx];                  // (h1, h2, coef1, coef2)
    if (cGeo.x < 0.0) { continue; }
    var targetTheta : f32;
    if (POSED) { targetTheta = thetas.y; } else { targetTheta = cMeta.z * creasePercent; }
    let angForce = cMeta.x * (targetTheta - thetas.x);
    let nodeNum = ncm.y;
    if (nodeNum > 2.0) {                         // node lies on the crease (reaction)
      let normal1 = normals[u32(thetas.z)].xyz;
      let normal2 = normals[u32(thetas.w)].xyz;
      var coef1 = cGeo.z;
      var coef2 = cGeo.w;
      if (nodeNum == 3.0) { coef1 = 1.0 - coef1; coef2 = 1.0 - coef2; }
      force = force - angForce * (coef1 / cGeo.x * normal1 + coef2 / cGeo.y * normal2);
    } else {
      var normalIndex = u32(thetas.z);
      var momentArm = cGeo.x;
      if (nodeNum == 2.0) { normalIndex = u32(thetas.w); momentArm = cGeo.y; }
      force = force + angForce / momentArm * normals[normalIndex].xyz;
    }
  }

  // faces
  let numFaces = u32(meta2I.y);
  for (var j = 0u; j < numFaces; j = j + 1u) {
    let fm = sNodeFaceMeta(u32(meta2I.x) + j);   // (faceIndex, a, b, c)
    let nominalAngles = sNominalTriangles(u32(fm.x)).xyz;
    var faceIndex = 0u;
    if (fm.z < 0.0) { faceIndex = 1u; }
    if (fm.w < 0.0) { faceIndex = 2u; }
    let selfPos = lastPositionI + originalPositionI;
    var a : vec3<f32>; var b : vec3<f32>; var c : vec3<f32>;
    if (faceIndex == 0u) { a = selfPos; } else { a = getPos(u32(fm.y)); }
    if (faceIndex == 1u) { b = selfPos; } else { b = getPos(u32(fm.z)); }
    if (faceIndex == 2u) { c = selfPos; } else { c = getPos(u32(fm.w)); }
    var ab = b - a;
    var ac = c - a;
    var bc = c - b;
    let lengthAB = length(ab);
    let lengthAC = length(ac);
    let lengthBC = length(bc);
    let tol = 0.0000001;
    if (abs(lengthAB) < tol || abs(lengthBC) < tol || abs(lengthAC) < tol) { continue; }
    ab = ab / lengthAB;
    ac = ac / lengthAC;
    bc = bc / lengthBC;
    // Ori Studio: clamp each acos input, as webgl/passes.ts does; a dot of two
    // float32 unit vectors can round past 1 and make the angle NaN.
    let angles = vec3<f32>(
      acos(clamp(dot(ab, ac), -1.0, 1.0)),
      acos(clamp(-1.0 * dot(ab, bc), -1.0, 1.0)),
      acos(clamp(dot(ac, bc), -1.0, 1.0)),
    );
    let anglesDiff = (nominalAngles - angles) * faceStiffness;
    let normal = normals[u32(fm.x)].xyz;
    if (faceIndex == 0u) {
      let normalCrossAC = cross(normal, ac) / lengthAC;
      let normalCrossAB = cross(normal, ab) / lengthAB;
      force = force - anglesDiff.x * (normalCrossAC - normalCrossAB);
      if (calcFaceStrain) { nodeError = nodeError + abs((nominalAngles.x - angles.x) / nominalAngles.x); }
      force = force - anglesDiff.y * normalCrossAB;
      force = force + anglesDiff.z * normalCrossAC;
    } else if (faceIndex == 1u) {
      let normalCrossAB = cross(normal, ab) / lengthAB;
      let normalCrossBC = cross(normal, bc) / lengthBC;
      force = force - anglesDiff.x * normalCrossAB;
      force = force + anglesDiff.y * (normalCrossAB + normalCrossBC);
      if (calcFaceStrain) { nodeError = nodeError + abs((nominalAngles.y - angles.y) / nominalAngles.y); }
      force = force - anglesDiff.z * normalCrossBC;
    } else {
      let normalCrossAC = cross(normal, ac) / lengthAC;
      let normalCrossBC = cross(normal, bc) / lengthBC;
      force = force + anglesDiff.x * normalCrossAC;
      force = force - anglesDiff.y * normalCrossBC;
      force = force + anglesDiff.z * (normalCrossBC - normalCrossAC);
      if (calcFaceStrain) { nodeError = nodeError + abs((nominalAngles.z - angles.z) / nominalAngles.z); }
    }
  }
  if (calcFaceStrain) { nodeError = nodeError / meta2I.y; }

  // Ori Studio: the pull (pull.ts).
  if (params.pose.w > 0.5) {
    let share = gripShare(i);
    if (share > 0.0) { force = force + share * gripForce(); }
  }
  return Force(force, nodeError);
}
`;

export const VELOCITY_CALC = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastVelocity : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       normals      : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read>       theta        : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read>       creaseGeo    : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> velocity     : array<vec4<f32>>;
@group(0) @binding(7) var<uniform>             params       : Params;
${STATIC}
${FORCE}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }
  let massI = sMass(i).xy;
  if (massI.y == 1.0) { velocity[i] = vec4<f32>(0.0); return; }   // fixed: Euler's output is a velocity
  let f = nodeForce(i);
  velocity[i] = vec4<f32>(f.force * params.sim.y / massI.x + lastVelocity[i].xyz, f.nodeError);
}`;

export const POSITION_CALC = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       velocity     : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> position     : array<vec4<f32>>;
@group(0) @binding(4) var<uniform>             params       : Params;
${STATIC}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }
  let lastPositionI = lastPosition[i].xyz;
  if (sMass(i).y == 1.0) { position[i] = vec4<f32>(lastPositionI, 0.0); return; }
  let v = velocity[i];
  position[i] = vec4<f32>(v.xyz * params.sim.y + lastPositionI, v.w);
}`;

const SANITIZE = /* wgsl */ `
// Ori Studio: ReferenceSolver pins non-finite Verlet results to 0, so the GPU
// must too. WGSL may assume no NaN or infinity in float maths, so the test is
// made on the bits.
fn sanitize(x : f32) -> f32 {
  let bits = bitcast<u32>(x) & 0x7fffffffu;
  if (bits >= 0x7f800000u || abs(x) > 1e30) { return 0.0; }
  return x;
}
fn sanitizeVec3(v : vec3<f32>) -> vec3<f32> { return vec3<f32>(sanitize(v.x), sanitize(v.y), sanitize(v.z)); }
`;

/** Verlet: the same force, applied straight to position from two steps of history. */
export const POSITION_CALC_VERLET = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData       : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition     : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastVelocity     : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       lastLastPosition : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read>       normals          : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read>       theta            : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read>       creaseGeo        : array<vec4<f32>>;
@group(0) @binding(7) var<storage, read_write> position         : array<vec4<f32>>;
@group(0) @binding(8) var<uniform>             params           : Params;
${STATIC}
${SANITIZE}
${FORCE}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }
  let massI = sMass(i).xy;
  // A fixed node keeps its position: Verlet's output is a position, not a velocity.
  if (massI.y == 1.0) { position[i] = vec4<f32>(lastPosition[i].xyz, 0.0); return; }
  let f = nodeForce(i);
  let dt = params.sim.y;
  let next = f.force * dt * dt / massI.x + 2.0 * lastPosition[i].xyz - lastLastPosition[i].xyz;
  position[i] = vec4<f32>(sanitizeVec3(next), f.nodeError);
}`;

/**
 * Verlet velocity is a diagnostic derived from how far the position moved; it
 * carries the position's strain in alpha, as webgl/passes.ts does, so strain
 * reads, colours and the blow-up guard work in Verlet mode too.
 */
export const VELOCITY_CALC_VERLET = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       position     : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> velocity     : array<vec4<f32>>;
@group(0) @binding(4) var<uniform>             params       : Params;
fn sMass(i : u32) -> vec4<f32> { return staticData[u32(params.off0.z) + i]; }
${SANITIZE}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }
  let p = position[i];
  if (sMass(i).y == 1.0) { velocity[i] = vec4<f32>(0.0, 0.0, 0.0, p.w); return; }
  velocity[i] = vec4<f32>(sanitizeVec3((p.xyz - lastPosition[i].xyz) / params.sim.y), p.w);
}`;

/**
 * Sets every crease's rest angle (theta's .y) in both theta buffers, and the
 * pull's per-crease baseline. One kernel for the three things the pull and
 * pose do to rest angles, by `mode`:
 *
 *   0  press: rest = the pose's rest if posed, else the fold target, and the
 *      pull's baseline = theta - rest. Whether a crease is a fold, the
 *      baseline's .y, is static and written once when the solver is built.
 *   1  keep: rest = theta, the angle the crease has now.
 *   2  restore: rest = pressRest, the rest angles at the press.
 *
 * WebglSolver does these as read-modify-write of its theta texture on the CPU.
 * Here the read would be asynchronous, so the edit is made where the data is.
 */
export const REST_ANGLES = /* wgsl */ `
${PARAMS}
struct RestMode { mode : vec4<f32> };
@group(0) @binding(0) var<storage, read>       staticData : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> thetaA     : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> thetaB     : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> creasePull : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> pressRest  : array<vec4<f32>>;
@group(0) @binding(5) var<uniform>             params     : Params;
@group(0) @binding(6) var<uniform>             rest       : RestMode;
fn sCreaseMeta(i : u32) -> vec4<f32> { return staticData[u32(params.off1.z) + i]; }
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.z)) { return; }
  // mode.x is the edit; mode.y which theta buffer is last, 0 for A and 1 for B.
  let lastIsB = rest.mode.y > 0.5;
  var t : vec4<f32>;
  if (lastIsB) { t = thetaB[i]; } else { t = thetaA[i]; }
  let mode = u32(rest.mode.x);
  var r : f32;
  if (mode == 0u) {
    let posed = params.pose.x > 0.5;
    if (posed) { r = t.y; } else { r = sCreaseMeta(i).z * params.sim.x; }
    pressRest[i] = vec4<f32>(r, 0.0, 0.0, 0.0);
    creasePull[i].x = t.x - r;
  } else if (mode == 1u) {
    r = t.x;
  } else {
    r = pressRest[i].x;
  }
  t.y = r;
  if (lastIsB) { thetaB[i] = t; } else { thetaA[i] = t; }
}`;

/**
 * Keeping a shape (a pull let go with `keep`, or a kept shape restored): its
 * edge lengths and face angles become the paper's rest state, as WebglSolver's
 * keepInPlaneShape does on the CPU from positions it reads back. Here the
 * positions are where the kernels are, so the rest state is in place before
 * the next step runs, as it is there.
 *
 * KEEP_LENGTHS: each edge's length now, within POSE_REST_LENGTH_TOLERANCE of
 * the sheet's (pull.ts keptRestLength), into `keptLengths`.
 */
export const KEEP_LENGTHS = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
// (a, b, sheet length, _) per edge.
@group(0) @binding(2) var<storage, read>       edges        : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> keptLengths  : array<f32>;
@group(0) @binding(4) var<uniform>             params       : Params;
${STATIC}
const TOLERANCE : f32 = ${POSE_REST_LENGTH_TOLERANCE};
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let e = gid.x;
  if (e >= arrayLength(&edges)) { return; }
  let edge = edges[e];
  let current = length(getPos(u32(edge.y)) - getPos(u32(edge.x)));
  let sheet = max(0.000001, edge.z);
  keptLengths[e] = min(sheet * (1.0 + TOLERANCE), max(sheet * (1.0 - TOLERANCE), current));
}`;

/** Each beam incidence's rest length (beamMeta.z) from its edge's kept length. */
export const APPLY_LENGTHS = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read_write> staticData     : array<vec4<f32>>;
// The edge each beam incidence belongs to, in .x.
@group(0) @binding(1) var<storage, read>       incidenceEdges : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       keptLengths    : array<f32>;
@group(0) @binding(3) var<uniform>             params         : Params;
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= arrayLength(&incidenceEdges)) { return; }
  let at = u32(params.off1.y) + i;
  var beam = staticData[at];
  beam.z = keptLengths[u32(incidenceEdges[i].x)];
  staticData[at] = beam;
}`;

/** Each face's rest angles (nominalTriangles.xyz) from its angles now: pull.ts triangleAngles. */
export const KEEP_ANGLES = /* wgsl */ `
${PARAMS}
@group(0) @binding(0) var<storage, read_write> staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<uniform>             params       : Params;
${STATIC}
fn unitOrZero(v : vec3<f32>) -> vec3<f32> {
  let len = length(v);
  if (len <= 1e-12) { return vec3<f32>(0.0); }
  return v / len;
}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let f = gid.x;
  if (f >= u32(params.counts.y)) { return; }
  let corners = sFaceVertexIndices(f);
  let a = getPos(u32(corners.x));
  let b = getPos(u32(corners.y));
  let c = getPos(u32(corners.z));
  let ab = unitOrZero(b - a);
  let ac = unitOrZero(c - a);
  let bc = unitOrZero(c - b);
  let at = u32(params.off3.x) + f;
  var nominal = staticData[at];
  nominal.x = acos(clamp(dot(ab, ac), -1.0, 1.0));
  nominal.y = acos(clamp(-dot(ab, bc), -1.0, 1.0));
  nominal.z = acos(clamp(dot(ac, bc), -1.0, 1.0));
  staticData[at] = nominal;
}`;
