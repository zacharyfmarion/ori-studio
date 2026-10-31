// The Euler kernels of the WebGPU port of Origami Simulator at
// github.com/jamescarruthers/OrigamiSimulatorWebGPU, js/dynamic/WebGPUSolver.js
// lines 31-291 at commit 05466ff, copied verbatim apart from `export`. MIT, as
// upstream. Used only by fullStep.ts, to time a complete WebGPU solver step
// against WebglSolver on the same models (see
// implementation-plans/simulator-webgpu-backend.md). Do not edit them here:
// the point is to measure that port as it is.
/* eslint-disable */

export const WORKGROUP_SIZE = 64;

// Params uniform shared by every kernel. All f32 so the std140-ish layout is a
// flat run of vec4s. Offsets are element (vec4) indices into `staticData`.
export const PARAMS_WGSL = /* wgsl */ `
struct Params {
  counts : vec4<f32>,   // (numNodes, numFaces, numCreases, numEdges)
  sim    : vec4<f32>,   // (creasePercent, dt, axialStiffness, faceStiffness)
  flags  : vec4<f32>,   // (calcFaceStrain, _, _, _)
  off0   : vec4<f32>,   // (originalPosition, externalForces, mass, meta)
  off1   : vec4<f32>,   // (meta2, beamMeta, creaseMeta, creaseMeta2)
  off2   : vec4<f32>,   // (creaseVectors, nodeCreaseMeta, nodeFaceMeta, faceVertexIndices)
  off3   : vec4<f32>,   // (nominalTriangles, _, _, _)
};
`;

// Static-data accessor + getPos helper (lastPosition is bound separately).
export const STATIC_WGSL = /* wgsl */ `
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
`;

export const NORMAL_CALC_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> normals      : array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             params       : Params;
${STATIC_WGSL}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.y)) { return; }   // numFaces
  let idx = sFaceVertexIndices(i);
  let a = getPos(u32(idx.x));
  let b = getPos(u32(idx.y));
  let c = getPos(u32(idx.z));
  normals[i] = vec4<f32>(normalize(cross(b - a, c - a)), 0.0);
}`;

export const THETA_CALC_WGSL = /* wgsl */ `
${PARAMS_WGSL}
const TWO_PI : f32 = 6.283185307179586;
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       normals      : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       lastTheta    : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read_write> theta        : array<vec4<f32>>;
@group(0) @binding(5) var<uniform>             params       : Params;
${STATIC_WGSL}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.z)) { return; }   // numCreases
  let lt = lastTheta[i];
  if (lt.z < 0.0) { theta[i] = vec4<f32>(lt.x, 0.0, -1.0, -1.0); return; }
  let normal1 = normals[u32(lt.z)].xyz;
  let normal2 = normals[u32(lt.w)].xyz;
  let dotNormals = clamp(dot(normal1, normal2), -1.0, 1.0);
  let cv = sCreaseVectors(i);
  let node0 = getPos(u32(cv.x));
  let node1 = getPos(u32(cv.y));
  let creaseVector = normalize(node1 - node0);
  let x = dotNormals;
  let y = dot(cross(normal1, creaseVector), normal2);
  let th0 = atan2(y, x);
  var diff = th0 - lt.x;
  if (diff < -5.0) { diff = diff + TWO_PI; } else if (diff > 5.0) { diff = diff - TWO_PI; }
  let th = lt.x + diff;
  theta[i] = vec4<f32>(th, diff, lt.z, lt.w);
}`;

export const UPDATE_CREASE_GEO_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> creaseGeo    : array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             params       : Params;
${STATIC_WGSL}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.z)) { return; }   // numCreases
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

export const VELOCITY_CALC_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastVelocity : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read>       normals      : array<vec4<f32>>;
@group(0) @binding(4) var<storage, read>       theta        : array<vec4<f32>>;
@group(0) @binding(5) var<storage, read>       creaseGeo    : array<vec4<f32>>;
@group(0) @binding(6) var<storage, read_write> velocity     : array<vec4<f32>>;
@group(0) @binding(7) var<uniform>             params       : Params;
${STATIC_WGSL}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }   // numNodes
  let creasePercent = params.sim.x;
  let dt = params.sim.y;
  let faceStiffness = params.sim.w;
  let calcFaceStrain = params.flags.x > 0.5;

  let massI = sMass(i).xy;
  if (massI.y == 1.0) { velocity[i] = vec4<f32>(0.0); return; }   // fixed

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
    let thetas = theta[cIdx];                    // (theta, w, n1Index, n2Index)
    let cMeta = sCreaseMeta(cIdx).xyz;           // (k, d, targetTheta)
    let cGeo = creaseGeo[cIdx];                  // (h1, h2, coef1, coef2)
    if (cGeo.x < 0.0) { continue; }
    let targetTheta = cMeta.z * creasePercent;
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
    let angles = vec3<f32>(acos(dot(ab, ac)), acos(-1.0 * dot(ab, bc)), acos(dot(ac, bc)));
    var anglesDiff = (nominalAngles - angles) * faceStiffness;
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

  velocity[i] = vec4<f32>(force * dt / massI.x + lastVelocityI, nodeError);
}`;

export const POSITION_CALC_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(0) var<storage, read>       staticData   : array<vec4<f32>>;
@group(0) @binding(1) var<storage, read>       velocity     : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read>       lastPosition : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> position     : array<vec4<f32>>;
@group(0) @binding(4) var<uniform>             params       : Params;
${STATIC_WGSL}
@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
  let i = gid.x;
  if (i >= u32(params.counts.x)) { return; }   // numNodes
  let lastPositionI = lastPosition[i].xyz;
  if (sMass(i).y == 1.0) { position[i] = vec4<f32>(lastPositionI, 0.0); return; }
  let v = velocity[i];
  position[i] = vec4<f32>(v.xyz * params.sim.y + lastPositionI, v.w);  // dt = sim.y, carry error
}`;
