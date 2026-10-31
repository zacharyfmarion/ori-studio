/** Keep ink in front of its own fill after Float32 shader arithmetic and depth
 * buffer quantization. A bias divided by the number of bands vanishes on dense
 * stacks. Cap it inside the band's reserved margin so it cannot jump a layer. */
export function spreadInkDepthBias(bands: number, depthBits: number): number {
  return Math.min(0.05 / bands, Math.max(4 * 2 ** -depthBits, 2 ** -21));
}
