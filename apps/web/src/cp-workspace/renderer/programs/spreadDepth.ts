/** Keep ink in front of its own fill after Float32 shader arithmetic and depth
 * buffer quantization. A bias divided by the number of bands vanishes on dense
 * stacks. Cap it inside the band's reserved margin so it cannot jump a layer.
 *
 * `span` is the share of the depth range the picture draws in (`SpreadLayout`):
 * all of it in a pane of its own, one figure's band on Edit's canvas. The
 * floor is a depth-buffer step, so it does not shrink with the band; the cap
 * is a margin inside the band, so it does. */
export function spreadInkDepthBias(bands: number, depthBits: number, span = 1): number {
  return Math.min((0.05 * span) / bands, Math.max(4 * 2 ** -depthBits, 2 ** -21));
}
