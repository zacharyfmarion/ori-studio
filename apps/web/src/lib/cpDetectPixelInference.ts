/** Full-resolution compact detector. Tiles own disjoint 384px interiors;
 * 64px halos provide context without merging nearby physical junctions. */
export interface PixelVertex {
  x: number;
  y: number;
  score: number;
  kind: 'interior_junction' | 'boundary_contact';
  boundary_side?: 'top' | 'right' | 'bottom' | 'left';
  side_coordinate?: number;
}

export interface PixelTensor {
  data: Float32Array;
  dims: readonly number[];
  dispose(): void;
}

export interface PixelSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, PixelTensor>): Promise<Record<string, PixelTensor>>;
}

export interface PixelEvidence {
  vertices: PixelVertex[];
  crease: Float32Array;
  auxiliary: Float32Array;
  inferenceMs: number;
  tiles: number;
}

const TILE = 512;
const HALO = 64;
const STRIDE = TILE - 2 * HALO;
const PIXELS = TILE * TILE;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function pixelVertices(
  points: readonly (readonly [number, number, number])[], size: number
): PixelVertex[] {
  const unique: (readonly [number, number, number])[] = [];
  for (const point of [...points].sort((a, b) => b[2] - a[2])) {
    if (unique.some(([x, y]) => (x - point[0]) ** 2 + (y - point[1]) ** 2 < 1)) continue;
    unique.push(point);
  }
  const inset = 32;
  const end = size - inset;
  const vertices: PixelVertex[] = [];
  for (const [x, y, score] of unique) {
    if (x < inset - 4 || x > end + 4 || y < inset - 4 || y > end + 4) continue;
    const sides: [number, NonNullable<PixelVertex['boundary_side']>][] = [
      [Math.abs(y - inset), 'top'], [Math.abs(x - end), 'right'],
      [Math.abs(y - end), 'bottom'], [Math.abs(x - inset), 'left'],
    ];
    sides.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    if (sides[1][0] <= 4) continue; // Exact paper corners come from the graph.
    const vertex: PixelVertex = { x, y, score, kind: 'interior_junction' };
    if (sides[0][0] <= 4) {
      const side = sides[0][1];
      vertex.kind = 'boundary_contact';
      vertex.boundary_side = side;
      if (side === 'top' || side === 'bottom') {
        vertex.y = side === 'top' ? inset : end;
        vertex.side_coordinate = (x - inset) / (size - 2 * inset);
      } else {
        vertex.x = side === 'left' ? inset : end;
        vertex.side_coordinate = (y - inset) / (size - 2 * inset);
      }
    }
    vertices.push(vertex);
  }
  return vertices;
}

export async function runPixelInference(
  session: PixelSession,
  tensor: (data: Float32Array, dims: number[]) => PixelTensor,
  image: Pick<ImageData, 'data' | 'width' | 'height'>,
  threshold = 0.35,
  outputName = session.outputNames[0],
): Promise<PixelEvidence> {
  const { width, height, data } = image;
  if (width !== height || width < 128 || width > 4096 || data.length !== width * height * 4) {
    throw new Error('Pixel detector requires a square rectified image of 128–4096 pixels');
  }
  if (!session.inputNames[0] || !outputName || !session.outputNames.includes(outputName)) {
    throw new Error('Missing pixel model tensors');
  }
  if (!(threshold > 0 && threshold < 1)) throw new Error('Invalid pixel confidence threshold');
  const begin = performance.now();
  // Exact median of the image's maximum channel, using a 256-bin histogram.
  const histogram = new Uint32Array(256);
  for (let i = 0; i < width * height; i++) {
    histogram[Math.max(data[4*i], data[4*i+1], data[4*i+2])]++;
  }
  let accumulated = 0;
  let lowerMedian = -1;
  let upperMedian = 255;
  const lowerIndex = Math.floor((width * height - 1) / 2);
  const upperIndex = Math.floor(width * height / 2);
  for (let i = 0; i < 256; i++) {
    accumulated += histogram[i];
    if (lowerMedian < 0 && accumulated > lowerIndex) lowerMedian = i;
    if (accumulated > upperIndex) { upperMedian = i; break; }
  }
  const dark = (lowerMedian + upperMedian) / 2 < 127.5;
  const crease = new Float32Array(width * height);
  const auxiliary = new Float32Array(width * height);
  const points: [number, number, number][] = [];
  let tiles = 0;
  const logitThreshold = Math.log(threshold / (1 - threshold));
  for (let y0 = 0; y0 < height; y0 += STRIDE) {
    for (let x0 = 0; x0 < width; x0 += STRIDE) {
      const input = new Float32Array(3 * PIXELS).fill(1);
      for (let y = 0; y < TILE; y++) {
        const iy = y0 + y - HALO;
        if (iy < 0 || iy >= height) continue;
        for (let x = 0; x < TILE; x++) {
          const ix = x0 + x - HALO;
          if (ix < 0 || ix >= width) continue;
          const src = (iy * width + ix) * 4;
          const shift = dark ? 255 - Math.max(data[src],data[src+1],data[src+2]) - Math.min(data[src],data[src+1],data[src+2]) : 0;
          for (let c = 0; c < 3; c++) input[c * PIXELS + y * TILE + x] = (data[src + c] + shift) / 255;
        }
      }
      const inputTensor = tensor(input, [1, 3, TILE, TILE]);
      let outputs: Record<string, PixelTensor> | undefined;
      try {
        outputs = await session.run({ [session.inputNames[0]]: inputTensor });
        const output = outputs[outputName];
        if (!output || output.dims.join(',') !== `1,5,${TILE},${TILE}` ||
            output.data.length !== 5 * PIXELS) throw new Error('Invalid pixel model output shape');
        const values = output.data;
        for (let y = 0; y < Math.min(STRIDE, height - y0); y++) {
          for (let x = 0; x < Math.min(STRIDE, width - x0); x++) {
            const from = (y + HALO) * TILE + x + HALO;
            const to = (y0 + y) * width + x0 + x;
            crease[to] = sigmoid(values[3 * PIXELS + from]);
            auxiliary[to] = sigmoid(values[4 * PIXELS + from]);
          }
        }
        // Inspect the halo too: an offset can move a peak across the ownership
        // seam. Decide ownership on its corrected position, never peak index.
        for (let y = HALO - 3; y < HALO + STRIDE + 3; y++) {
          for (let x = HALO - 3; x < HALO + STRIDE + 3; x++) {
            const i = y * TILE + x;
            if (values[i] < logitThreshold) continue;
            let peak = true;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (values[i + dy * TILE + dx] > values[i]) peak = false;
              }
            }
            if (!peak) continue;
            const px = Math.fround(x + Math.fround(values[PIXELS + i] * 3));
            const py = Math.fround(y + Math.fround(values[2 * PIXELS + i] * 3));
            if (px < HALO || px >= HALO + STRIDE || py < HALO || py >= HALO + STRIDE) continue;
            const gx = px + x0 - HALO, gy = py + y0 - HALO;
            if (gx < width && gy < height) points.push([gx, gy, sigmoid(values[i])]);
          }
        }
        tiles++;
      } finally {
        inputTensor.dispose();
        if (outputs) for (const value of Object.values(outputs)) value.dispose();
      }
    }
  }
  return { vertices: pixelVertices(points, width), crease, auxiliary,
    inferenceMs: performance.now() - begin, tiles };
}
