import type {
  CpDetectRuntimeInfo,
  CpDetectTensorData,
  CpDetectPaperFrame,
  CpVertexRefinerInferenceResult,
  CpVertexRefinerModelManifest,
} from '../engine/cpDetectTypes';
import {
  runVertexRefinerInference,
  type VertexRefinerOnnxSession,
  type VertexRefinerTensorFactory,
} from './vertexRefinerInference';

const VERTEX_KIND_NAMES = [
  'background',
  'interior_junction',
  'boundary_contact',
  'corner',
  'endpoint_or_dangling',
] as const;
const BOUNDARY_SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;
const RAY_BINS = 36;
const DEFAULT_GRID_STRIDE_PX = 64;

export type VertexRefinerVertexKind = (typeof VERTEX_KIND_NAMES)[number];
export type VertexRefinerBoundarySide = (typeof BOUNDARY_SIDE_NAMES)[number];

export type VertexRefinerFrame = CpDetectPaperFrame;

export interface VertexRefinerProposal {
  x: number;
  y: number;
  score: number;
  provenance: string[];
}

export interface VertexRefinerDecodedVertex {
  x: number;
  y: number;
  score: number;
  kind_id: number;
  kind: VertexRefinerVertexKind;
  degree_class: number;
  degree: number;
  ray_bins: number[];
  boundary_side_id: number | null;
  boundary_side: VertexRefinerBoundarySide | null;
  side_coordinate: number | null;
  crop_index: number;
}

export interface VertexRefinerMergedVertex extends Omit<VertexRefinerDecodedVertex, 'crop_index'> {
  support_count: number;
  possible_support_count: number;
  support_fraction: number;
  mean_member_distance_px: number;
  max_member_distance_px: number;
}

export interface VertexRefinerSourceFeatures {
  width: number;
  height: number;
  frame: VertexRefinerFrame;
  image_gray: Float32Array;
  source_ink_probability: Float32Array;
  source_distance_to_ink: Float32Array;
  source_orientation_cos2: Float32Array;
  source_orientation_sin2: Float32Array;
  signed_distance_to_frame: Float32Array;
  frame_edge_mask: Float32Array;
  inside_paper_mask: Float32Array;
  boundary_contact_prior: Float32Array;
}

export interface VertexRefinerImageOptions {
  frame?: VertexRefinerFrame;
  cropSize?: number;
  proposalCap?: number;
  proposals?: VertexRefinerProposal[];
  gridStridePx?: number;
  heatmapThreshold?: number;
  boundaryHeatmapThreshold?: number;
  nmsRadiusPx?: number;
  mergeRadiusPx?: number;
  boundaryMergeRadiusPx?: number;
  minSupport?: number;
  minSupportFraction?: number;
  splitSameCropConflicts?: boolean;
  splitMinSupportFraction?: number;
  rayThreshold?: number;
  runtime?: CpDetectRuntimeInfo;
}

export interface VertexRefinerImageResult {
  manifest: CpVertexRefinerModelManifest;
  inference: CpVertexRefinerInferenceResult;
  frame: VertexRefinerFrame;
  proposals: VertexRefinerProposal[];
  raw_vertices: VertexRefinerDecodedVertex[];
  merged_vertices: VertexRefinerMergedVertex[];
  runtime?: CpDetectRuntimeInfo;
}

export async function runVertexRefinerOnImage(
  session: VertexRefinerOnnxSession,
  tensorFactory: VertexRefinerTensorFactory,
  image: ImageData,
  manifest: CpVertexRefinerModelManifest,
  options: VertexRefinerImageOptions = {},
): Promise<VertexRefinerImageResult> {
  const startedAt = performance.now();
  const cropSize = options.cropSize ?? manifest.inference.crop_size;
  const frame = options.frame ?? fullImageFrame(image.width, image.height);
  const featureStartedAt = performance.now();
  const features = buildVertexRefinerSourceFeatures(image, { cropSize, frame });
  const proposalStartedAt = performance.now();
  const proposals =
    options.proposals ??
    selectVertexRefinerProposals(
      generateSlidingWindowVertexRefinerProposals(image.width, image.height, {
        cropSize,
        frame,
        proposalCap: options.proposalCap ?? manifest.inference.proposal_cap ?? 256,
        stridePx: options.gridStridePx ?? DEFAULT_GRID_STRIDE_PX,
      }),
      {
        cropSize,
        maxCount: options.proposalCap ?? manifest.inference.proposal_cap ?? 256,
        imageWidth: image.width,
        imageHeight: image.height,
      },
    );
  const tensorStartedAt = performance.now();
  const cropTensor = buildVertexRefinerCropTensor(features, proposals, cropSize);
  const inference = await runVertexRefinerInferenceInChunks(
    session,
    tensorFactory,
    cropTensor,
    manifest,
    options.runtime,
    manifest.inference.batch_size ?? 1,
  );
  const decodeStartedAt = performance.now();
  const rawVertices = decodeVertexRefinerOutputTensors(inference.outputs, proposals, {
    cropSize,
    frame,
    heatmapThreshold: options.heatmapThreshold ?? manifest.inference.heatmap_threshold,
    boundaryHeatmapThreshold:
      options.boundaryHeatmapThreshold ?? manifest.inference.boundary_heatmap_threshold,
    nmsRadiusPx: options.nmsRadiusPx ?? manifest.inference.nms_radius_px ?? 2,
    rayThreshold: options.rayThreshold ?? 0.5,
  });
  const mergedVertices = mergeDecodedVertexRefinerVertices(rawVertices, proposals, {
    cropSize,
    radiusPx: options.mergeRadiusPx ?? Math.max(manifest.inference.merge_radius_px ?? 5, 5),
    boundaryRadiusPx:
      options.boundaryMergeRadiusPx ?? Math.max(manifest.inference.boundary_merge_radius_px ?? 5, 5),
    minSupport: options.minSupport ?? 1,
    minSupportFraction:
      options.minSupportFraction ?? manifest.inference.min_support_fraction ?? 0.25,
    splitSameCropConflicts:
      options.splitSameCropConflicts ?? manifest.inference.split_same_crop_conflicts ?? false,
    splitMinSupportFraction:
      options.splitMinSupportFraction ?? manifest.inference.split_min_support_fraction ?? 0.5,
  });
  const finishedAt = performance.now();
  return {
    manifest,
    inference,
    frame,
    proposals,
    raw_vertices: rawVertices,
    merged_vertices: mergedVertices,
    runtime: {
      ...inference.runtime,
      vertex_refiner_feature_ms: proposalStartedAt - featureStartedAt,
      vertex_refiner_proposal_ms: tensorStartedAt - proposalStartedAt,
      vertex_refiner_tensor_ms: decodeStartedAt - tensorStartedAt,
      vertex_refiner_decode_ms: finishedAt - decodeStartedAt,
      vertex_refiner_total_ms: finishedAt - startedAt,
    } as CpDetectRuntimeInfo,
  };
}

async function runVertexRefinerInferenceInChunks(
  session: VertexRefinerOnnxSession,
  tensorFactory: VertexRefinerTensorFactory,
  cropTensor: Float32Array,
  manifest: CpVertexRefinerModelManifest,
  runtime: CpDetectRuntimeInfo | undefined,
  batchSize: number,
): Promise<CpVertexRefinerInferenceResult> {
  const cropSize = manifest.inference.crop_size;
  const inputChannels = manifest.inference.input_channels;
  const cropValues = inputChannels * cropSize * cropSize;
  const cropCount = cropTensor.length / cropValues;
  const chunkSize = Math.max(1, Math.floor(batchSize));
  if (cropCount <= chunkSize) {
    return runVertexRefinerInference(session, tensorFactory, cropTensor, manifest, runtime);
  }

  const startedAt = performance.now();
  const chunks: CpVertexRefinerInferenceResult[] = [];
  for (let cropStart = 0; cropStart < cropCount; cropStart += chunkSize) {
    const cropEnd = Math.min(cropCount, cropStart + chunkSize);
    const valueStart = cropStart * cropValues;
    const valueEnd = cropEnd * cropValues;
    chunks.push(
      await runVertexRefinerInference(
        session,
        tensorFactory,
        cropTensor.slice(valueStart, valueEnd),
        manifest,
        runtime,
      ),
    );
  }
  const first = chunks[0];
  if (!first) {
    return runVertexRefinerInference(session, tensorFactory, cropTensor, manifest, runtime);
  }
  const outputs = Object.fromEntries(
    (Object.keys(first.outputs) as Array<keyof CpVertexRefinerInferenceResult['outputs']>).map(
      (key) => [key, concatenateOutputTensor(chunks.map((chunk) => chunk.outputs[key]))],
    ),
  ) as CpVertexRefinerInferenceResult['outputs'];
  const finishedAt = performance.now();
  return {
    manifest,
    input: {
      crop_size: cropSize,
      crop_count: cropCount,
      input_name: first.input.input_name,
    },
    outputs,
    runtime: {
      ...first.runtime,
      ...runtime,
      total_inference_ms: finishedAt - startedAt,
      vertex_refiner_batch_count: chunks.length,
      vertex_refiner_batch_size: chunkSize,
    } as CpDetectRuntimeInfo,
  };
}

function concatenateOutputTensor(tensors: readonly CpDetectTensorData[]): CpDetectTensorData {
  const first = tensors[0];
  if (!first) {
    return { data: new Float32Array(), dims: [0] };
  }
  const totalLength = tensors.reduce((sum, tensor) => sum + tensor.data.length, 0);
  const data = new Float32Array(totalLength);
  let offset = 0;
  let batch = 0;
  for (const tensor of tensors) {
    data.set(tensor.data, offset);
    offset += tensor.data.length;
    batch += tensor.dims[0] ?? 0;
  }
  return {
    data,
    dims: [batch, ...first.dims.slice(1)],
  };
}

export function buildVertexRefinerSourceFeatures(
  image: ImageData,
  options: { cropSize?: number; frame?: VertexRefinerFrame } = {},
): VertexRefinerSourceFeatures {
  const width = image.width;
  const height = image.height;
  const cropSize = options.cropSize ?? 96;
  const frame = options.frame ?? fullImageFrame(width, height);
  const pixelCount = width * height;
  const gray = new Float32Array(pixelCount);
  const chroma = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const rgba = index * 4;
    const alpha = image.data[rgba + 3] / 255;
    const red = compositeOverWhite(image.data[rgba], alpha);
    const green = compositeOverWhite(image.data[rgba + 1], alpha);
    const blue = compositeOverWhite(image.data[rgba + 2], alpha);
    gray[index] = 0.299 * red + 0.587 * green + 0.114 * blue;
    chroma[index] = Math.max(red, green, blue) - Math.min(red, green, blue);
  }

  const medianGray = percentile(gray, 0.5);
  const contrast = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    contrast[index] = Math.abs(gray[index] - medianGray);
  }
  const contrastScale = Math.max(percentile(contrast, 0.98), 1e-3);
  const chromaScale = Math.max(percentile(chroma, 0.98), 1e-3);
  const ink = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    ink[index] = clamp01(Math.max(contrast[index] / contrastScale, chroma[index] / chromaScale));
  }
  const blurredInk = gaussian3x3(ink, width, height);
  for (let index = 0; index < pixelCount; index += 1) {
    ink[index] = Math.max(ink[index], blurredInk[index]);
  }

  const distance = distanceToInkMap(ink, width, height, cropSize);
  const [orientationCos2, orientationSin2] = sourceOrientationChannels(ink, width, height);
  const frameMaps = buildFrameFeatureMaps(ink, width, height, frame, cropSize);
  return {
    width,
    height,
    frame,
    image_gray: gray,
    source_ink_probability: ink,
    source_distance_to_ink: distance,
    source_orientation_cos2: orientationCos2,
    source_orientation_sin2: orientationSin2,
    ...frameMaps,
  };
}

export function generateSlidingWindowVertexRefinerProposals(
  width: number,
  height: number,
  options: {
    cropSize?: number;
    frame?: VertexRefinerFrame;
    proposalCap?: number;
    stridePx?: number;
  } = {},
): VertexRefinerProposal[] {
  const cropSize = options.cropSize ?? 96;
  const frame = options.frame ?? fullImageFrame(width, height);
  const proposalCap = Math.max(1, Math.floor(options.proposalCap ?? 256));
  const stride = Math.max(8, options.stridePx ?? DEFAULT_GRID_STRIDE_PX);
  const boundaryStride = Math.max(8, Math.min(stride / 2, cropSize / 3));
  const boundaryProposals: VertexRefinerProposal[] = [];
  for (const [x, y] of [
    [frame.x_min, frame.y_min],
    [frame.x_max, frame.y_min],
    [frame.x_max, frame.y_max],
    [frame.x_min, frame.y_max],
  ]) {
    boundaryProposals.push({ x, y, score: 1, provenance: ['square_frame_corner'] });
  }
  for (const x of gridCenters(frame.x_min, frame.x_max, boundaryStride)) {
    boundaryProposals.push({ x, y: frame.y_min, score: 0.85, provenance: ['boundary_contact_top'] });
    boundaryProposals.push({ x, y: frame.y_max, score: 0.85, provenance: ['boundary_contact_bottom'] });
  }
  for (const y of gridCenters(frame.y_min, frame.y_max, boundaryStride)) {
    boundaryProposals.push({ x: frame.x_min, y, score: 0.85, provenance: ['boundary_contact_left'] });
    boundaryProposals.push({ x: frame.x_max, y, score: 0.85, provenance: ['boundary_contact_right'] });
  }
  const mergedBoundaryProposals = mergeVertexRefinerProposals(boundaryProposals, 1e-3);
  const interiorBudget = Math.max(0, proposalCap - mergedBoundaryProposals.length);
  const [xCount, yCount] = interiorGridCounts(frame, cropSize, interiorBudget);
  const xCenters = evenlySpacedInteriorCenters(frame.x_min, frame.x_max, cropSize, xCount);
  const yCenters = evenlySpacedInteriorCenters(frame.y_min, frame.y_max, cropSize, yCount);
  const proposals: VertexRefinerProposal[] = [...mergedBoundaryProposals];
  for (const y of yCenters) {
    for (const x of xCenters) {
      proposals.push({ x, y, score: 0.35, provenance: ['sliding_window'] });
    }
  }
  return mergeVertexRefinerProposals(proposals, 1e-3);
}

export function selectVertexRefinerProposals(
  proposals: VertexRefinerProposal[],
  options: { cropSize: number; maxCount: number; imageWidth: number; imageHeight: number },
): VertexRefinerProposal[] {
  const ranked = [...proposals].sort(proposalCompare);
  if (ranked.length <= options.maxCount) return ranked;
  const selected: VertexRefinerProposal[] = [];
  const remaining = [...ranked];
  const cellSize = Math.max(4, Math.round(options.cropSize / 12));
  const covered = new Uint8Array(
    Math.max(1, Math.ceil(options.imageWidth / cellSize)) *
      Math.max(1, Math.ceil(options.imageHeight / cellSize)),
  );
  const coveredWidth = Math.max(1, Math.ceil(options.imageWidth / cellSize));
  while (remaining.length > 0 && selected.length < options.maxCount) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let index = 0; index < remaining.length; index += 1) {
      const proposal = remaining[index];
      const quality = proposalQuality(proposal);
      const coverage = newCoverageFraction(proposal, covered, coveredWidth, cellSize, options);
      const value = 0.55 * quality + 0.45 * coverage;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    }
    const [proposal] = remaining.splice(bestIndex, 1);
    selected.push(proposal);
    markCovered(proposal, covered, coveredWidth, cellSize, options);
  }
  return selected;
}

export function buildVertexRefinerCropTensor(
  features: VertexRefinerSourceFeatures,
  proposals: readonly VertexRefinerProposal[],
  cropSize: number,
): Float32Array {
  const channelCount = 11;
  const cropArea = cropSize * cropSize;
  const tensor = new Float32Array(proposals.length * channelCount * cropArea);
  const xGrid = normalizedCoordGrid(cropSize, 'x');
  const yGrid = normalizedCoordGrid(cropSize, 'y');
  const maps = [
    [features.image_gray, 1],
    [features.source_ink_probability, 0],
    [features.source_distance_to_ink, 1],
    [features.source_orientation_cos2, 0],
    [features.source_orientation_sin2, 0],
    [features.signed_distance_to_frame, -1],
    [features.frame_edge_mask, 0],
    [features.inside_paper_mask, 0],
    [features.boundary_contact_prior, 0],
    [xGrid, 0],
    [yGrid, 0],
  ] as const;
  proposals.forEach((proposal, batchIndex) => {
    const [originX, originY] = cropOriginForCenter(proposal, cropSize);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const [source, padValue] = maps[channel];
      const channelOffset = batchIndex * channelCount * cropArea + channel * cropArea;
      if (channel >= 9) {
        tensor.set(source, channelOffset);
      } else {
        copyCrop(source, features.width, features.height, originX, originY, cropSize, padValue, tensor, channelOffset);
      }
    }
  });
  return tensor;
}

export function decodeVertexRefinerOutputTensors(
  outputs: CpVertexRefinerInferenceResult['outputs'],
  proposals: readonly VertexRefinerProposal[],
  options: {
    cropSize: number;
    frame: VertexRefinerFrame;
    heatmapThreshold: number;
    boundaryHeatmapThreshold?: number;
    nmsRadiusPx: number;
    rayThreshold?: number;
  },
): VertexRefinerDecodedVertex[] {
  const cropSize = options.cropSize;
  const vertices: VertexRefinerDecodedVertex[] = [];
  for (let cropIndex = 0; cropIndex < proposals.length; cropIndex += 1) {
    const [originX, originY] = cropOriginForCenter(proposals[cropIndex], cropSize);
    const peaks = [
      ...peakEntries(outputs.vertex_heatmap, cropIndex, 0, cropSize, options.heatmapThreshold, options.nmsRadiusPx, false),
      ...peakEntries(
        outputs.boundary_contact_heatmap,
        cropIndex,
        0,
        cropSize,
        options.boundaryHeatmapThreshold ?? options.heatmapThreshold,
        options.nmsRadiusPx,
        true,
      ),
    ];
    for (const peak of dedupePeakEntries(peaks).sort((left, right) => right.score - left.score || left.row - right.row || left.col - right.col)) {
      const offsetBase = tensorOffset(outputs.vertex_offset, cropIndex, 0, peak.row, peak.col, cropSize);
      const dx = outputs.vertex_offset.data[offsetBase];
      const dy = outputs.vertex_offset.data[offsetBase + cropSize * cropSize];
      let kindId = argmaxChannel(outputs.vertex_kind, cropIndex, peak.row, peak.col, cropSize);
      if (peak.boundaryCandidate && (kindId === 0 || kindId === 1)) {
        kindId = 2;
      }
      const degreeClass = argmaxChannel(outputs.degree, cropIndex, peak.row, peak.col, cropSize);
      let x = originX + peak.col + dx;
      let y = originY + peak.row + dy;
      const kindName = VERTEX_KIND_NAMES[kindId] ?? 'background';
      const boundarySideId = argmaxChannel(outputs.boundary_side, cropIndex, peak.row, peak.col, cropSize);
      const predictedBoundarySide = BOUNDARY_SIDE_NAMES[boundarySideId] ?? null;
      const boundaryLike = peak.boundaryCandidate || kindName === 'boundary_contact';
      let boundarySide: VertexRefinerBoundarySide | null = boundaryLike
        ? predictedBoundarySide ?? nearestFrameSide(x, y, options.frame)
        : null;
      if (boundaryLike) {
        boundarySide ??= nearestFrameSide(x, y, options.frame);
        [x, y] = snapPointToFrame(x, y, options.frame, boundarySide);
        kindId = 2;
      }
      const sideCoordinate = boundarySide
        ? boundarySideCoordinate(x, y, options.frame, boundarySide)
        : null;
      vertices.push({
        x,
        y,
        score: peak.score,
        kind_id: kindId,
        kind: VERTEX_KIND_NAMES[kindId] ?? 'background',
        degree_class: degreeClass,
        degree: degreeClass,
        ray_bins: activeRayBins(outputs.incident_rays, cropIndex, peak.row, peak.col, cropSize, options.rayThreshold ?? 0.5),
        boundary_side_id: boundarySide ? BOUNDARY_SIDE_NAMES.indexOf(boundarySide) : null,
        boundary_side: boundarySide,
        side_coordinate: sideCoordinate,
        crop_index: cropIndex,
      });
    }
  }
  return vertices;
}

export function mergeDecodedVertexRefinerVertices(
  rawVertices: readonly VertexRefinerDecodedVertex[],
  proposals: readonly VertexRefinerProposal[],
  options: {
    cropSize: number;
    radiusPx: number;
    boundaryRadiusPx?: number;
    minSupport?: number;
    minSupportFraction?: number;
    splitSameCropConflicts?: boolean;
    splitMinSupportFraction?: number;
  },
): VertexRefinerMergedVertex[] {
  const clusters: VertexRefinerDecodedVertex[][] = [];
  for (const vertex of [...rawVertices].sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x)) {
    let matchIndex = -1;
    let bestDistance = isBoundaryVertex(vertex) ? options.boundaryRadiusPx ?? options.radiusPx : options.radiusPx;
    for (let index = 0; index < clusters.length; index += 1) {
      const distance = clusterDistance(vertex, clusters[index]);
      if (distance <= bestDistance) {
        bestDistance = distance;
        matchIndex = index;
      }
    }
    if (matchIndex < 0) clusters.push([vertex]);
    else clusters[matchIndex].push(vertex);
  }
  return clusters
    .flatMap((cluster) => splitSameCropConflictClusters(cluster, options))
    .filter(({ cluster }) => cluster.length >= (options.minSupport ?? 1))
    .map(({ cluster, fromConflictSplit }) => ({
      vertex: mergeVertexCluster(cluster, proposals, options.cropSize),
      fromConflictSplit,
    }))
    .filter(({ vertex }) => vertex.support_fraction >= (options.minSupportFraction ?? 0))
    .filter(({ vertex, fromConflictSplit }) => (
      !fromConflictSplit || vertex.support_fraction >= (options.splitMinSupportFraction ?? options.minSupportFraction ?? 0)
    ))
    .map(({ vertex }) => vertex)
    .sort((left, right) => right.support_count - left.support_count || right.score - left.score || left.y - right.y || left.x - right.x);
}

export function fullImageFrame(width: number, height: number): VertexRefinerFrame {
  return {
    x_min: 0,
    y_min: 0,
    x_max: Math.max(1, width - 1),
    y_max: Math.max(1, height - 1),
  };
}

function compositeOverWhite(channel: number, alpha: number): number {
  return (channel * alpha + 255 * (1 - alpha)) / 255;
}

function percentile(values: Float32Array, p: number): number {
  if (values.length === 0) return 0;
  const copy = Array.from(values);
  copy.sort((left, right) => left - right);
  return copy[Math.round((copy.length - 1) * clamp(p, 0, 1))] ?? 0;
}

function gaussian3x3(values: Float32Array, width: number, height: number): Float32Array {
  const output = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let weight = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = clampInt(x + dx, 0, width - 1);
          const yy = clampInt(y + dy, 0, height - 1);
          const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
          sum += values[yy * width + xx] * w;
          weight += w;
        }
      }
      output[y * width + x] = sum / weight;
    }
  }
  return output;
}

function distanceToInkMap(
  ink: Float32Array,
  width: number,
  height: number,
  cropSize: number,
): Float32Array {
  const distance = new Float32Array(ink.length);
  const maxDistance = 1e6;
  let hasInk = false;
  for (let index = 0; index < ink.length; index += 1) {
    if (ink[index] >= 0.2) {
      distance[index] = 0;
      hasInk = true;
    } else {
      distance[index] = maxDistance;
    }
  }
  if (!hasInk) {
    distance.fill(1);
    return distance;
  }
  const diag = Math.SQRT2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      let best = distance[idx];
      if (x > 0) best = Math.min(best, distance[idx - 1] + 1);
      if (y > 0) best = Math.min(best, distance[idx - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distance[idx - width - 1] + diag);
      if (x + 1 < width && y > 0) best = Math.min(best, distance[idx - width + 1] + diag);
      distance[idx] = best;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const idx = y * width + x;
      let best = distance[idx];
      if (x + 1 < width) best = Math.min(best, distance[idx + 1] + 1);
      if (y + 1 < height) best = Math.min(best, distance[idx + width] + 1);
      if (x + 1 < width && y + 1 < height) best = Math.min(best, distance[idx + width + 1] + diag);
      if (x > 0 && y + 1 < height) best = Math.min(best, distance[idx + width - 1] + diag);
      distance[idx] = Math.min(1, best / Math.max(cropSize, 1));
    }
  }
  return distance;
}

function sourceOrientationChannels(
  ink: Float32Array,
  width: number,
  height: number,
): [Float32Array, Float32Array] {
  const smooth = gaussian3x3(ink, width, height);
  const cos2 = new Float32Array(ink.length);
  const sin2 = new Float32Array(ink.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const left = smooth[y * width + clampInt(x - 1, 0, width - 1)];
      const right = smooth[y * width + clampInt(x + 1, 0, width - 1)];
      const top = smooth[clampInt(y - 1, 0, height - 1) * width + x];
      const bottom = smooth[clampInt(y + 1, 0, height - 1) * width + x];
      const tangent = Math.atan2(bottom - top, right - left) + Math.PI / 2;
      const support = ink[y * width + x] >= 0.15 ? 1 : 0;
      cos2[y * width + x] = Math.cos(2 * tangent) * support;
      sin2[y * width + x] = Math.sin(2 * tangent) * support;
    }
  }
  return [cos2, sin2];
}

function buildFrameFeatureMaps(
  ink: Float32Array,
  width: number,
  height: number,
  frame: VertexRefinerFrame,
  cropSize: number,
): Pick<
  VertexRefinerSourceFeatures,
  'signed_distance_to_frame' | 'frame_edge_mask' | 'inside_paper_mask' | 'boundary_contact_prior'
> {
  const signed = new Float32Array(ink.length);
  const edgeMask = new Float32Array(ink.length);
  const insideMask = new Float32Array(ink.length);
  const boundaryPrior = new Float32Array(ink.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const inside = x >= frame.x_min && x <= frame.x_max && y >= frame.y_min && y <= frame.y_max;
      insideMask[idx] = inside ? 1 : 0;
      const insideDistance = Math.min(
        x - frame.x_min,
        frame.x_max - x,
        y - frame.y_min,
        frame.y_max - y,
      );
      const outsideDx = Math.max(frame.x_min - x, x - frame.x_max, 0);
      const outsideDy = Math.max(frame.y_min - y, y - frame.y_max, 0);
      const outsideDistance = Math.hypot(outsideDx, outsideDy);
      signed[idx] = clamp((inside ? insideDistance : -outsideDistance) / Math.max(cropSize, 1), -1, 1);
      const edge = inFrameBand(x, y, frame, 1.5);
      const contact = inFrameBand(x, y, frame, 3);
      edgeMask[idx] = edge ? 1 : 0;
      boundaryPrior[idx] = contact ? ink[idx] : 0;
    }
  }
  return {
    signed_distance_to_frame: signed,
    frame_edge_mask: edgeMask,
    inside_paper_mask: insideMask,
    boundary_contact_prior: boundaryPrior,
  };
}

function inFrameBand(x: number, y: number, frame: VertexRefinerFrame, band: number): boolean {
  const horizontalSpan = x >= frame.x_min - band && x <= frame.x_max + band;
  const verticalSpan = y >= frame.y_min - band && y <= frame.y_max + band;
  return (
    (Math.abs(y - frame.y_min) <= band && horizontalSpan) ||
    (Math.abs(y - frame.y_max) <= band && horizontalSpan) ||
    (Math.abs(x - frame.x_min) <= band && verticalSpan) ||
    (Math.abs(x - frame.x_max) <= band && verticalSpan)
  );
}

function gridCenters(start: number, end: number, stride: number): number[] {
  if (end <= start) return [(start + end) / 2];
  const centers: number[] = [];
  for (let value = start; value <= end + 1e-6; value += stride) {
    centers.push(value);
  }
  if (Math.abs((centers[centers.length - 1] ?? start) - end) > stride * 0.35) {
    centers.push(end);
  }
  return centers;
}

function interiorGridCounts(
  frame: VertexRefinerFrame,
  cropSize: number,
  budget: number,
): [number, number] {
  if (budget <= 0) return [0, 0];
  const width = Math.max(1, frame.x_max - frame.x_min);
  const height = Math.max(1, frame.y_max - frame.y_min);
  const minX = Math.max(1, Math.ceil(width / cropSize));
  const minY = Math.max(1, Math.ceil(height / cropSize));
  const aspect = clamp(width / height, 0.25, 4);
  if (minX * minY > budget) {
    let xCount = Math.max(1, Math.floor(Math.sqrt(budget * aspect)));
    let yCount = Math.max(1, Math.floor(budget / Math.max(xCount, 1)));
    while (xCount * yCount > budget && yCount > 1) yCount -= 1;
    while (xCount * yCount > budget && xCount > 1) xCount -= 1;
    return [xCount, yCount];
  }

  let xCount = Math.max(minX, Math.floor(Math.sqrt(budget * aspect)));
  let yCount = Math.max(minY, Math.floor(Math.sqrt(budget / aspect)));
  while (xCount * yCount > budget) {
    const xSurplus = xCount / minX;
    const ySurplus = yCount / minY;
    if (xSurplus >= ySurplus && xCount > minX) {
      xCount -= 1;
    } else if (yCount > minY) {
      yCount -= 1;
    } else {
      break;
    }
  }
  return [xCount, yCount];
}

function evenlySpacedInteriorCenters(
  frameMin: number,
  frameMax: number,
  cropSize: number,
  count: number,
): number[] {
  if (count <= 0) return [];
  const half = cropSize / 2;
  const start = frameMin + half;
  const end = frameMax - half;
  if (count === 1 || end <= start) return [(frameMin + frameMax) / 2];
  return Array.from(
    { length: count },
    (_, index) => start + ((end - start) * index) / Math.max(count - 1, 1),
  );
}

function mergeVertexRefinerProposals(
  proposals: readonly VertexRefinerProposal[],
  radiusPx: number,
): VertexRefinerProposal[] {
  const merged: VertexRefinerProposal[] = [];
  for (const proposal of [...proposals].sort(proposalCompare)) {
    const match = merged.findIndex((existing) => Math.hypot(existing.x - proposal.x, existing.y - proposal.y) <= radiusPx);
    if (match < 0) {
      merged.push({ ...proposal, provenance: [...proposal.provenance] });
      continue;
    }
    const existing = merged[match];
    const existingWeight = Math.max(existing.score, 1e-3);
    const proposalWeight = Math.max(proposal.score, 1e-3);
    const total = existingWeight + proposalWeight;
    merged[match] = {
      x: (existing.x * existingWeight + proposal.x * proposalWeight) / total,
      y: (existing.y * existingWeight + proposal.y * proposalWeight) / total,
      score: Math.max(existing.score, proposal.score),
      provenance: [...new Set([...existing.provenance, ...proposal.provenance])].sort(),
    };
  }
  return merged.sort(proposalCompare);
}

function proposalCompare(left: VertexRefinerProposal, right: VertexRefinerProposal): number {
  return (
    proposalQuality(right) - proposalQuality(left) ||
    left.y - right.y ||
    left.x - right.x ||
    left.provenance.join(',').localeCompare(right.provenance.join(','))
  );
}

function proposalQuality(proposal: VertexRefinerProposal): number {
  const bonuses: Record<string, number> = {
    square_frame_corner: 0.95,
    boundary_contact_top: 0.5,
    boundary_contact_right: 0.5,
    boundary_contact_bottom: 0.5,
    boundary_contact_left: 0.5,
    sliding_window: 0.1,
  };
  return proposal.score + Math.max(0, ...proposal.provenance.map((key) => bonuses[key] ?? 0));
}

function newCoverageFraction(
  proposal: VertexRefinerProposal,
  covered: Uint8Array,
  coveredWidth: number,
  cellSize: number,
  options: { cropSize: number; imageWidth: number; imageHeight: number },
): number {
  const [x0, y0] = cropOriginForCenter(proposal, options.cropSize);
  const col0 = clampInt(Math.floor(x0 / cellSize), 0, coveredWidth - 1);
  const row0 = Math.max(0, Math.floor(y0 / cellSize));
  const col1 = clampInt(Math.ceil((x0 + options.cropSize) / cellSize), col0 + 1, coveredWidth);
  const row1 = Math.max(row0 + 1, Math.ceil((y0 + options.cropSize) / cellSize));
  let total = 0;
  let fresh = 0;
  for (let row = row0; row < row1; row += 1) {
    for (let col = col0; col < col1; col += 1) {
      const idx = row * coveredWidth + col;
      if (idx >= covered.length) continue;
      total += 1;
      if (covered[idx] === 0) fresh += 1;
    }
  }
  return total === 0 ? 0 : fresh / total;
}

function markCovered(
  proposal: VertexRefinerProposal,
  covered: Uint8Array,
  coveredWidth: number,
  cellSize: number,
  options: { cropSize: number; imageWidth: number; imageHeight: number },
): void {
  const [x0, y0] = cropOriginForCenter(proposal, options.cropSize);
  const col0 = clampInt(Math.floor(x0 / cellSize), 0, coveredWidth - 1);
  const row0 = Math.max(0, Math.floor(y0 / cellSize));
  const col1 = clampInt(Math.ceil((x0 + options.cropSize) / cellSize), col0 + 1, coveredWidth);
  const row1 = Math.max(row0 + 1, Math.ceil((y0 + options.cropSize) / cellSize));
  for (let row = row0; row < row1; row += 1) {
    for (let col = col0; col < col1; col += 1) {
      const idx = row * coveredWidth + col;
      if (idx < covered.length) covered[idx] = 1;
    }
  }
}

function cropOriginForCenter(
  center: { x: number; y: number },
  cropSize: number,
): [number, number] {
  return [Math.round(center.x - cropSize / 2), Math.round(center.y - cropSize / 2)];
}

function normalizedCoordGrid(cropSize: number, axis: 'x' | 'y'): Float32Array {
  const output = new Float32Array(cropSize * cropSize);
  for (let y = 0; y < cropSize; y += 1) {
    for (let x = 0; x < cropSize; x += 1) {
      const value = -1 + (2 * (axis === 'x' ? x : y)) / Math.max(cropSize - 1, 1);
      output[y * cropSize + x] = value;
    }
  }
  return output;
}

function copyCrop(
  source: Float32Array,
  width: number,
  height: number,
  originX: number,
  originY: number,
  cropSize: number,
  padValue: number,
  target: Float32Array,
  targetOffset: number,
): void {
  for (let y = 0; y < cropSize; y += 1) {
    const sourceY = originY + y;
    for (let x = 0; x < cropSize; x += 1) {
      const sourceX = originX + x;
      target[targetOffset + y * cropSize + x] =
        sourceX >= 0 && sourceX < width && sourceY >= 0 && sourceY < height
          ? source[sourceY * width + sourceX]
          : padValue;
    }
  }
}

function peakEntries(
  tensor: CpDetectTensorData,
  batchIndex: number,
  channel: number,
  cropSize: number,
  threshold: number,
  radius: number,
  boundaryCandidate: boolean,
): Array<{ score: number; row: number; col: number; boundaryCandidate: boolean }> {
  const peaks: Array<{ score: number; row: number; col: number; boundaryCandidate: boolean }> = [];
  for (let row = 0; row < cropSize; row += 1) {
    for (let col = 0; col < cropSize; col += 1) {
      const score = sigmoid(tensor.data[tensorOffset(tensor, batchIndex, channel, row, col, cropSize)]);
      if (score < threshold) continue;
      let isPeak = true;
      for (let yy = Math.max(0, row - radius); yy <= Math.min(cropSize - 1, row + radius) && isPeak; yy += 1) {
        for (let xx = Math.max(0, col - radius); xx <= Math.min(cropSize - 1, col + radius); xx += 1) {
          if (sigmoid(tensor.data[tensorOffset(tensor, batchIndex, channel, yy, xx, cropSize)]) > score + 1e-6) {
            isPeak = false;
            break;
          }
        }
      }
      if (isPeak) peaks.push({ score, row, col, boundaryCandidate });
    }
  }
  return peaks;
}

function dedupePeakEntries(
  peaks: Array<{ score: number; row: number; col: number; boundaryCandidate: boolean }>,
): Array<{ score: number; row: number; col: number; boundaryCandidate: boolean }> {
  const byCell = new Map<string, { score: number; row: number; col: number; boundaryCandidate: boolean }>();
  for (const peak of peaks) {
    const key = `${peak.row}:${peak.col}`;
    const previous = byCell.get(key);
    byCell.set(key, {
      ...peak,
      score: Math.max(peak.score, previous?.score ?? 0),
      boundaryCandidate: peak.boundaryCandidate || previous?.boundaryCandidate === true,
    });
  }
  return [...byCell.values()];
}

function tensorOffset(
  tensor: CpDetectTensorData,
  batchIndex: number,
  channel: number,
  row: number,
  col: number,
  cropSize: number,
): number {
  const channels = tensor.dims[1] ?? 1;
  return batchIndex * channels * cropSize * cropSize + channel * cropSize * cropSize + row * cropSize + col;
}

function argmaxChannel(
  tensor: CpDetectTensorData,
  batchIndex: number,
  row: number,
  col: number,
  cropSize: number,
): number {
  const channels = tensor.dims[1] ?? 1;
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let channel = 0; channel < channels; channel += 1) {
    const value = tensor.data[tensorOffset(tensor, batchIndex, channel, row, col, cropSize)];
    if (value > bestValue) {
      bestValue = value;
      bestIndex = channel;
    }
  }
  return bestIndex;
}

function activeRayBins(
  tensor: CpDetectTensorData,
  batchIndex: number,
  row: number,
  col: number,
  cropSize: number,
  threshold: number,
): number[] {
  const bins: number[] = [];
  for (let channel = 0; channel < Math.min(tensor.dims[1] ?? RAY_BINS, RAY_BINS); channel += 1) {
    const value = sigmoid(tensor.data[tensorOffset(tensor, batchIndex, channel, row, col, cropSize)]);
    if (value >= threshold) bins.push(channel);
  }
  return bins;
}

function nearestFrameSide(x: number, y: number, frame: VertexRefinerFrame): VertexRefinerBoundarySide {
  const distances: Record<VertexRefinerBoundarySide, number> = {
    top: Math.abs(y - frame.y_min),
    right: Math.abs(x - frame.x_max),
    bottom: Math.abs(y - frame.y_max),
    left: Math.abs(x - frame.x_min),
  };
  return BOUNDARY_SIDE_NAMES.reduce((best, side) =>
    distances[side] < distances[best] ? side : best,
  );
}

function snapPointToFrame(
  x: number,
  y: number,
  frame: VertexRefinerFrame,
  side: VertexRefinerBoundarySide,
): [number, number] {
  if (side === 'top') return [clamp(x, frame.x_min, frame.x_max), frame.y_min];
  if (side === 'right') return [frame.x_max, clamp(y, frame.y_min, frame.y_max)];
  if (side === 'bottom') return [clamp(x, frame.x_min, frame.x_max), frame.y_max];
  return [frame.x_min, clamp(y, frame.y_min, frame.y_max)];
}

function boundarySideCoordinate(
  x: number,
  y: number,
  frame: VertexRefinerFrame,
  side: VertexRefinerBoundarySide,
): number {
  const spanX = Math.max(1, frame.x_max - frame.x_min);
  const spanY = Math.max(1, frame.y_max - frame.y_min);
  if (side === 'top' || side === 'bottom') {
    return clamp01((x - frame.x_min) / spanX);
  }
  return clamp01((y - frame.y_min) / spanY);
}

function isBoundaryVertex(vertex: VertexRefinerDecodedVertex): boolean {
  return vertex.kind === 'boundary_contact' && vertex.boundary_side !== null;
}

function splitSameCropConflictClusters(
  cluster: VertexRefinerDecodedVertex[],
  options: {
    radiusPx: number;
    boundaryRadiusPx?: number;
    splitSameCropConflicts?: boolean;
  },
): Array<{ cluster: VertexRefinerDecodedVertex[]; fromConflictSplit: boolean }> {
  if (!options.splitSameCropConflicts || !hasSameCropConflict(cluster)) {
    return [{ cluster, fromConflictSplit: false }];
  }
  const subclusters: VertexRefinerDecodedVertex[][] = [];
  for (const vertex of [...cluster].sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x)) {
    let matchIndex = -1;
    let bestDistance = isBoundaryVertex(vertex) ? options.boundaryRadiusPx ?? options.radiusPx : options.radiusPx;
    for (let index = 0; index < subclusters.length; index += 1) {
      const distance = clusterDistance(vertex, subclusters[index], true);
      if (distance <= bestDistance) {
        bestDistance = distance;
        matchIndex = index;
      }
    }
    if (matchIndex < 0) subclusters.push([vertex]);
    else subclusters[matchIndex].push(vertex);
  }
  return subclusters.map((subcluster) => ({ cluster: subcluster, fromConflictSplit: true }));
}

function hasSameCropConflict(cluster: VertexRefinerDecodedVertex[]): boolean {
  const seen = new Set<number>();
  for (const vertex of cluster) {
    if (seen.has(vertex.crop_index)) return true;
    seen.add(vertex.crop_index);
  }
  return false;
}

function clusterDistance(
  vertex: VertexRefinerDecodedVertex,
  cluster: VertexRefinerDecodedVertex[],
  preventSameCrop = false,
): number {
  if (preventSameCrop && cluster.some((member) => member.crop_index === vertex.crop_index)) return Infinity;
  const [centerX, centerY] = weightedCenter(cluster);
  const clusterSide = cluster.find((member) => isBoundaryVertex(member))?.boundary_side ?? null;
  if (isBoundaryVertex(vertex) || clusterSide !== null) {
    if (!isBoundaryVertex(vertex) || clusterSide === null || vertex.boundary_side !== clusterSide) {
      if (isBoundaryVertex(vertex) && clusterSide !== null && vertex.boundary_side !== clusterSide) {
        return Math.hypot(vertex.x - centerX, vertex.y - centerY);
      }
      return Infinity;
    }
    return vertex.boundary_side === 'top' || vertex.boundary_side === 'bottom'
      ? Math.abs(vertex.x - centerX)
      : Math.abs(vertex.y - centerY);
  }
  return Math.hypot(vertex.x - centerX, vertex.y - centerY);
}

function mergeVertexCluster(
  cluster: VertexRefinerDecodedVertex[],
  proposals: readonly VertexRefinerProposal[],
  cropSize: number,
): VertexRefinerMergedVertex {
  const [x, y] = weightedCenter(cluster);
  const distances = cluster.map((vertex) => Math.hypot(vertex.x - x, vertex.y - y));
  const boundarySide = weightedSideMode(cluster);
  const sideCoordinate = boundarySide ? weightedSideCoordinate(cluster, boundarySide) : null;
  const kindId = boundarySide === null
    ? weightedMode(cluster.map((vertex) => [vertex.kind_id, vertex.score] as const))
    : 2;
  const possibleSupport = proposals.filter((proposal) => proposalContainsPoint(proposal, x, y, cropSize)).length;
  return {
    x,
    y,
    score: Math.max(...cluster.map((vertex) => vertex.score)),
    kind_id: kindId,
    kind: VERTEX_KIND_NAMES[kindId] ?? 'background',
    degree_class: weightedMode(cluster.map((vertex) => [vertex.degree_class, vertex.score] as const)),
    degree: weightedMode(cluster.map((vertex) => [vertex.degree, vertex.score] as const)),
    ray_bins: rayVote(cluster, 0.35),
    boundary_side_id: boundarySide ? BOUNDARY_SIDE_NAMES.indexOf(boundarySide) : null,
    boundary_side: boundarySide,
    side_coordinate: sideCoordinate,
    support_count: cluster.length,
    possible_support_count: possibleSupport,
    support_fraction: Math.min(1, cluster.length / Math.max(possibleSupport, 1)),
    mean_member_distance_px: distances.reduce((sum, value) => sum + value, 0) / Math.max(distances.length, 1),
    max_member_distance_px: Math.max(0, ...distances),
  };
}

function weightedCenter(cluster: VertexRefinerDecodedVertex[]): [number, number] {
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  for (const vertex of cluster) {
    const weight = Math.max(vertex.score, 1e-4);
    sumX += vertex.x * weight;
    sumY += vertex.y * weight;
    sumW += weight;
  }
  return [sumX / Math.max(sumW, 1e-4), sumY / Math.max(sumW, 1e-4)];
}

function weightedMode(items: ReadonlyArray<readonly [number, number]>): number {
  const votes = new Map<number, number>();
  for (const [key, score] of items) {
    votes.set(key, (votes.get(key) ?? 0) + Math.max(score, 1e-4));
  }
  return [...votes.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? 0;
}

function weightedSideMode(cluster: VertexRefinerDecodedVertex[]): VertexRefinerBoundarySide | null {
  const votes = new Map<VertexRefinerBoundarySide, number>();
  for (const vertex of cluster) {
    if (!vertex.boundary_side) continue;
    votes.set(vertex.boundary_side, (votes.get(vertex.boundary_side) ?? 0) + Math.max(vertex.score, 1e-4));
  }
  return [...votes.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? null;
}

function weightedSideCoordinate(
  cluster: VertexRefinerDecodedVertex[],
  side: VertexRefinerBoundarySide,
): number {
  let sum = 0;
  let weightSum = 0;
  for (const vertex of cluster) {
    if (vertex.boundary_side !== side || vertex.side_coordinate === null) continue;
    const weight = Math.max(vertex.score, 1e-4);
    sum += vertex.side_coordinate * weight;
    weightSum += weight;
  }
  return clamp01(sum / Math.max(weightSum, 1e-4));
}

function rayVote(cluster: VertexRefinerDecodedVertex[], voteFraction: number): number[] {
  const votes = new Map<number, number>();
  for (const vertex of cluster) {
    for (const bin of vertex.ray_bins) votes.set(bin, (votes.get(bin) ?? 0) + 1);
  }
  const required = Math.max(1, Math.ceil(voteFraction * cluster.length));
  return [...votes.entries()]
    .filter(([, count]) => count >= required)
    .map(([bin]) => bin)
    .sort((left, right) => left - right);
}

function proposalContainsPoint(proposal: VertexRefinerProposal, x: number, y: number, cropSize: number): boolean {
  const [originX, originY] = cropOriginForCenter(proposal, cropSize);
  return x >= originX && x < originX + cropSize && y >= originY && y < originY + cropSize;
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max));
}
