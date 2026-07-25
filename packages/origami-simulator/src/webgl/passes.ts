// The solver's fragment-shader passes, ported from upstream's shader blocks in
// third_party/origami-simulator/index.html. They are kept as close to the
// originals as GLSL ES 1.00 allows, because their correctness is defined by
// parity against that source and the upstream oracle -- not by anything here.
//
// The only substantive change is `precision highp float` (upstream ships
// mediump). Positions accumulate over thousands of steps and mediump on some
// mobile GPUs has ~10 bits of mantissa, which would drift far past the measured
// Tier C threshold. highp is required, not a preference.
//
// Corresponding upstream blocks, for anyone diffing:
//   NORMAL_CALC      <- normalCalc
//   THETA_CALC       <- thetaCalcShader
//   CREASE_GEO_CALC  <- updateCreaseGeo
//   VELOCITY_CALC    <- velocityCalcShader
//   POSITION_CALC    <- positionCalcShader

/**
 * `normalize` that survives a zero-length vector, mirroring ReferenceSolver's
 * `normalize` helper (which returns [0, 1, 0] below EPSILON) so both backends
 * agree in the degenerate case.
 *
 * GLSL's built-in `normalize(vec3(0))` divides by zero and yields NaN, and a
 * single NaN propagates through the position texture until the whole mesh is
 * non-finite and vanishes. Upstream's shaders are unguarded here and simply
 * break on such geometry; the CPU reference -- our oracle, and what shipped
 * before the GPU port -- guards it, so a real crease pattern whose triangle
 * momentarily collapses (or whose crease endpoints coincide) mid-fold keeps
 * solving on the CPU but exploded on the GPU. Matching the reference is the
 * fix; the guard only ever changes behaviour where the unguarded result is
 * undefined.
 */
const SAFE_NORMALIZE = `
vec3 safeNormalize(vec3 v){
  float len = length(v);
  if (len <= 0.000001) return vec3(0.0, 1.0, 0.0);
  return v/len;
}
`;

export const NORMAL_CALC = `
precision highp float;
${SAFE_NORMALIZE}
uniform vec2 u_textureDim;
uniform vec2 u_textureDimFaces;
uniform sampler2D u_faceVertexIndices;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;

vec3 getPosition(float index1D){
  vec2 index = vec2(mod(index1D, u_textureDim.x)+0.5, floor(index1D/u_textureDim.x)+0.5);
  vec2 scaledIndex = index/u_textureDim;
  return texture2D(u_lastPosition, scaledIndex).xyz + texture2D(u_originalPosition, scaledIndex).xyz;
}

void main(){
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 scaledFragCoord = fragCoord/u_textureDimFaces;
  vec3 indices = texture2D(u_faceVertexIndices, scaledFragCoord).xyz;
  vec3 a = getPosition(indices[0]);
  vec3 b = getPosition(indices[1]);
  vec3 c = getPosition(indices[2]);
  vec3 normal = safeNormalize(cross(b-a, c-a));
  gl_FragColor = vec4(normal, 0.0);
}
`;

export const THETA_CALC = `
#define TWO_PI 6.283185307179586476925286766559
precision highp float;
${SAFE_NORMALIZE}
uniform vec2 u_textureDim;
uniform vec2 u_textureDimFaces;
uniform vec2 u_textureDimCreases;
uniform sampler2D u_normals;
uniform sampler2D u_lastTheta;
uniform sampler2D u_creaseVectors;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;

vec4 getFromArray(float index1D, vec2 dimensions, sampler2D tex){
  vec2 index = vec2(mod(index1D, dimensions.x)+0.5, floor(index1D/dimensions.x)+0.5);
  vec2 scaledIndex = index/dimensions;
  return texture2D(tex, scaledIndex);
}

void main(){
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 scaledFragCoord = fragCoord/u_textureDimCreases;
  vec4 lastTheta = texture2D(u_lastTheta, scaledFragCoord);
  if (lastTheta[2]<0.0){
    gl_FragColor = vec4(lastTheta[0], 0.0, -1.0, -1.0);
    return;
  }
  vec3 normal1 = getFromArray(lastTheta[2], u_textureDimFaces, u_normals).xyz;
  vec3 normal2 = getFromArray(lastTheta[3], u_textureDimFaces, u_normals).xyz;
  float dotNormals = dot(normal1, normal2);
  if (dotNormals < -1.0) dotNormals = -1.0;
  else if (dotNormals > 1.0) dotNormals = 1.0;
  vec2 creaseVectorIndices = texture2D(u_creaseVectors, scaledFragCoord).xy;
  vec2 creaseNodeIndex = vec2(mod(creaseVectorIndices[0], u_textureDim.x)+0.5, floor(creaseVectorIndices[0]/u_textureDim.x)+0.5);
  vec2 scaledNodeIndex = creaseNodeIndex/u_textureDim;
  vec3 node0 = texture2D(u_lastPosition, scaledNodeIndex).xyz + texture2D(u_originalPosition, scaledNodeIndex).xyz;
  creaseNodeIndex = vec2(mod(creaseVectorIndices[1], u_textureDim.x)+0.5, floor(creaseVectorIndices[1]/u_textureDim.x)+0.5);
  scaledNodeIndex = creaseNodeIndex/u_textureDim;
  vec3 node1 = texture2D(u_lastPosition, scaledNodeIndex).xyz + texture2D(u_originalPosition, scaledNodeIndex).xyz;
  vec3 creaseVector = safeNormalize(node1-node0);
  float x = dotNormals;
  float y = dot(cross(normal1, creaseVector), normal2);
  float theta = atan(y, x);
  float diff = theta-lastTheta[0];
  if (diff < -5.0) {
    diff += TWO_PI;
  } else if (diff > 5.0) {
    diff -= TWO_PI;
  }
  theta = lastTheta[0] + diff;
  gl_FragColor = vec4(theta, diff, lastTheta[2], lastTheta[3]);
}
`;

export const CREASE_GEO_CALC = `
precision highp float;
uniform vec2 u_textureDim;
uniform vec2 u_textureDimCreases;
uniform sampler2D u_lastPosition;
uniform sampler2D u_originalPosition;
uniform sampler2D u_creaseMeta2;

vec3 getPosition(float index1D){
  vec2 index = vec2(mod(index1D, u_textureDim.x)+0.5, floor(index1D/u_textureDim.x)+0.5);
  vec2 scaledIndex = index/u_textureDim;
  return texture2D(u_lastPosition, scaledIndex).xyz + texture2D(u_originalPosition, scaledIndex).xyz;
}

void main(){
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 scaledFragCoord = fragCoord/u_textureDimCreases;
  vec4 creaseMeta = texture2D(u_creaseMeta2, scaledFragCoord);
  vec3 node1 = getPosition(creaseMeta[0]);
  vec3 node2 = getPosition(creaseMeta[1]);
  vec3 node3 = getPosition(creaseMeta[2]);
  vec3 node4 = getPosition(creaseMeta[3]);
  float tol = 0.000001;
  vec3 creaseVector = node4-node3;
  float creaseLength = length(creaseVector);
  if (abs(creaseLength)<tol) {
    gl_FragColor = vec4(-1);
    return;
  }
  creaseVector /= creaseLength;
  vec3 vector1 = node1-node3;
  vec3 vector2 = node2-node3;
  float proj1Length = dot(creaseVector, vector1);
  float proj2Length = dot(creaseVector, vector2);
  float dist1 = sqrt(abs(vector1.x*vector1.x+vector1.y*vector1.y+vector1.z*vector1.z-proj1Length*proj1Length));
  float dist2 = sqrt(abs(vector2.x*vector2.x+vector2.y*vector2.y+vector2.z*vector2.z-proj2Length*proj2Length));
  if (dist1<tol || dist2<tol){
    gl_FragColor = vec4(-1);
    return;
  }
  gl_FragColor = vec4(dist1, dist2, proj1Length/creaseLength, proj2Length/creaseLength);
}
`;

export const VELOCITY_CALC = `
precision highp float;
uniform vec2 u_textureDim;
uniform vec2 u_textureDimEdges;
uniform vec2 u_textureDimFaces;
uniform vec2 u_textureDimCreases;
uniform vec2 u_textureDimNodeCreases;
uniform vec2 u_textureDimNodeFaces;
uniform float u_creasePercent;
uniform float u_dt;
uniform float u_axialStiffness;
uniform float u_faceStiffness;
uniform sampler2D u_lastPosition;
uniform sampler2D u_lastVelocity;
uniform sampler2D u_originalPosition;
uniform sampler2D u_externalForces;
uniform sampler2D u_mass;
uniform sampler2D u_meta;
uniform sampler2D u_beamMeta;
uniform sampler2D u_creaseMeta;
uniform sampler2D u_nodeCreaseMeta;
uniform sampler2D u_normals;
uniform sampler2D u_theta;
uniform sampler2D u_creaseGeo;
uniform sampler2D u_meta2;
uniform sampler2D u_nodeFaceMeta;
uniform sampler2D u_nominalTriangles;
uniform bool u_calcFaceStrain;

vec4 getFromArray(float index1D, vec2 dimensions, sampler2D tex){
  vec2 index = vec2(mod(index1D, dimensions.x)+0.5, floor(index1D/dimensions.x)+0.5);
  vec2 scaledIndex = index/dimensions;
  return texture2D(tex, scaledIndex);
}

vec3 getPosition(float index1D){
  vec2 index = vec2(mod(index1D, u_textureDim.x)+0.5, floor(index1D/u_textureDim.x)+0.5);
  vec2 scaledIndex = index/u_textureDim;
  return texture2D(u_lastPosition, scaledIndex).xyz + texture2D(u_originalPosition, scaledIndex).xyz;
}

void main(){
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 scaledFragCoord = fragCoord/u_textureDim;
  vec2 mass = texture2D(u_mass, scaledFragCoord).xy;
  if (mass[1] == 1.0){
    gl_FragColor = vec4(0.0);
    return;
  }
  vec3 force = texture2D(u_externalForces, scaledFragCoord).xyz;
  vec3 lastPosition = texture2D(u_lastPosition, scaledFragCoord).xyz;
  vec3 lastVelocity = texture2D(u_lastVelocity, scaledFragCoord).xyz;
  vec3 originalPosition = texture2D(u_originalPosition, scaledFragCoord).xyz;
  vec4 meta = texture2D(u_meta, scaledFragCoord);
  vec2 meta2 = texture2D(u_meta2, scaledFragCoord).xy;
  float nodeError = 0.0;

  for (int j=0;j<100;j++){
    if (j >= int(meta[1])) break;
    vec4 beamMeta = getFromArray(meta[0]+float(j), u_textureDimEdges, u_beamMeta);
    float neighborIndex1D = beamMeta[3];
    vec2 neighborIndex = vec2(mod(neighborIndex1D, u_textureDim.x)+0.5, floor(neighborIndex1D/u_textureDim.x)+0.5);
    vec2 scaledNeighborIndex = neighborIndex/u_textureDim;
    vec3 neighborLastPosition = texture2D(u_lastPosition, scaledNeighborIndex).xyz;
    vec3 neighborLastVelocity = texture2D(u_lastVelocity, scaledNeighborIndex).xyz;
    vec3 neighborOriginalPosition = texture2D(u_originalPosition, scaledNeighborIndex).xyz;
    vec3 nominalDist = neighborOriginalPosition-originalPosition;
    vec3 deltaP = neighborLastPosition-lastPosition+nominalDist;
    float deltaPLength = length(deltaP);
    // Skip a beam whose endpoints have momentarily collapsed onto each other:
    // dividing by a zero current length yields NaN, which then contaminates this
    // node's velocity, its position, and from there the whole mesh. Mirrors
    // ReferenceSolver's own "deltaPLength < EPSILON -> skip" guard -- the CPU
    // backend has always had this guard, which is why real crease patterns kept
    // solving there while the GPU exploded at the exact fold angle where two
    // nodes coincide. Upstream's shader is unguarded here too.
    if (deltaPLength < 0.000001) continue;
    deltaP -= deltaP*(beamMeta[2]/deltaPLength);
    if (!u_calcFaceStrain) nodeError += abs(deltaPLength/length(nominalDist) - 1.0);
    vec3 deltaV = neighborLastVelocity-lastVelocity;
    vec3 _force = deltaP*beamMeta[0] + deltaV*beamMeta[1];
    force += _force;
  }
  if (!u_calcFaceStrain) nodeError /= meta[1];

  for (int j=0;j<100;j++){
    if (j >= int(meta[3])) break;
    vec4 nodeCreaseMeta = getFromArray(meta[2]+float(j), u_textureDimNodeCreases, u_nodeCreaseMeta);
    float creaseIndex1D = nodeCreaseMeta[0];
    vec2 creaseIndex = vec2(mod(creaseIndex1D, u_textureDimCreases.x)+0.5, floor(creaseIndex1D/u_textureDimCreases.x)+0.5);
    vec2 scaledCreaseIndex = creaseIndex/u_textureDimCreases;
    vec4 thetas = texture2D(u_theta, scaledCreaseIndex);
    vec3 creaseMeta = texture2D(u_creaseMeta, scaledCreaseIndex).xyz;
    vec4 creaseGeo = texture2D(u_creaseGeo, scaledCreaseIndex);
    if (creaseGeo[0]< 0.0) continue;
    float targetTheta = creaseMeta[2] * u_creasePercent;
    float angForce = creaseMeta[0]*(targetTheta-thetas[0]);
    float nodeNum = nodeCreaseMeta[1];
    if (nodeNum > 2.0){
      vec3 normal1 = getFromArray(thetas[2], u_textureDimFaces, u_normals).xyz;
      vec3 normal2 = getFromArray(thetas[3], u_textureDimFaces, u_normals).xyz;
      float coef1 = creaseGeo[2];
      float coef2 = creaseGeo[3];
      if (nodeNum == 3.0){
        coef1 = 1.0-coef1;
        coef2 = 1.0-coef2;
      }
      vec3 _force = -angForce*(coef1/creaseGeo[0]*normal1 + coef2/creaseGeo[1]*normal2);
      force += _force;
    } else {
      float normalIndex1D = thetas[2];
      float momentArm = creaseGeo[0];
      if (nodeNum == 2.0) {
        normalIndex1D = thetas[3];
        momentArm = creaseGeo[1];
      }
      vec3 normal = getFromArray(normalIndex1D, u_textureDimFaces, u_normals).xyz;
      vec3 _force = angForce/momentArm*normal;
      force += _force;
    }
  }

  for (int j=0;j<100;j++){
    if (j >= int(meta2[1])) break;
    vec4 faceMeta = getFromArray(meta2[0]+float(j), u_textureDimNodeFaces, u_nodeFaceMeta);
    vec3 nominalAngles = getFromArray(faceMeta[0], u_textureDimFaces, u_nominalTriangles).xyz;
    int faceIndex = 0;
    if (faceMeta[2] < 0.0) faceIndex = 1;
    if (faceMeta[3] < 0.0) faceIndex = 2;
    vec3 a = faceIndex == 0 ? lastPosition+originalPosition : getPosition(faceMeta[1]);
    vec3 b = faceIndex == 1 ? lastPosition+originalPosition : getPosition(faceMeta[2]);
    vec3 c = faceIndex == 2 ? lastPosition+originalPosition : getPosition(faceMeta[3]);
    vec3 ab = b-a;
    vec3 ac = c-a;
    vec3 bc = c-b;
    float lengthAB = length(ab);
    float lengthAC = length(ac);
    float lengthBC = length(bc);
    float tol = 0.0000001;
    if (abs(lengthAB) < tol || abs(lengthBC) < tol || abs(lengthAC) < tol) continue;
    ab /= lengthAB;
    ac /= lengthAC;
    bc /= lengthBC;
    // acos is NaN outside [-1, 1], and the dot product of two float32-normalised
    // vectors routinely rounds just past 1 on a near-degenerate triangle. That
    // single NaN becomes this face's angular force, then the node's velocity and
    // position, and within a few steps the entire mesh is non-finite and the
    // model vanishes. ReferenceSolver clamps all three dots, which is why the CPU
    // backend kept solving where the GPU exploded; the theta pass clamps its own
    // dot as well. Upstream's shader omits the clamp here.
    vec3 angles = vec3(
      acos(clamp(dot(ab, ac), -1.0, 1.0)),
      acos(clamp(-1.0*dot(ab, bc), -1.0, 1.0)),
      acos(clamp(dot(ac, bc), -1.0, 1.0))
    );
    vec3 anglesDiff = nominalAngles-angles;
    vec3 normal = getFromArray(faceMeta[0], u_textureDimFaces, u_normals).xyz;
    anglesDiff *= u_faceStiffness;
    if (faceIndex == 0){
      vec3 normalCrossAC = cross(normal, ac)/lengthAC;
      vec3 normalCrossAB = cross(normal, ab)/lengthAB;
      force -= anglesDiff[0]*(normalCrossAC - normalCrossAB);
      if (u_calcFaceStrain) nodeError += abs((nominalAngles[0]-angles[0])/nominalAngles[0]);
      force -= anglesDiff[1]*normalCrossAB;
      force += anglesDiff[2]*normalCrossAC;
    } else if (faceIndex == 1){
      vec3 normalCrossAB = cross(normal, ab)/lengthAB;
      vec3 normalCrossBC = cross(normal, bc)/lengthBC;
      force -= anglesDiff[0]*normalCrossAB;
      force += anglesDiff[1]*(normalCrossAB + normalCrossBC);
      if (u_calcFaceStrain) nodeError += abs((nominalAngles[1]-angles[1])/nominalAngles[1]);
      force -= anglesDiff[2]*normalCrossBC;
    } else if (faceIndex == 2){
      vec3 normalCrossAC = cross(normal, ac)/lengthAC;
      vec3 normalCrossBC = cross(normal, bc)/lengthBC;
      force += anglesDiff[0]*normalCrossAC;
      force -= anglesDiff[1]*normalCrossBC;
      force += anglesDiff[2]*(normalCrossBC - normalCrossAC);
      if (u_calcFaceStrain) nodeError += abs((nominalAngles[2]-angles[2])/nominalAngles[2]);
    }
  }
  if (u_calcFaceStrain) nodeError /= meta2[1];

  vec3 velocity = force*u_dt/mass[0] + lastVelocity;
  gl_FragColor = vec4(velocity, nodeError);
}
`;

export const POSITION_CALC = `
precision highp float;
uniform vec2 u_textureDim;
uniform float u_dt;
uniform sampler2D u_lastPosition;
uniform sampler2D u_velocity;
uniform sampler2D u_mass;

void main(){
  vec2 fragCoord = gl_FragCoord.xy;
  vec2 scaledFragCoord = fragCoord/u_textureDim;
  vec3 lastPosition = texture2D(u_lastPosition, scaledFragCoord).xyz;
  float isFixed = texture2D(u_mass, scaledFragCoord).y;
  if (isFixed == 1.0){
    gl_FragColor = vec4(lastPosition, 0.0);
    return;
  }
  vec4 velocityData = texture2D(u_velocity, scaledFragCoord);
  vec3 position = velocityData.xyz*u_dt + lastPosition;
  gl_FragColor = vec4(position, velocityData.a);
}
`;
