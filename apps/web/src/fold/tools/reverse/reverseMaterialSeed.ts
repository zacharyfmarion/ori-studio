import type { SheetPoint } from '../../document/foldSequenceDocument';
import type { FoldCrossSection, FoldScene } from '../../engine/foldEngineWire';
import { insideConvex, toPoint } from '../../canvas/foldCanvasGeometry';
import { flapSeed, type FoldResolvedSeed, type FoldToolState } from '../foldToolState';

/**
 * Axiom 2's first point names the material being moved when picked on the
 * crease pattern. The destination can be on another layer: it is only a
 * reference. Other constructions do not identify moving material this way.
 */
export function reverseMaterialPoint(
  tools: Pick<FoldToolState, 'tool' | 'lineMode' | 'picks' | 'swapped' | 'override'>
): SheetPoint | null {
  if (tools.tool !== 'inside-reverse' || tools.lineMode !== 'axiom-2' || tools.swapped || tools.override) return null;
  const source = tools.picks[0];
  return source?.kind === 'point' && source.pane === 'crease-pattern' ? source.sheet : null;
}

/**
 * Read the engine's connected flap at the exact sheet point, including a
 * vertex shared by its two sides. Pick by sheet material, never its visible
 * image or stack depth. Store the engine's interior witness, not the boundary
 * point (which would be an ambiguous material witness on replay).
 */
export function reverseMaterialSeed(scene: FoldScene, section: Pick<FoldCrossSection, 'flaps'>, at: SheetPoint): FoldResolvedSeed {
  const faces = new Set(scene.faces.flatMap((face, i) => {
    const polygon = face.points.map((v) => scene.sheet_points[v]!);
    const id = scene.lineage[i]?.id;
    return id !== undefined && polygon.length >= 3 && insideConvex(polygon, toPoint(at), 1e-8) ? [id] : [];
  }));
  return flapSeed(section.flaps.filter((flap) => flap.faces.some((face) => faces.has(face))), section.flaps);
}
