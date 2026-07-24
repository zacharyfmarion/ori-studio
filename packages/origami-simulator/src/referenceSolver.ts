import { OrigamiModel } from './model.js';
import type {
  CreaseFoldRange,
  CreaseParameter,
  SimulationFrame,
  SimulatorDiagnostics,
  SimulatorOptions,
} from './types.js';
import type { SolverBackend } from './solverBackend.js';

// TypeScript CPU port of Amanda Ghassaei's Origami Simulator dynamic solver.
//
// THIS IS THE ORACLE. It is the behavioural definition of the simulator, and it
// is deliberately NOT optimised: it stays straightforward, allocation-happy and
// easy to read against the upstream source, so that every other solver backend
// (GPU, and any future one) can be validated against it. Optimise a new backend
// behind the `SolverBackend` seam instead of changing this file.
//
// Consequences of that role:
//   - It runs headlessly in Node, so it is what tests, golden traces and CI
//     compare against. GPU backends cannot play this part.
//   - Changing its output changes the definition of correct. Golden traces will
//     fail loudly; re-bless them only deliberately.
//   - It is also the no-WebGL2 fallback at runtime — a correctness guarantee,
//     not a performance one.
//
// The method names below intentionally mirror the upstream WebGL passes in
// third_party/origami-simulator (index.html shader blocks and
// js/dynamic/dynamicSolver.js):
// normalCalc -> thetaCalc -> updateCreaseGeo -> velocityCalc/positionCalc.
// The upstream solver stores node displacements relative to originalPosition
// textures; this port keeps the same state model and only writes absolute
// positions back to OrigamiModel for consumers/renderers.
//
// Note upstream's `globals.foldPercent` is 0..1 where `SimulatorOptions
// .foldPercent` here is 0..100; convert when comparing against the oracle.
const EPSILON = 1e-6;
const TWO_PI = Math.PI * 2;

const DEFAULT_OPTIONS: Required<SimulatorOptions> = {
  foldPercent: 0,
  foldProfile: null,
  axialStiffness: 20,
  creaseStiffness: 0.7,
  panelStiffness: 0.7,
  faceStiffness: 0.2,
  damping: 0.45,
  timeStep: 0,
  timeStepScale: 1,
  stepsPerFrame: 100,
  autoRender: true,
  integrationType: 'euler',
};

export class ReferenceSolver implements SolverBackend {
  readonly id = 'reference';
  readonly model: OrigamiModel;
  options: Required<SimulatorOptions>;
  private currentStep = 0;
  /**
   * `timeStep()` is a max over every beam and only changes with
   * `axialStiffness`, but used to be recomputed on every single step. Cached
   * here and invalidated in {@link setMaterial}.
   */
  private cachedTimeStep: number | null = null;
  private readonly forces: Float32Array;
  private readonly relativePositions: Float32Array;
  private readonly lastRelativePositions: Float32Array;
  private readonly lastLastRelativePositions: Float32Array;
  private readonly lastVelocity: Float32Array;
  private readonly theta: Float32Array;
  private readonly nodeBeams: NodeBeamRef[][];
  private readonly nodeCreases: NodeCreaseRef[][];
  private readonly nodeFaces: NodeFaceRef[][];
  private readonly nominalAngles: Vec3[];
  private foldProfileRanges = new Map<number, CreaseFoldRange>();

  constructor(model: OrigamiModel, options: SimulatorOptions = {}) {
    this.model = model;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.options.foldPercent = clampFoldPercent(this.options.foldPercent);
    this.foldProfileRanges = foldProfileRangeMap(this.options.foldProfile?.ranges ?? []);
    this.forces = new Float32Array(model.positions.length);
    this.relativePositions = new Float32Array(model.positions.length);
    this.lastRelativePositions = new Float32Array(model.positions.length);
    this.lastLastRelativePositions = new Float32Array(model.positions.length);
    this.lastVelocity = new Float32Array(model.positions.length);
    this.theta = new Float32Array(model.prepared.creaseParams.length);
    this.nodeBeams = buildNodeBeams(model);
    this.nodeCreases = buildNodeCreases(model);
    this.nodeFaces = buildNodeFaces(model);
    this.nominalAngles = buildNominalAngles(model);
    this.syncAbsolutePositions();
  }

  setFoldPercent(percent: number): void {
    this.options.foldPercent = clampFoldPercent(percent);
  }

  setFoldProfile(profile: SimulatorOptions['foldProfile']): void {
    this.options.foldProfile = profile ?? null;
    this.foldProfileRanges = foldProfileRangeMap(profile?.ranges ?? []);
  }

  setMaterial(options: Partial<SimulatorOptions>): void {
    this.options = {
      ...this.options,
      ...options,
      foldPercent:
        options.foldPercent === undefined ? this.options.foldPercent : clampFoldPercent(options.foldPercent),
    };
    if ('foldProfile' in options) {
      this.foldProfileRanges = foldProfileRangeMap(options.foldProfile?.ranges ?? []);
    }
    this.cachedTimeStep = null;
  }

  reset(): void {
    this.currentStep = 0;
    this.forces.fill(0);
    this.relativePositions.fill(0);
    this.lastRelativePositions.fill(0);
    this.lastLastRelativePositions.fill(0);
    this.lastVelocity.fill(0);
    this.theta.fill(0);
    this.model.reset();
  }

  arrestDynamics(): void {
    // Drain kinetic energy but keep positions/crease angles (the fold state).
    this.model.velocities.fill(0);
    this.lastVelocity.fill(0);
  }

  get stepCount(): number {
    return this.currentStep;
  }

  /**
   * Advance the simulation. Deliberately returns nothing and does no strain or
   * diagnostic work: this runs hundreds of times per frame, and the old
   * signature allocated two full copies of the model on every call via
   * `readFrame`. Pull data out with {@link readPositions} / {@link readFrame}.
   */
  step(numSteps = this.options.stepsPerFrame): void {
    for (let i = 0; i < numSteps; i += 1) {
      this.solveStep();
    }
  }

  readPositions(into: Float32Array): number {
    const length = Math.min(into.length, this.model.positions.length);
    into.set(this.model.positions.subarray(0, length));
    return length;
  }

  readColors(into: Float32Array): number {
    // Strain colours are only computed when somebody actually asks for them;
    // they used to be recomputed after every step batch whether displayed or
    // not, walking every edge to do it.
    this.model.applyStrainColors(0.05);
    const length = Math.min(into.length, this.model.colors.length);
    into.set(this.model.colors.subarray(0, length));
    return length;
  }

  readDiagnostics(): SimulatorDiagnostics {
    return this.model.diagnostics();
  }

  maxVelocity(): number {
    let max = 0;
    const velocities = this.model.velocities;
    for (let i = 0; i < velocities.length; i += 1) {
      const value = velocities[i]! < 0 ? -velocities[i]! : velocities[i]!;
      // NaN never satisfies `>`, so a naive comparison would swallow it and
      // report a blown-up model as converged. See WebglSolver.maxVelocity.
      if (!Number.isFinite(value)) return Number.NaN;
      if (value > max) max = value;
    }
    return max;
  }

  dispose(): void {
    // Nothing to release: all state is plain typed arrays owned by this
    // instance. Present so callers can treat every backend the same.
  }

  readFrame(): SimulationFrame {
    this.model.applyStrainColors(0.05);
    return {
      positions: this.model.positions.slice(),
      colors: this.model.colors.slice(),
      indices: this.model.prepared.indices,
      diagnostics: this.model.diagnostics(),
      step: this.currentStep,
      foldPercent: this.options.foldPercent,
    };
  }

  private solveStep(): void {
    const dt = this.timeStep();
    const normals = this.normalCalc();
    const theta = this.thetaCalc(normals);
    const creaseGeometry = this.updateCreaseGeo();

    if (this.options.integrationType === 'verlet') {
      this.positionCalcVerlet(dt, normals, theta, creaseGeometry);
      this.velocityCalcVerlet(dt);
    } else {
      this.velocityCalc(dt, normals, theta, creaseGeometry);
      this.positionCalc(dt);
    }

    this.currentStep += 1;
  }

  private normalCalc(): Float32Array {
    const normals = new Float32Array(this.model.prepared.faceCount * 3);
    for (let faceIndex = 0; faceIndex < this.model.prepared.faceCount; faceIndex += 1) {
      const face = this.model.prepared.facesVertices[faceIndex];
      if (!face) continue;
      const a = this.absolutePointAt(face[0] ?? 0);
      const b = this.absolutePointAt(face[1] ?? 0);
      const c = this.absolutePointAt(face[2] ?? 0);
      normals.set(normalize(cross(subtract(b, a), subtract(c, a))), faceIndex * 3);
    }
    return normals;
  }

  private thetaCalc(normals: Float32Array): Float32Array {
    for (let creaseIndex = 0; creaseIndex < this.model.prepared.creaseParams.length; creaseIndex += 1) {
      const crease = this.model.prepared.creaseParams[creaseIndex];
      if (!crease) continue;
      const edge = this.model.prepared.edgesVertices[crease.edge];
      if (!edge) continue;

      const normal1 = vectorAt(normals, crease.face1);
      const normal2 = vectorAt(normals, crease.face2);
      const node0 = this.absolutePointAt(edge[0]);
      const node1 = this.absolutePointAt(edge[1]);
      const creaseVector = normalize(subtract(node1, node0));
      const theta = Math.atan2(
        dot(cross(normal1, creaseVector), normal2),
        clamp(dot(normal1, normal2), -1, 1)
      );
      let diff = theta - (this.theta[creaseIndex] ?? 0);
      if (diff < -5) diff += TWO_PI;
      else if (diff > 5) diff -= TWO_PI;
      this.theta[creaseIndex] = (this.theta[creaseIndex] ?? 0) + diff;
    }
    return this.theta;
  }

  private updateCreaseGeo(): CreaseGeometry[] {
    return this.model.prepared.creaseParams.map((crease) => {
      const edge = this.model.prepared.edgesVertices[crease.edge];
      if (!edge) return DISABLED_CREASE_GEOMETRY;
      const node1 = this.absolutePointAt(crease.vertex1);
      const node2 = this.absolutePointAt(crease.vertex2);
      const node3 = this.absolutePointAt(edge[0]);
      const node4 = this.absolutePointAt(edge[1]);
      const creaseVector = subtract(node4, node3);
      const creaseLength = magnitude(creaseVector);
      if (Math.abs(creaseLength) < EPSILON) return DISABLED_CREASE_GEOMETRY;

      const unitCrease = scale(creaseVector, 1 / creaseLength);
      const vector1 = subtract(node1, node3);
      const vector2 = subtract(node2, node3);
      const projection1 = dot(unitCrease, vector1);
      const projection2 = dot(unitCrease, vector2);
      const height1 = Math.sqrt(Math.abs(dot(vector1, vector1) - projection1 * projection1));
      const height2 = Math.sqrt(Math.abs(dot(vector2, vector2) - projection2 * projection2));
      if (height1 < EPSILON || height2 < EPSILON) return DISABLED_CREASE_GEOMETRY;

      return {
        enabled: true,
        height1,
        height2,
        coef1: projection1 / creaseLength,
        coef2: projection2 / creaseLength,
      };
    });
  }

  private velocityCalc(
    dt: number,
    normals: Float32Array,
    theta: Float32Array,
    creaseGeometry: CreaseGeometry[]
  ): void {
    this.forces.fill(0);
    for (let vertex = 0; vertex < this.model.prepared.vertexCount; vertex += 1) {
      const force = this.forceForVertex(vertex, normals, theta, creaseGeometry);
      const offset = vertex * 3;
      this.forces.set(force, offset);
      this.model.velocities[offset] = (this.lastVelocity[offset] ?? 0) + force[0] * dt;
      this.model.velocities[offset + 1] = (this.lastVelocity[offset + 1] ?? 0) + force[1] * dt;
      this.model.velocities[offset + 2] = (this.lastVelocity[offset + 2] ?? 0) + force[2] * dt;
    }
    this.lastVelocity.set(this.model.velocities);
  }

  private positionCalc(dt: number): void {
    for (let index = 0; index < this.relativePositions.length; index += 1) {
      this.relativePositions[index] = (this.model.velocities[index] ?? 0) * dt + (this.lastRelativePositions[index] ?? 0);
      if (!Number.isFinite(this.relativePositions[index])) this.relativePositions[index] = 0;
    }
    this.lastRelativePositions.set(this.relativePositions);
    this.syncAbsolutePositions();
  }

  private positionCalcVerlet(
    dt: number,
    normals: Float32Array,
    theta: Float32Array,
    creaseGeometry: CreaseGeometry[]
  ): void {
    this.forces.fill(0);
    for (let vertex = 0; vertex < this.model.prepared.vertexCount; vertex += 1) {
      const force = this.forceForVertex(vertex, normals, theta, creaseGeometry);
      const offset = vertex * 3;
      this.forces.set(force, offset);
      this.relativePositions[offset] =
        force[0] * dt * dt + 2 * (this.lastRelativePositions[offset] ?? 0) - (this.lastLastRelativePositions[offset] ?? 0);
      this.relativePositions[offset + 1] =
        force[1] * dt * dt +
        2 * (this.lastRelativePositions[offset + 1] ?? 0) -
        (this.lastLastRelativePositions[offset + 1] ?? 0);
      this.relativePositions[offset + 2] =
        force[2] * dt * dt +
        2 * (this.lastRelativePositions[offset + 2] ?? 0) -
        (this.lastLastRelativePositions[offset + 2] ?? 0);
      if (!Number.isFinite(this.relativePositions[offset])) this.relativePositions[offset] = 0;
      if (!Number.isFinite(this.relativePositions[offset + 1])) this.relativePositions[offset + 1] = 0;
      if (!Number.isFinite(this.relativePositions[offset + 2])) this.relativePositions[offset + 2] = 0;
    }
  }

  private velocityCalcVerlet(dt: number): void {
    for (let index = 0; index < this.relativePositions.length; index += 1) {
      this.model.velocities[index] =
        ((this.relativePositions[index] ?? 0) - (this.lastRelativePositions[index] ?? 0)) / dt;
      if (!Number.isFinite(this.model.velocities[index])) this.model.velocities[index] = 0;
    }
    this.lastLastRelativePositions.set(this.lastRelativePositions);
    this.lastRelativePositions.set(this.relativePositions);
    this.lastVelocity.set(this.model.velocities);
    this.syncAbsolutePositions();
  }

  private forceForVertex(
    vertex: number,
    normals: Float32Array,
    theta: Float32Array,
    creaseGeometry: CreaseGeometry[]
  ): Vec3 {
    let force: Vec3 = [0, 0, 0];
    force = add(force, this.beamForce(vertex));
    force = add(force, this.creaseForce(vertex, normals, theta, creaseGeometry));
    force = add(force, this.faceForce(vertex, normals));
    return force;
  }

  private beamForce(vertex: number): Vec3 {
    let force: Vec3 = [0, 0, 0];
    const axialStiffness = Math.max(0, this.options.axialStiffness);
    const damping = Math.max(0, this.options.damping);
    const lastPosition = this.relativePointAt(vertex);
    const lastVelocity = this.velocityPointAt(this.lastVelocity, vertex);
    const originalPosition = pointAt(this.model.originalPositions, vertex);

    for (const beam of this.nodeBeams[vertex] ?? []) {
      const neighborLastPosition = this.relativePointAt(beam.otherVertex);
      const neighborLastVelocity = this.velocityPointAt(this.lastVelocity, beam.otherVertex);
      const neighborOriginalPosition = pointAt(this.model.originalPositions, beam.otherVertex);
      const nominalDistance = subtract(neighborOriginalPosition, originalPosition);
      let deltaP = add(subtract(neighborLastPosition, lastPosition), nominalDistance);
      const deltaPLength = magnitude(deltaP);
      if (deltaPLength < EPSILON) continue;
      const stiffness = axialStiffness / beam.restLength;
      const beamDamping = damping * 2 * Math.sqrt(stiffness);
      deltaP = subtract(deltaP, scale(deltaP, beam.restLength / deltaPLength));
      const deltaV = subtract(neighborLastVelocity, lastVelocity);
      force = add(force, add(scale(deltaP, stiffness), scale(deltaV, beamDamping)));
    }

    return force;
  }

  private creaseForce(
    vertex: number,
    normals: Float32Array,
    theta: Float32Array,
    geometry: CreaseGeometry[]
  ): Vec3 {
    let force: Vec3 = [0, 0, 0];
    for (const ref of this.nodeCreases[vertex] ?? []) {
      const crease = this.model.prepared.creaseParams[ref.creaseIndex];
      const geo = geometry[ref.creaseIndex];
      if (!crease || !geo || !geo.enabled) continue;

      const range = this.foldProfileRanges.get(crease.edge);
      const targetTheta = (this.targetAngleDegrees(crease, range) * Math.PI) / 180;
      const stiffness =
        (isFlatTarget(crease, range) ? this.options.panelStiffness : this.options.creaseStiffness) *
        this.model.edgeRestLength(crease.edge);
      const angularForce = stiffness * (targetTheta - (theta[ref.creaseIndex] ?? 0));

      if (ref.nodeNumber > 2) {
        const normal1 = vectorAt(normals, crease.face1);
        const normal2 = vectorAt(normals, crease.face2);
        let coef1 = geo.coef1;
        let coef2 = geo.coef2;
        if (ref.nodeNumber === 3) {
          coef1 = 1 - coef1;
          coef2 = 1 - coef2;
        }
        force = add(
          force,
          scale(add(scale(normal1, coef1 / geo.height1), scale(normal2, coef2 / geo.height2)), -angularForce)
        );
      } else {
        const normalIndex = ref.nodeNumber === 1 ? crease.face1 : crease.face2;
        const momentArm = ref.nodeNumber === 1 ? geo.height1 : geo.height2;
        const normal = vectorAt(normals, normalIndex);
        force = add(force, scale(normal, angularForce / momentArm));
      }
    }
    return force;
  }

  private targetAngleDegrees(crease: CreaseParameter, range: CreaseFoldRange | undefined): number {
    const foldScale = this.options.foldPercent / 100;
    if (!range) return crease.targetAngle * foldScale;
    return range.fromAngle + (range.toAngle - range.fromAngle) * foldScale;
  }

  private faceForce(vertex: number, normals: Float32Array): Vec3 {
    let force: Vec3 = [0, 0, 0];
    const stiffness = Math.max(0, this.options.faceStiffness);
    if (stiffness <= 0) return force;
    const vertexPosition = this.absolutePointAt(vertex);

    for (const ref of this.nodeFaces[vertex] ?? []) {
      const nominal = this.nominalAngles[ref.faceIndex];
      if (!nominal) continue;

      const a = ref.vertexOffset === 0 ? vertexPosition : this.absolutePointAt(ref.face[0] ?? 0);
      const b = ref.vertexOffset === 1 ? vertexPosition : this.absolutePointAt(ref.face[1] ?? 0);
      const c = ref.vertexOffset === 2 ? vertexPosition : this.absolutePointAt(ref.face[2] ?? 0);
      const ab = subtract(b, a);
      const ac = subtract(c, a);
      const bc = subtract(c, b);
      const lengthAB = magnitude(ab);
      const lengthAC = magnitude(ac);
      const lengthBC = magnitude(bc);
      if (lengthAB < EPSILON || lengthAC < EPSILON || lengthBC < EPSILON) continue;

      const unitAB = scale(ab, 1 / lengthAB);
      const unitAC = scale(ac, 1 / lengthAC);
      const unitBC = scale(bc, 1 / lengthBC);
      const angles: Vec3 = [
        Math.acos(clamp(dot(unitAB, unitAC), -1, 1)),
        Math.acos(clamp(-dot(unitAB, unitBC), -1, 1)),
        Math.acos(clamp(dot(unitAC, unitBC), -1, 1)),
      ];
      const anglesDiff: Vec3 = [
        (nominal[0] - angles[0]) * stiffness,
        (nominal[1] - angles[1]) * stiffness,
        (nominal[2] - angles[2]) * stiffness,
      ];
      const normal = vectorAt(normals, ref.faceIndex);

      if (ref.vertexOffset === 0) {
        const normalCrossAC = scale(cross(normal, unitAC), 1 / lengthAC);
        const normalCrossAB = scale(cross(normal, unitAB), 1 / lengthAB);
        force = add(force, scale(subtract(normalCrossAC, normalCrossAB), -anglesDiff[0]));
        force = add(force, scale(normalCrossAB, -anglesDiff[1]));
        force = add(force, scale(normalCrossAC, anglesDiff[2]));
      } else if (ref.vertexOffset === 1) {
        const normalCrossAB = scale(cross(normal, unitAB), 1 / lengthAB);
        const normalCrossBC = scale(cross(normal, unitBC), 1 / lengthBC);
        force = add(force, scale(normalCrossAB, -anglesDiff[0]));
        force = add(force, scale(add(normalCrossAB, normalCrossBC), anglesDiff[1]));
        force = add(force, scale(normalCrossBC, -anglesDiff[2]));
      } else {
        const normalCrossAC = scale(cross(normal, unitAC), 1 / lengthAC);
        const normalCrossBC = scale(cross(normal, unitBC), 1 / lengthBC);
        force = add(force, scale(normalCrossAC, anglesDiff[0]));
        force = add(force, scale(normalCrossBC, -anglesDiff[1]));
        force = add(force, scale(subtract(normalCrossBC, normalCrossAC), anglesDiff[2]));
      }
    }

    return force;
  }

  private timeStep(): number {
    if (this.options.timeStep > 0) return this.options.timeStep;
    if (this.cachedTimeStep !== null) return this.cachedTimeStep;
    this.cachedTimeStep = this.computeTimeStep();
    return this.cachedTimeStep;
  }

  private computeTimeStep(): number {
    let maxFrequency = 0;
    const axialStiffness = Math.max(0, this.options.axialStiffness);
    for (const beamRefs of this.nodeBeams) {
      for (const beam of beamRefs) {
        const stiffness = axialStiffness / beam.restLength;
        maxFrequency = Math.max(maxFrequency, Math.sqrt(stiffness));
      }
    }
    if (maxFrequency <= EPSILON) return 1 / 60;
    return (0.9 / (TWO_PI * maxFrequency)) * normalizedTimeStepScale(this.options.timeStepScale);
  }

  private relativePointAt(vertex: number): Vec3 {
    return pointAt(this.lastRelativePositions, vertex);
  }

  private absolutePointAt(vertex: number): Vec3 {
    return add(pointAt(this.model.originalPositions, vertex), pointAt(this.lastRelativePositions, vertex));
  }

  private velocityPointAt(source: Float32Array, vertex: number): Vec3 {
    return pointAt(source, vertex);
  }

  private syncAbsolutePositions(): void {
    for (let index = 0; index < this.model.positions.length; index += 1) {
      this.model.positions[index] =
        (this.model.originalPositions[index] ?? 0) + (this.lastRelativePositions[index] ?? 0);
      if (!Number.isFinite(this.model.positions[index])) {
        this.model.positions[index] = this.model.originalPositions[index] ?? 0;
        this.lastRelativePositions[index] = 0;
        this.relativePositions[index] = 0;
        this.lastLastRelativePositions[index] = 0;
        this.model.velocities[index] = 0;
        this.lastVelocity[index] = 0;
      }
    }
  }
}

type Vec3 = [number, number, number];

interface NodeBeamRef {
  otherVertex: number;
  restLength: number;
}

interface NodeCreaseRef {
  creaseIndex: number;
  nodeNumber: 1 | 2 | 3 | 4;
}

interface NodeFaceRef {
  faceIndex: number;
  face: number[];
  vertexOffset: 0 | 1 | 2;
}

interface CreaseGeometry {
  enabled: boolean;
  height1: number;
  height2: number;
  coef1: number;
  coef2: number;
}

const DISABLED_CREASE_GEOMETRY: CreaseGeometry = {
  enabled: false,
  height1: EPSILON,
  height2: EPSILON,
  coef1: 0,
  coef2: 0,
};

function pointAt(source: Float32Array, vertex: number): Vec3 {
  const offset = vertex * 3;
  return [source[offset] ?? 0, source[offset + 1] ?? 0, source[offset + 2] ?? 0];
}

function vectorAt(source: Float32Array, index: number): Vec3 {
  return pointAt(source, index);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

function magnitude(vector: Vec3): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector);
  if (length <= EPSILON) return [0, 1, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampFoldPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return clamp(percent, 0, 100);
}

function normalizedTimeStepScale(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  return clamp(scale, 0.05, 1);
}

function foldProfileRangeMap(ranges: CreaseFoldRange[]): Map<number, CreaseFoldRange> {
  const map = new Map<number, CreaseFoldRange>();
  for (const range of ranges) {
    if (
      !Number.isInteger(range.edge) ||
      range.edge < 0 ||
      !Number.isFinite(range.fromAngle) ||
      !Number.isFinite(range.toAngle)
    ) {
      continue;
    }
    map.set(range.edge, range);
  }
  return map;
}

function isFlatTarget(crease: CreaseParameter, range: CreaseFoldRange | undefined): boolean {
  if (!range) return crease.targetAngle === 0;
  return range.fromAngle === 0 && range.toAngle === 0;
}

function buildNodeBeams(model: OrigamiModel): NodeBeamRef[][] {
  const refs = Array.from({ length: model.prepared.vertexCount }, (): NodeBeamRef[] => []);
  model.prepared.edgesVertices.forEach((edge, edgeIndex) => {
    const restLength = Math.max(EPSILON, model.edgeRestLength(edgeIndex));
    refs[edge[0]]?.push({ otherVertex: edge[1], restLength });
    refs[edge[1]]?.push({ otherVertex: edge[0], restLength });
  });
  return refs;
}

function buildNodeCreases(model: OrigamiModel): NodeCreaseRef[][] {
  const refs = Array.from({ length: model.prepared.vertexCount }, (): NodeCreaseRef[] => []);
  model.prepared.creaseParams.forEach((crease, creaseIndex) => {
    const edge = model.prepared.edgesVertices[crease.edge];
    if (!edge) return;
    refs[crease.vertex1]?.push({ creaseIndex, nodeNumber: 1 });
    refs[crease.vertex2]?.push({ creaseIndex, nodeNumber: 2 });
    refs[edge[0]]?.push({ creaseIndex, nodeNumber: 3 });
    refs[edge[1]]?.push({ creaseIndex, nodeNumber: 4 });
  });
  return refs;
}

function buildNodeFaces(model: OrigamiModel): NodeFaceRef[][] {
  const refs = Array.from({ length: model.prepared.vertexCount }, (): NodeFaceRef[] => []);
  model.prepared.facesVertices.forEach((face, faceIndex) => {
    if (face.length !== 3) return;
    face.forEach((vertex, vertexOffset) => {
      refs[vertex]?.push({
        faceIndex,
        face,
        vertexOffset: vertexOffset as 0 | 1 | 2,
      });
    });
  });
  return refs;
}

function buildNominalAngles(model: OrigamiModel): Vec3[] {
  return model.prepared.facesVertices.map((face) => {
    const a = pointAt(model.originalPositions, face[0] ?? 0);
    const b = pointAt(model.originalPositions, face[1] ?? 0);
    const c = pointAt(model.originalPositions, face[2] ?? 0);
    const ab = normalize(subtract(b, a));
    const ac = normalize(subtract(c, a));
    const bc = normalize(subtract(c, b));
    return [
      Math.acos(clamp(dot(ab, ac), -1, 1)),
      Math.acos(clamp(-dot(ab, bc), -1, 1)),
      Math.acos(clamp(dot(ac, bc), -1, 1)),
    ];
  });
}
