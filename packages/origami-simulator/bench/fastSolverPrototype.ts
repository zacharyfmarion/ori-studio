// UNSHIPPED MEASUREMENT ARTIFACT -- do not import from src/.
//
// Zero-allocation, CSR-flattened port of ReferenceSolver's Euler path. It is
// kept only to answer one question with a number: how much is available from
// optimising the CPU solver, as an upper bound and as a hedge if the GPU port
// stalls. Measured at 6.5-8.1x faster than ReferenceSolver with output
// identical to one float32 ULP (5.96e-8 = 2^-24).
//
// It is deliberately NOT productionised: it omits fold profiles and the Verlet
// path, and the GPU backend obsoletes it. See
// implementation-plans/origami-simulator-performance.md, "Why no fast-JS
// phase". If you are tempted to ship this, read that section first.
import type { OrigamiModel } from '../src/model.js';
import type { SimulatorOptions } from '../src/types.js';

const EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;

export class FastSolver {
  private readonly model: OrigamiModel;
  private readonly opts: Required<
    Pick<
      SimulatorOptions,
      'axialStiffness' | 'creaseStiffness' | 'panelStiffness' | 'faceStiffness' | 'damping' | 'foldPercent'
    >
  >;

  private readonly vertexCount: number;
  private readonly faceCount: number;
  private readonly creaseCount: number;

  // state
  private readonly rel: Float32Array; // current relative positions
  private readonly lastRel: Float32Array;
  private readonly vel: Float32Array;
  private readonly lastVel: Float32Array;
  private readonly theta: Float32Array;
  private readonly normals: Float32Array;
  private readonly creaseGeo: Float32Array; // 4 per crease: h1,h2,coef1,coef2 (h1<0 => disabled)

  // topology, CSR
  private readonly beamOffsets: Int32Array;
  private readonly beamOther: Int32Array;
  private readonly beamRest: Float32Array;
  private readonly creaseOffsets: Int32Array;
  private readonly creaseIdx: Int32Array;
  private readonly creaseNodeNum: Uint8Array;
  private readonly faceOffsets: Int32Array;
  private readonly faceIdx: Int32Array;
  private readonly faceVertOffset: Uint8Array;

  // per-face / per-crease flat params
  private readonly facesFlat: Int32Array; // 3 per face
  private readonly nominalAngles: Float32Array; // 3 per face
  private readonly creaseFace1: Int32Array;
  private readonly creaseFace2: Int32Array;
  private readonly creaseV1: Int32Array;
  private readonly creaseV2: Int32Array;
  private readonly creaseE0: Int32Array;
  private readonly creaseE1: Int32Array;
  private readonly creaseTarget: Float32Array; // degrees at 100%
  private readonly creaseStiffScale: Float32Array; // restLength, sign of which stiffness in creaseIsFlat
  private readonly creaseIsFlat: Uint8Array;

  private cachedDt = 0;

  constructor(model: OrigamiModel, options: SimulatorOptions = {}) {
    this.model = model;
    this.opts = {
      axialStiffness: options.axialStiffness ?? 20,
      creaseStiffness: options.creaseStiffness ?? 0.7,
      panelStiffness: options.panelStiffness ?? 0.7,
      faceStiffness: options.faceStiffness ?? 0.2,
      damping: options.damping ?? 0.45,
      foldPercent: options.foldPercent ?? 0,
    };
    const p = model.prepared;
    this.vertexCount = p.vertexCount;
    this.faceCount = p.faceCount;
    this.creaseCount = p.creaseParams.length;

    const n3 = model.positions.length;
    this.rel = new Float32Array(n3);
    this.lastRel = new Float32Array(n3);
    this.vel = new Float32Array(n3);
    this.lastVel = new Float32Array(n3);
    this.theta = new Float32Array(this.creaseCount);
    this.normals = new Float32Array(this.faceCount * 3);
    this.creaseGeo = new Float32Array(this.creaseCount * 4);

    // --- beams CSR ---
    const beamCounts = new Int32Array(this.vertexCount);
    for (const e of p.edgesVertices) {
      beamCounts[e[0]] += 1;
      beamCounts[e[1]] += 1;
    }
    this.beamOffsets = prefixSum(beamCounts);
    const beamTotal = this.beamOffsets[this.vertexCount]!;
    this.beamOther = new Int32Array(beamTotal);
    this.beamRest = new Float32Array(beamTotal);
    const beamCursor = this.beamOffsets.slice(0, this.vertexCount);
    p.edgesVertices.forEach((e, edgeIndex) => {
      const rest = Math.max(EPSILON, model.edgeRestLength(edgeIndex));
      let c = beamCursor[e[0]]!;
      this.beamOther[c] = e[1];
      this.beamRest[c] = rest;
      beamCursor[e[0]] = c + 1;
      c = beamCursor[e[1]]!;
      this.beamOther[c] = e[0];
      this.beamRest[c] = rest;
      beamCursor[e[1]] = c + 1;
    });

    // --- creases ---
    this.creaseFace1 = new Int32Array(this.creaseCount);
    this.creaseFace2 = new Int32Array(this.creaseCount);
    this.creaseV1 = new Int32Array(this.creaseCount);
    this.creaseV2 = new Int32Array(this.creaseCount);
    this.creaseE0 = new Int32Array(this.creaseCount);
    this.creaseE1 = new Int32Array(this.creaseCount);
    this.creaseTarget = new Float32Array(this.creaseCount);
    this.creaseStiffScale = new Float32Array(this.creaseCount);
    this.creaseIsFlat = new Uint8Array(this.creaseCount);
    const creaseCounts = new Int32Array(this.vertexCount);
    p.creaseParams.forEach((crease, i) => {
      const edge = p.edgesVertices[crease.edge]!;
      this.creaseFace1[i] = crease.face1;
      this.creaseFace2[i] = crease.face2;
      this.creaseV1[i] = crease.vertex1;
      this.creaseV2[i] = crease.vertex2;
      this.creaseE0[i] = edge[0];
      this.creaseE1[i] = edge[1];
      this.creaseTarget[i] = crease.targetAngle;
      this.creaseStiffScale[i] = model.edgeRestLength(crease.edge);
      this.creaseIsFlat[i] = crease.targetAngle === 0 ? 1 : 0;
      creaseCounts[crease.vertex1] += 1;
      creaseCounts[crease.vertex2] += 1;
      creaseCounts[edge[0]] += 1;
      creaseCounts[edge[1]] += 1;
    });
    this.creaseOffsets = prefixSum(creaseCounts);
    const creaseTotal = this.creaseOffsets[this.vertexCount]!;
    this.creaseIdx = new Int32Array(creaseTotal);
    this.creaseNodeNum = new Uint8Array(creaseTotal);
    const creaseCursor = this.creaseOffsets.slice(0, this.vertexCount);
    const pushCrease = (vertex: number, creaseIndex: number, nodeNumber: number) => {
      const c = creaseCursor[vertex]!;
      this.creaseIdx[c] = creaseIndex;
      this.creaseNodeNum[c] = nodeNumber;
      creaseCursor[vertex] = c + 1;
    };
    p.creaseParams.forEach((crease, i) => {
      const edge = p.edgesVertices[crease.edge]!;
      pushCrease(crease.vertex1, i, 1);
      pushCrease(crease.vertex2, i, 2);
      pushCrease(edge[0], i, 3);
      pushCrease(edge[1], i, 4);
    });

    // --- faces ---
    this.facesFlat = new Int32Array(this.faceCount * 3);
    this.nominalAngles = new Float32Array(this.faceCount * 3);
    const faceCounts = new Int32Array(this.vertexCount);
    p.facesVertices.forEach((face, fi) => {
      if (face.length !== 3) return;
      this.facesFlat[fi * 3] = face[0]!;
      this.facesFlat[fi * 3 + 1] = face[1]!;
      this.facesFlat[fi * 3 + 2] = face[2]!;
      faceCounts[face[0]!] += 1;
      faceCounts[face[1]!] += 1;
      faceCounts[face[2]!] += 1;
    });
    this.faceOffsets = prefixSum(faceCounts);
    const faceTotal = this.faceOffsets[this.vertexCount]!;
    this.faceIdx = new Int32Array(faceTotal);
    this.faceVertOffset = new Uint8Array(faceTotal);
    const faceCursor = this.faceOffsets.slice(0, this.vertexCount);
    p.facesVertices.forEach((face, fi) => {
      if (face.length !== 3) return;
      for (let k = 0; k < 3; k += 1) {
        const v = face[k]!;
        const c = faceCursor[v]!;
        this.faceIdx[c] = fi;
        this.faceVertOffset[c] = k;
        faceCursor[v] = c + 1;
      }
    });
    // nominal angles from original positions
    const op = model.originalPositions;
    for (let fi = 0; fi < this.faceCount; fi += 1) {
      const ia = this.facesFlat[fi * 3]! * 3;
      const ib = this.facesFlat[fi * 3 + 1]! * 3;
      const ic = this.facesFlat[fi * 3 + 2]! * 3;
      let abx = op[ib]! - op[ia]!;
      let aby = op[ib + 1]! - op[ia + 1]!;
      let abz = op[ib + 2]! - op[ia + 2]!;
      let acx = op[ic]! - op[ia]!;
      let acy = op[ic + 1]! - op[ia + 1]!;
      let acz = op[ic + 2]! - op[ia + 2]!;
      let bcx = op[ic]! - op[ib]!;
      let bcy = op[ic + 1]! - op[ib + 1]!;
      let bcz = op[ic + 2]! - op[ib + 2]!;
      let l = Math.sqrt(abx * abx + aby * aby + abz * abz) || 1;
      abx /= l; aby /= l; abz /= l;
      l = Math.sqrt(acx * acx + acy * acy + acz * acz) || 1;
      acx /= l; acy /= l; acz /= l;
      l = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz) || 1;
      bcx /= l; bcy /= l; bcz /= l;
      this.nominalAngles[fi * 3] = Math.acos(clamp(abx * acx + aby * acy + abz * acz, -1, 1));
      this.nominalAngles[fi * 3 + 1] = Math.acos(clamp(-(abx * bcx + aby * bcy + abz * bcz), -1, 1));
      this.nominalAngles[fi * 3 + 2] = Math.acos(clamp(acx * bcx + acy * bcy + acz * bcz, -1, 1));
    }

    this.cachedDt = this.computeTimeStep();
    this.syncPositions();
  }

  setFoldPercent(p: number): void {
    this.opts.foldPercent = p;
  }

  step(numSteps: number): void {
    for (let i = 0; i < numSteps; i += 1) this.solveStep();
    this.syncPositions();
  }

  private computeTimeStep(): number {
    let maxFreq = 0;
    const axial = Math.max(0, this.opts.axialStiffness);
    for (let i = 0; i < this.beamRest.length; i += 1) {
      const f = Math.sqrt(axial / this.beamRest[i]!);
      if (f > maxFreq) maxFreq = f;
    }
    if (maxFreq <= EPSILON) return 1 / 60;
    return 0.9 / (TWO_PI * maxFreq);
  }

  private solveStep(): void {
    const dt = this.cachedDt;
    this.normalCalc();
    this.thetaCalc();
    this.updateCreaseGeo();
    this.velocityAndPositionCalc(dt);
  }

  private normalCalc(): void {
    const op = this.model.originalPositions;
    const rel = this.lastRel;
    const faces = this.facesFlat;
    const normals = this.normals;
    for (let fi = 0; fi < this.faceCount; fi += 1) {
      const ia = faces[fi * 3]! * 3;
      const ib = faces[fi * 3 + 1]! * 3;
      const ic = faces[fi * 3 + 2]! * 3;
      const ax = op[ia]! + rel[ia]!;
      const ay = op[ia + 1]! + rel[ia + 1]!;
      const az = op[ia + 2]! + rel[ia + 2]!;
      const bx = op[ib]! + rel[ib]! - ax;
      const by = op[ib + 1]! + rel[ib + 1]! - ay;
      const bz = op[ib + 2]! + rel[ib + 2]! - az;
      const cx = op[ic]! + rel[ic]! - ax;
      const cy = op[ic + 1]! + rel[ic + 1]! - ay;
      const cz = op[ic + 2]! + rel[ic + 2]! - az;
      let nx = by * cz - bz * cy;
      let ny = bz * cx - bx * cz;
      let nz = bx * cy - by * cx;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len <= EPSILON) {
        nx = 0; ny = 1; nz = 0;
      } else {
        nx /= len; ny /= len; nz /= len;
      }
      normals[fi * 3] = nx;
      normals[fi * 3 + 1] = ny;
      normals[fi * 3 + 2] = nz;
    }
  }

  private thetaCalc(): void {
    const op = this.model.originalPositions;
    const rel = this.lastRel;
    const normals = this.normals;
    for (let ci = 0; ci < this.creaseCount; ci += 1) {
      const f1 = this.creaseFace1[ci]! * 3;
      const f2 = this.creaseFace2[ci]! * 3;
      const n1x = normals[f1]!, n1y = normals[f1 + 1]!, n1z = normals[f1 + 2]!;
      const n2x = normals[f2]!, n2y = normals[f2 + 1]!, n2z = normals[f2 + 2]!;
      const i0 = this.creaseE0[ci]! * 3;
      const i1 = this.creaseE1[ci]! * 3;
      let vx = op[i1]! + rel[i1]! - op[i0]! - rel[i0]!;
      let vy = op[i1 + 1]! + rel[i1 + 1]! - op[i0 + 1]! - rel[i0 + 1]!;
      let vz = op[i1 + 2]! + rel[i1 + 2]! - op[i0 + 2]! - rel[i0 + 2]!;
      const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (len <= EPSILON) { vx = 0; vy = 1; vz = 0; } else { vx /= len; vy /= len; vz /= len; }
      const cx = n1y * vz - n1z * vy;
      const cy = n1z * vx - n1x * vz;
      const cz = n1x * vy - n1y * vx;
      const theta = Math.atan2(
        cx * n2x + cy * n2y + cz * n2z,
        clamp(n1x * n2x + n1y * n2y + n1z * n2z, -1, 1)
      );
      let diff = theta - this.theta[ci]!;
      if (diff < -5) diff += TWO_PI;
      else if (diff > 5) diff -= TWO_PI;
      this.theta[ci] = this.theta[ci]! + diff;
    }
  }

  private updateCreaseGeo(): void {
    const op = this.model.originalPositions;
    const rel = this.lastRel;
    const geo = this.creaseGeo;
    for (let ci = 0; ci < this.creaseCount; ci += 1) {
      const i1 = this.creaseV1[ci]! * 3;
      const i2 = this.creaseV2[ci]! * 3;
      const i3 = this.creaseE0[ci]! * 3;
      const i4 = this.creaseE1[ci]! * 3;
      const n3x = op[i3]! + rel[i3]!, n3y = op[i3 + 1]! + rel[i3 + 1]!, n3z = op[i3 + 2]! + rel[i3 + 2]!;
      const cvx = op[i4]! + rel[i4]! - n3x;
      const cvy = op[i4 + 1]! + rel[i4 + 1]! - n3y;
      const cvz = op[i4 + 2]! + rel[i4 + 2]! - n3z;
      const clen = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
      const o = ci * 4;
      if (clen < EPSILON) { geo[o] = -1; continue; }
      const ux = cvx / clen, uy = cvy / clen, uz = cvz / clen;
      const v1x = op[i1]! + rel[i1]! - n3x;
      const v1y = op[i1 + 1]! + rel[i1 + 1]! - n3y;
      const v1z = op[i1 + 2]! + rel[i1 + 2]! - n3z;
      const v2x = op[i2]! + rel[i2]! - n3x;
      const v2y = op[i2 + 1]! + rel[i2 + 1]! - n3y;
      const v2z = op[i2 + 2]! + rel[i2 + 2]! - n3z;
      const p1 = ux * v1x + uy * v1y + uz * v1z;
      const p2 = ux * v2x + uy * v2y + uz * v2z;
      const h1 = Math.sqrt(Math.abs(v1x * v1x + v1y * v1y + v1z * v1z - p1 * p1));
      const h2 = Math.sqrt(Math.abs(v2x * v2x + v2y * v2y + v2z * v2z - p2 * p2));
      if (h1 < EPSILON || h2 < EPSILON) { geo[o] = -1; continue; }
      geo[o] = h1;
      geo[o + 1] = h2;
      geo[o + 2] = p1 / clen;
      geo[o + 3] = p2 / clen;
    }
  }

  private velocityAndPositionCalc(dt: number): void {
    const op = this.model.originalPositions;
    const rel = this.lastRel;
    const lastVel = this.lastVel;
    const vel = this.vel;
    const normals = this.normals;
    const geo = this.creaseGeo;
    const axial = Math.max(0, this.opts.axialStiffness);
    const damping = Math.max(0, this.opts.damping);
    const faceStiff = Math.max(0, this.opts.faceStiffness);
    const foldScale = this.opts.foldPercent / 100;
    const DEG = Math.PI / 180;

    for (let v = 0; v < this.vertexCount; v += 1) {
      const vo = v * 3;
      let fx = 0, fy = 0, fz = 0;

      // ---- beam force ----
      const lpx = rel[vo]!, lpy = rel[vo + 1]!, lpz = rel[vo + 2]!;
      const lvx = lastVel[vo]!, lvy = lastVel[vo + 1]!, lvz = lastVel[vo + 2]!;
      const opx = op[vo]!, opy = op[vo + 1]!, opz = op[vo + 2]!;
      const bEnd = this.beamOffsets[v + 1]!;
      for (let bi = this.beamOffsets[v]!; bi < bEnd; bi += 1) {
        const other = this.beamOther[bi]! * 3;
        const rest = this.beamRest[bi]!;
        let dpx = rel[other]! - lpx + op[other]! - opx;
        let dpy = rel[other + 1]! - lpy + op[other + 1]! - opy;
        let dpz = rel[other + 2]! - lpz + op[other + 2]! - opz;
        const dpLen = Math.sqrt(dpx * dpx + dpy * dpy + dpz * dpz);
        if (dpLen < EPSILON) continue;
        const stiffness = axial / rest;
        const beamDamping = damping * 2 * Math.sqrt(stiffness);
        const k = rest / dpLen;
        dpx -= dpx * k; dpy -= dpy * k; dpz -= dpz * k;
        fx += dpx * stiffness + (lastVel[other]! - lvx) * beamDamping;
        fy += dpy * stiffness + (lastVel[other + 1]! - lvy) * beamDamping;
        fz += dpz * stiffness + (lastVel[other + 2]! - lvz) * beamDamping;
      }

      // ---- crease force ----
      const cEnd = this.creaseOffsets[v + 1]!;
      for (let k = this.creaseOffsets[v]!; k < cEnd; k += 1) {
        const ci = this.creaseIdx[k]!;
        const o = ci * 4;
        const h1 = geo[o]!;
        if (h1 < 0) continue;
        const h2 = geo[o + 1]!;
        const nodeNumber = this.creaseNodeNum[k]!;
        const targetTheta = this.creaseTarget[ci]! * foldScale * DEG;
        const stiffness =
          (this.creaseIsFlat[ci] ? this.opts.panelStiffness : this.opts.creaseStiffness) *
          this.creaseStiffScale[ci]!;
        const angularForce = stiffness * (targetTheta - this.theta[ci]!);
        const f1 = this.creaseFace1[ci]! * 3;
        const f2 = this.creaseFace2[ci]! * 3;
        if (nodeNumber > 2) {
          let c1 = geo[o + 2]!;
          let c2 = geo[o + 3]!;
          if (nodeNumber === 3) { c1 = 1 - c1; c2 = 1 - c2; }
          const a = c1 / h1;
          const b = c2 / h2;
          fx += -(normals[f1]! * a + normals[f2]! * b) * angularForce;
          fy += -(normals[f1 + 1]! * a + normals[f2 + 1]! * b) * angularForce;
          fz += -(normals[f1 + 2]! * a + normals[f2 + 2]! * b) * angularForce;
        } else {
          const ni = nodeNumber === 1 ? f1 : f2;
          const arm = nodeNumber === 1 ? h1 : h2;
          const s = angularForce / arm;
          fx += normals[ni]! * s;
          fy += normals[ni + 1]! * s;
          fz += normals[ni + 2]! * s;
        }
      }

      // ---- face force ----
      if (faceStiff > 0) {
        const px = opx + lpx, py = opy + lpy, pz = opz + lpz;
        const fEnd = this.faceOffsets[v + 1]!;
        for (let k = this.faceOffsets[v]!; k < fEnd; k += 1) {
          const fi = this.faceIdx[k]!;
          const off = this.faceVertOffset[k]!;
          const i0 = this.facesFlat[fi * 3]! * 3;
          const i1 = this.facesFlat[fi * 3 + 1]! * 3;
          const i2 = this.facesFlat[fi * 3 + 2]! * 3;
          const ax = off === 0 ? px : op[i0]! + rel[i0]!;
          const ay = off === 0 ? py : op[i0 + 1]! + rel[i0 + 1]!;
          const az = off === 0 ? pz : op[i0 + 2]! + rel[i0 + 2]!;
          const bx = off === 1 ? px : op[i1]! + rel[i1]!;
          const by = off === 1 ? py : op[i1 + 1]! + rel[i1 + 1]!;
          const bz = off === 1 ? pz : op[i1 + 2]! + rel[i1 + 2]!;
          const cx0 = off === 2 ? px : op[i2]! + rel[i2]!;
          const cy0 = off === 2 ? py : op[i2 + 1]! + rel[i2 + 1]!;
          const cz0 = off === 2 ? pz : op[i2 + 2]! + rel[i2 + 2]!;
          let abx = bx - ax, aby = by - ay, abz = bz - az;
          let acx = cx0 - ax, acy = cy0 - ay, acz = cz0 - az;
          let bcx = cx0 - bx, bcy = cy0 - by, bcz = cz0 - bz;
          const lab = Math.sqrt(abx * abx + aby * aby + abz * abz);
          const lac = Math.sqrt(acx * acx + acy * acy + acz * acz);
          const lbc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
          if (lab < EPSILON || lac < EPSILON || lbc < EPSILON) continue;
          abx /= lab; aby /= lab; abz /= lab;
          acx /= lac; acy /= lac; acz /= lac;
          bcx /= lbc; bcy /= lbc; bcz /= lbc;
          const a0 = Math.acos(clamp(abx * acx + aby * acy + abz * acz, -1, 1));
          const a1 = Math.acos(clamp(-(abx * bcx + aby * bcy + abz * bcz), -1, 1));
          const a2 = Math.acos(clamp(acx * bcx + acy * bcy + acz * bcz, -1, 1));
          const d0 = (this.nominalAngles[fi * 3]! - a0) * faceStiff;
          const d1 = (this.nominalAngles[fi * 3 + 1]! - a1) * faceStiff;
          const d2 = (this.nominalAngles[fi * 3 + 2]! - a2) * faceStiff;
          const nx = normals[fi * 3]!, ny = normals[fi * 3 + 1]!, nz = normals[fi * 3 + 2]!;
          if (off === 0) {
            const acX = (ny * acz - nz * acy) / lac;
            const acY = (nz * acx - nx * acz) / lac;
            const acZ = (nx * acy - ny * acx) / lac;
            const abX = (ny * abz - nz * aby) / lab;
            const abY = (nz * abx - nx * abz) / lab;
            const abZ = (nx * aby - ny * abx) / lab;
            fx += -(acX - abX) * d0 + -abX * d1 + acX * d2;
            fy += -(acY - abY) * d0 + -abY * d1 + acY * d2;
            fz += -(acZ - abZ) * d0 + -abZ * d1 + acZ * d2;
          } else if (off === 1) {
            const abX = (ny * abz - nz * aby) / lab;
            const abY = (nz * abx - nx * abz) / lab;
            const abZ = (nx * aby - ny * abx) / lab;
            const bcX = (ny * bcz - nz * bcy) / lbc;
            const bcY = (nz * bcx - nx * bcz) / lbc;
            const bcZ = (nx * bcy - ny * bcx) / lbc;
            fx += -abX * d0 + (abX + bcX) * d1 + -bcX * d2;
            fy += -abY * d0 + (abY + bcY) * d1 + -bcY * d2;
            fz += -abZ * d0 + (abZ + bcZ) * d1 + -bcZ * d2;
          } else {
            const acX = (ny * acz - nz * acy) / lac;
            const acY = (nz * acx - nx * acz) / lac;
            const acZ = (nx * acy - ny * acx) / lac;
            const bcX = (ny * bcz - nz * bcy) / lbc;
            const bcY = (nz * bcx - nx * bcz) / lbc;
            const bcZ = (nx * bcy - ny * bcx) / lbc;
            fx += acX * d0 + -bcX * d1 + (bcX - acX) * d2;
            fy += acY * d0 + -bcY * d1 + (bcY - acY) * d2;
            fz += acZ * d0 + -bcZ * d1 + (bcZ - acZ) * d2;
          }
        }
      }

      vel[vo] = lvx + fx * dt;
      vel[vo + 1] = lvy + fy * dt;
      vel[vo + 2] = lvz + fz * dt;
    }

    // position integrate + swap
    for (let i = 0; i < this.rel.length; i += 1) {
      let next = vel[i]! * dt + rel[i]!;
      if (!Number.isFinite(next)) next = 0;
      this.rel[i] = next;
    }
    this.lastRel.set(this.rel);
    this.lastVel.set(vel);
  }

  private syncPositions(): void {
    const pos = this.model.positions;
    const op = this.model.originalPositions;
    for (let i = 0; i < pos.length; i += 1) {
      const value = op[i]! + this.lastRel[i]!;
      pos[i] = Number.isFinite(value) ? value : op[i]!;
    }
  }
}

function prefixSum(counts: Int32Array): Int32Array {
  const offsets = new Int32Array(counts.length + 1);
  let total = 0;
  for (let i = 0; i < counts.length; i += 1) {
    offsets[i] = total;
    total += counts[i]!;
  }
  offsets[counts.length] = total;
  return offsets;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
