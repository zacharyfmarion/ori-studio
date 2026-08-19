import { describe, expect, it } from 'vitest';
import type { CpVertexRefinerOutputs } from '../engine/cpDetectTypes';
import {
  buildVertexRefinerCropTensor,
  buildVertexRefinerSourceFeatures,
  decodeVertexRefinerOutputTensors,
  fullImageFrame,
  generateDenseJunctionRegionVertexRefinerProposals,
  generateSlidingWindowVertexRefinerProposals,
  generateVertexRefinerProposals,
  mergeDecodedVertexRefinerVertices,
  mergeDecodedVertexRefinerVerticesWithDebug,
  runVertexRefinerOnImage,
  selectVertexRefinerProposals,
  type VertexRefinerDecodedVertex,
  type VertexRefinerProposal,
} from './vertexRefinerPipeline';

describe('vertexRefinerPipeline', () => {
  it('builds source-image feature maps from rendered pixels', () => {
    const image = whiteImage(8, 8);
    for (let y = 0; y < 8; y += 1) {
      setPixel(image, 4, y, [0, 0, 0, 255]);
    }

    const features = buildVertexRefinerSourceFeatures(image, { cropSize: 4 });

    expect(features.image_gray[4]).toBe(0);
    expect(features.source_ink_probability[4]).toBeGreaterThan(0.95);
    expect(features.source_ink_probability[3]).toBeLessThan(features.source_ink_probability[4]);
    expect(features.source_distance_to_ink[4]).toBe(0);
    expect(features.frame_edge_mask[0]).toBe(1);
    expect(features.inside_paper_mask[4 * 8 + 4]).toBe(1);
  });

  it('builds V3 crop tensors with constant padding and coordinate channels', () => {
    const image = whiteImage(8, 8);
    const features = buildVertexRefinerSourceFeatures(image);
    const proposals: VertexRefinerProposal[] = [
      { x: 0, y: 0, score: 1, provenance: ['square_frame_corner'] },
    ];

    const tensor = buildVertexRefinerCropTensor(features, proposals, 96);

    expect(tensor).toHaveLength(11 * 96 * 96);
    expect(tensor[0]).toBe(1);
    expect(tensor[9 * 96 * 96]).toBeCloseTo(-1);
    expect(tensor[9 * 96 * 96 + 95]).toBeCloseTo(1);
    expect(tensor[10 * 96 * 96]).toBeCloseTo(-1);
    expect(tensor[10 * 96 * 96 + 95 * 96]).toBeCloseTo(1);
  });

  it('decodes and merges V3 output tensors in image coordinates', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 48, y: 48, score: 1, provenance: ['test'] },
      { x: 50, y: 48, score: 1, provenance: ['test'] },
    ];
    const outputs = fakeOutputs(2, cropSize);
    setOutput(outputs.vertex_heatmap, 0, 0, 48, 48, cropSize, 8);
    setOutput(outputs.vertex_offset, 0, 0, 48, 48, cropSize, 0.25);
    setOutput(outputs.vertex_offset, 0, 1, 48, 48, cropSize, -0.5);
    setOutput(outputs.vertex_kind, 0, 1, 48, 48, cropSize, 7);
    setOutput(outputs.degree, 0, 4, 48, 48, cropSize, 7);
    setOutput(outputs.incident_rays, 0, 0, 48, 48, cropSize, 8);
    setOutput(outputs.incident_rays, 0, 18, 48, 48, cropSize, 8);
    setOutput(outputs.vertex_heatmap, 1, 0, 48, 46, cropSize, 7);
    setOutput(outputs.vertex_kind, 1, 1, 48, 46, cropSize, 7);

    const decoded = decodeVertexRefinerOutputTensors(outputs, proposals, {
      cropSize,
      frame: fullImageFrame(128, 128),
      heatmapThreshold: 0.25,
      nmsRadiusPx: 2,
    });
    const merged = mergeDecodedVertexRefinerVertices(decoded, proposals, {
      cropSize,
      radiusPx: 3,
      minSupport: 1,
    });

    expect(decoded[0]).toMatchObject({
      x: 48.25,
      y: 47.5,
      kind: 'interior_junction',
      boundary_side: null,
      degree: 4,
      ray_bins: [0, 18],
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].support_count).toBe(2);
  });

  it('reports raw-to-merged cluster membership for V3 merge debugging', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 48, y: 48, score: 1, provenance: ['test'] },
      { x: 50, y: 48, score: 1, provenance: ['test'] },
    ];
    const decoded: VertexRefinerDecodedVertex[] = [
      {
        x: 48,
        y: 48,
        score: 0.8,
        kind_id: 1,
        kind: 'interior_junction',
        degree_class: 4,
        degree: 4,
        ray_bins: [],
        boundary_side_id: null,
        boundary_side: null,
        side_coordinate: null,
        crop_index: 0,
      },
      {
        x: 49,
        y: 48,
        score: 0.7,
        kind_id: 1,
        kind: 'interior_junction',
        degree_class: 4,
        degree: 4,
        ray_bins: [],
        boundary_side_id: null,
        boundary_side: null,
        side_coordinate: null,
        crop_index: 1,
      },
    ];

    const result = mergeDecodedVertexRefinerVerticesWithDebug(decoded, proposals, {
      cropSize,
      radiusPx: 3,
      minSupport: 1,
    });

    expect(result.merged_vertices).toHaveLength(1);
    expect(result.debug.raw_to_merged).toEqual([
      expect.objectContaining({ raw_vertex_id: 0, merged_vertex_id: 0, status: 'merged' }),
      expect.objectContaining({ raw_vertex_id: 1, merged_vertex_id: 0, status: 'merged' }),
    ]);
    expect(result.debug.clusters).toEqual([
      expect.objectContaining({
        merged_vertex_id: 0,
        raw_vertex_ids: [0, 1],
        retained: true,
        reason: 'merged',
      }),
    ]);
  });

  it('generates and selects boundary-aware proposals plus square corners', () => {
    const proposals = generateSlidingWindowVertexRefinerProposals(256, 256, {
      proposalCap: 64,
      stridePx: 64,
    });
    const selected = selectVertexRefinerProposals(proposals, {
      cropSize: 96,
      maxCount: 64,
      imageWidth: 256,
      imageHeight: 256,
    });

    expect(proposals.length).toBeGreaterThanOrEqual(32);
    expect(selected.length).toBeLessThanOrEqual(64);
    expect(selected.length).toBe(proposals.length);
    expect(selected.some((proposal) => proposal.provenance.includes('square_frame_corner'))).toBe(
      true,
    );
    expect(selected.some((proposal) => proposal.provenance.includes('sliding_window'))).toBe(true);
    expect(
      selected.some(
        (proposal) => proposal.provenance.includes('boundary_contact_top') && proposal.y === 0,
      ),
    ).toBe(true);
    expect(
      selected.some(
        (proposal) => proposal.provenance.includes('boundary_contact_bottom') && proposal.y === 255,
      ),
    ).toBe(true);
  });

  it('uses the proposal cap for deterministic full-coverage interior crops', () => {
    const frame = {
      x_min: 32,
      y_min: 32,
      x_max: 992,
      y_max: 992,
    };
    const proposals = generateSlidingWindowVertexRefinerProposals(1024, 1024, {
      cropSize: 96,
      frame,
      proposalCap: 256,
      stridePx: 64,
    });
    const selected = selectVertexRefinerProposals(proposals, {
      cropSize: 96,
      maxCount: 256,
      imageWidth: 1024,
      imageHeight: 1024,
    });
    const boundaryCount = proposals.filter((proposal) =>
      proposal.provenance.some(
        (source) => source.startsWith('boundary_contact_') || source === 'square_frame_corner',
      ),
    ).length;
    const interior = proposals.filter((proposal) => proposal.provenance.includes('sliding_window'));
    const interiorXs = new Set(interior.map((proposal) => proposal.x));
    const interiorYs = new Set(interior.map((proposal) => proposal.y));

    expect(proposals).toHaveLength(241);
    expect(selected).toHaveLength(proposals.length);
    expect(boundaryCount).toBe(120);
    expect(interior).toHaveLength(121);
    expect(interiorXs.size).toBe(11);
    expect(interiorYs.size).toBe(11);
    expect(Math.min(...interior.map((proposal) => proposal.x))).toBe(80);
    expect(Math.max(...interior.map((proposal) => proposal.x))).toBe(944);
    expect(Math.min(...interior.map((proposal) => proposal.y))).toBe(80);
    expect(Math.max(...interior.map((proposal) => proposal.y))).toBe(944);
  });

  it('selects non-overlapping V3 crops around dense HRNet junction regions', () => {
    const logits = fakeDenseJunctionLogits(128, 128, [
      [30, 30],
      [34, 32],
      [37, 36],
      [92, 92],
      [96, 94],
      [100, 96],
      [12, 100],
    ]);

    const proposals = generateDenseJunctionRegionVertexRefinerProposals(logits, {
      imageWidth: 128,
      imageHeight: 128,
      cropSize: 32,
      frame: fullImageFrame(128, 128),
      proposalCap: 8,
      junctionThreshold: 0.5,
      minPeaksPerCrop: 3,
      maxOverlapFraction: 0,
    });

    expect(proposals).toHaveLength(2);
    expect(
      proposals.every((proposal) => proposal.provenance[0]?.startsWith('dense_junction_region:3')),
    ).toBe(true);
    expect(proposals.some((proposal) => Math.hypot(proposal.x - 34, proposal.y - 32) < 12)).toBe(
      true,
    );
    expect(proposals.some((proposal) => Math.hypot(proposal.x - 96, proposal.y - 94) < 12)).toBe(
      true,
    );
  });

  it('does not select dense-region crops that touch the paper border', () => {
    const logits = fakeDenseJunctionLogits(128, 128, [
      [3, 40],
      [4, 44],
      [7, 47],
      [64, 64],
      [68, 64],
      [64, 68],
    ]);

    const proposals = generateDenseJunctionRegionVertexRefinerProposals(logits, {
      imageWidth: 128,
      imageHeight: 128,
      cropSize: 32,
      frame: fullImageFrame(128, 128),
      proposalCap: 8,
      junctionThreshold: 0.5,
      minPeaksPerCrop: 3,
      maxOverlapFraction: 0,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].x).toBeGreaterThan(32);
    expect(proposals[0].y).toBeGreaterThan(32);
    expect(proposals[0].provenance).toContain('dense_junction_region:3');
  });

  it('uses dense-junction proposal mode instead of full coverage when dense logits are provided', () => {
    const logits = fakeDenseJunctionLogits(128, 128, [
      [64, 64],
      [68, 64],
      [64, 68],
      [96, 96],
    ]);

    const proposals = generateVertexRefinerProposals(128, 128, {
      mode: 'dense-junction-regions',
      denseJunctionLogits: logits,
      cropSize: 32,
      proposalCap: 16,
      denseRegionJunctionThreshold: 0.5,
      denseRegionMinPeaks: 3,
      denseRegionMaxOverlapFraction: 0,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].provenance).toContain('dense_junction_region:3');
  });

  it('snaps explicit boundary-contact predictions onto the frame', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 64, y: 0, score: 0.85, provenance: ['boundary_contact_top'] },
    ];
    const outputs = fakeOutputs(1, cropSize);
    setOutput(outputs.boundary_contact_heatmap, 0, 0, 48, 48, cropSize, 8);
    setOutput(outputs.vertex_kind, 0, 2, 48, 48, cropSize, 7);
    setOutput(outputs.degree, 0, 3, 48, 48, cropSize, 7);

    const decoded = decodeVertexRefinerOutputTensors(outputs, proposals, {
      cropSize,
      frame: fullImageFrame(128, 128),
      heatmapThreshold: 0.25,
      nmsRadiusPx: 2,
    });
    const merged = mergeDecodedVertexRefinerVertices(decoded, proposals, {
      cropSize,
      radiusPx: 3,
      boundaryRadiusPx: 2,
      minSupport: 1,
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      x: 64,
      y: 0,
      kind: 'boundary_contact',
      boundary_side: 'top',
      side_coordinate: 64 / 127,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: 'boundary_contact',
      boundary_side: 'top',
      side_coordinate: 64 / 127,
    });
  });

  it('merges side-split paper-corner boundary contacts', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 0, y: 0, score: 1, provenance: ['square_frame_corner'] },
      { x: 32, y: 0, score: 0.85, provenance: ['boundary_contact_top'] },
      { x: 0, y: 32, score: 0.85, provenance: ['boundary_contact_left'] },
    ];
    const decoded: VertexRefinerDecodedVertex[] = [
      {
        x: 0.1,
        y: 0,
        score: 0.76,
        kind_id: 2,
        kind: 'boundary_contact',
        degree_class: 2,
        degree: 2,
        ray_bins: [],
        boundary_side_id: 0,
        boundary_side: 'top',
        side_coordinate: 0.001,
        crop_index: 1,
      },
      {
        x: 0,
        y: 0,
        score: 0.68,
        kind_id: 2,
        kind: 'boundary_contact',
        degree_class: 2,
        degree: 2,
        ray_bins: [],
        boundary_side_id: 3,
        boundary_side: 'left',
        side_coordinate: 0,
        crop_index: 2,
      },
    ];

    const merged = mergeDecodedVertexRefinerVertices(decoded, proposals, {
      cropSize,
      radiusPx: 3,
      boundaryRadiusPx: 2,
      minSupport: 1,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      kind: 'boundary_contact',
      support_count: 2,
    });
    expect(merged[0].x).toBeCloseTo(0.05, 1);
    expect(merged[0].y).toBeCloseTo(0, 3);
  });

  it('filters weak one-of-many overlap clusters by support fraction', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 48, y: 48, score: 1, provenance: ['test'] },
      { x: 50, y: 48, score: 1, provenance: ['test'] },
      { x: 48, y: 50, score: 1, provenance: ['test'] },
      { x: 50, y: 50, score: 1, provenance: ['test'] },
      { x: 46, y: 46, score: 1, provenance: ['test'] },
    ];
    const decoded: VertexRefinerDecodedVertex[] = [
      {
        x: 48,
        y: 48,
        score: 0.4,
        kind_id: 1,
        kind: 'interior_junction',
        degree_class: 4,
        degree: 4,
        ray_bins: [],
        boundary_side_id: null,
        boundary_side: null,
        side_coordinate: null,
        crop_index: 0,
      },
    ];

    expect(
      mergeDecodedVertexRefinerVertices(decoded, proposals, {
        cropSize,
        radiusPx: 3,
        minSupport: 1,
        minSupportFraction: 0.25,
      }),
    ).toHaveLength(0);
    expect(
      mergeDecodedVertexRefinerVertices(decoded, proposals, {
        cropSize,
        radiusPx: 3,
        minSupport: 1,
        minSupportFraction: 0.2,
      }),
    ).toHaveLength(1);
  });

  it('keeps close vertices separate when the same crop detects both peaks', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [{ x: 48, y: 48, score: 1, provenance: ['test'] }];
    const decoded: VertexRefinerDecodedVertex[] = [
      {
        x: 48,
        y: 48,
        score: 0.8,
        kind_id: 1,
        kind: 'interior_junction',
        degree_class: 4,
        degree: 4,
        ray_bins: [],
        boundary_side_id: null,
        boundary_side: null,
        side_coordinate: null,
        crop_index: 0,
      },
      {
        x: 51,
        y: 48,
        score: 0.7,
        kind_id: 1,
        kind: 'interior_junction',
        degree_class: 4,
        degree: 4,
        ray_bins: [],
        boundary_side_id: null,
        boundary_side: null,
        side_coordinate: null,
        crop_index: 0,
      },
    ];

    expect(
      mergeDecodedVertexRefinerVertices(decoded, proposals, {
        cropSize,
        radiusPx: 5,
        minSupport: 1,
        splitSameCropConflicts: true,
      }),
    ).toHaveLength(2);
  });

  it('keeps near-frame interior predictions as interior vertices', () => {
    const cropSize = 96;
    const proposals: VertexRefinerProposal[] = [
      { x: 64, y: 0, score: 0.85, provenance: ['boundary_contact_top'] },
    ];
    const outputs = fakeOutputs(1, cropSize);
    setOutput(outputs.vertex_heatmap, 0, 0, 50, 48, cropSize, 8);
    setOutput(outputs.vertex_kind, 0, 1, 50, 48, cropSize, 7);
    setOutput(outputs.degree, 0, 3, 50, 48, cropSize, 7);

    const decoded = decodeVertexRefinerOutputTensors(outputs, proposals, {
      cropSize,
      frame: fullImageFrame(128, 128),
      heatmapThreshold: 0.25,
      nmsRadiusPx: 2,
    });

    expect(decoded).toHaveLength(1);
    expect(decoded[0]).toMatchObject({
      x: 64,
      y: 2,
      kind: 'interior_junction',
      boundary_side: null,
      side_coordinate: null,
    });
  });

  it('runs fixed-batch ONNX exports in crop chunks', async () => {
    const cropSize = 96;
    const calls: number[] = [];
    const image = whiteImage(128, 128);
    const proposals: VertexRefinerProposal[] = [
      { x: 32, y: 32, score: 1, provenance: ['test'] },
      { x: 64, y: 64, score: 1, provenance: ['test'] },
      { x: 96, y: 96, score: 1, provenance: ['test'] },
    ];

    const result = await runVertexRefinerOnImage(
      {
        inputNames: ['refiner_input'],
        async run(feeds) {
          const input = feeds.refiner_input as { dims: number[] };
          calls.push(input.dims[0] ?? 0);
          return fakeOutputs(input.dims[0] ?? 1, cropSize);
        },
      },
      {
        float32(data, dims) {
          return { data, dims: Array.from(dims) };
        },
      },
      image,
      testManifest(),
      {
        proposals,
        proposalCap: proposals.length,
      },
    );

    expect(calls).toEqual([1, 1, 1]);
    expect(result.inference.input.crop_count).toBe(3);
    expect(result.inference.outputs.vertex_heatmap.dims[0]).toBe(3);
  });

  it('caps large manifest V3 batches to browser-safe chunks by default', async () => {
    const cropSize = 96;
    const calls: number[] = [];
    const image = whiteImage(128, 128);
    const proposals = Array.from({ length: 33 }, (_, index): VertexRefinerProposal => ({
      x: 48 + (index % 3),
      y: 48 + Math.floor(index / 3),
      score: 1,
      provenance: ['test'],
    }));

    await runVertexRefinerOnImage(
      {
        inputNames: ['refiner_input'],
        async run(feeds) {
          const input = feeds.refiner_input as { dims: number[] };
          calls.push(input.dims[0] ?? 0);
          return fakeOutputs(input.dims[0] ?? 1, cropSize);
        },
      },
      {
        float32(data, dims) {
          return { data, dims: Array.from(dims) };
        },
      },
      image,
      testManifest(256),
      {
        proposals,
        proposalCap: proposals.length,
      },
    );

    expect(calls).toEqual([16, 16, 1]);
  });
});

function whiteImage(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = 255;
    data[index * 4 + 1] = 255;
    data[index * 4 + 2] = 255;
    data[index * 4 + 3] = 255;
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

function setPixel(image: ImageData, x: number, y: number, rgba: [number, number, number, number]) {
  const index = (y * image.width + x) * 4;
  image.data[index] = rgba[0];
  image.data[index + 1] = rgba[1];
  image.data[index + 2] = rgba[2];
  image.data[index + 3] = rgba[3];
}

function fakeOutputs(batch: number, cropSize: number): CpVertexRefinerOutputs {
  const tensor = (channels: number, fill = -8) => ({
    data: new Float32Array(batch * channels * cropSize * cropSize).fill(fill),
    dims: [batch, channels, cropSize, cropSize],
  });
  return {
    vertex_heatmap: tensor(1),
    vertex_offset: tensor(2, 0),
    vertex_kind: tensor(5),
    degree: tensor(9),
    incident_rays: tensor(36),
    boundary_contact_heatmap: tensor(1),
    boundary_side: tensor(4),
  };
}

function fakeDenseJunctionLogits(width: number, height: number, peaks: Array<[number, number]>) {
  const data = new Float32Array(width * height).fill(-8);
  for (const [x, y] of peaks) {
    data[y * width + x] = 8;
  }
  return {
    data,
    dims: [1, 1, height, width],
  };
}

function testManifest(batchSize = 1) {
  return {
    schema: 'oristudio/cp-vertex-refiner-model-manifest/v1',
    id: 'test-v3',
    model: {
      url: 'model.onnx',
    },
    inference: {
      model_version: 'v3',
      input_version: 'v3',
      onnx_input_name: 'refiner_input',
      crop_size: 96,
      input_channels: 11,
      heatmap_threshold: 0.25,
      proposal_cap: 3,
      batch_size: batchSize,
    },
    outputs: {
      vertex_heatmap: 'vertex_heatmap',
      vertex_offset: 'vertex_offset',
      vertex_kind: 'vertex_kind',
      degree: 'degree',
      incident_rays: 'incident_rays',
      boundary_contact_heatmap: 'boundary_contact_heatmap',
      boundary_side: 'boundary_side',
    },
  } as const;
}

function setOutput(
  tensor: { data: Float32Array; dims: readonly number[] },
  batch: number,
  channel: number,
  row: number,
  col: number,
  cropSize: number,
  value: number,
) {
  const channels = tensor.dims[1] ?? 1;
  tensor.data[
    batch * channels * cropSize * cropSize + channel * cropSize * cropSize + row * cropSize + col
  ] = value;
}
