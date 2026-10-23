/** Rejoin clipped triangle fragments without changing their paint order. */
import { storedSceneStep } from './captureGeometry';
import polygonClipping from 'polygon-clipping';
import type { PaperItem, PaperFaceItem, PaperScene, ScenePoint } from '../../lib/paper/paperScene';

export function compactCameraScene(scene: PaperScene): PaperScene {
  const items: PaperItem[] = [];
  let pending: PaperFaceItem[] = [];
  const flush = () => {
    if (!pending.length) return;
    const first = pending[0]!;
    if (pending.length === 1) items.push(first);
    else {
      // Round below the capture's storage precision before boolean operations.
      // Independently clipped shared intersections otherwise differ by ulps.
      const epsilon = storedSceneStep(scene.sheet);
      const polygons = pending
        .map((item) =>
          item.rings
            .map((ring) =>
              ring.map(([x, y]): ScenePoint => [Math.round(x / epsilon) * epsilon, Math.round(y / epsilon) * epsilon])
            )
            .map((ring) =>
              ring.filter((p, i) => {
                const next = ring[(i + 1) % ring.length]!;
                return p[0] !== next[0] || p[1] !== next[1];
              })
            )
            .filter(
              (ring) =>
                ring.length >= 3 &&
                Math.abs(
                  ring.reduce((sum, p, i) => {
                    const q = ring[(i + 1) % ring.length]!;
                    return sum + p[0] * q[1] - p[1] * q[0];
                  }, 0)
                ) >
                  (epsilon * epsilon) / 2
            )
        )
        .filter((polygon) => polygon.length > 0);
      if (!polygons.length) {
        pending = [];
        return;
      }
      try {
        const union = polygonClipping.union(polygons[0]!, ...polygons.slice(1));
        const rings = union.flatMap((polygon) => polygon.map((ring) => ring.slice(0, -1) as ScenePoint[]));
        if (rings.length) items.push({ ...first, rings });
      } catch {
        // Boolean stitching is only a size optimization. Near-coincident
        // intersections can defeat it; the already clipped vector pieces
        // remain the exact valid drawing, with the normal storage budget.
        items.push(...pending);
      }
    }
    pending = [];
  };
  for (const item of scene.items) {
    const previous = pending[0];
    if (
      item.kind !== 'face' ||
      (previous && (previous.face !== item.face || previous.side !== item.side || previous.shade !== item.shade))
    )
      flush();
    if (item.kind === 'face') pending.push(item);
    else items.push(item);
  }
  flush();
  // Visibility has already clipped every face and ink segment. Paint the
  // visible ink last: the SVG painter's seam-hiding fill stroke must not
  // erase a surviving crease simply because its source face had an earlier rank.
  return {
    ...scene,
    items: [...items.filter((item) => item.kind === 'face'), ...items.filter((item) => item.kind !== 'face')],
  };
}
