import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { keyDigest } from '../../lib/keyDigest';
import { canonicalJson } from '../document/foldDigest';

/** Geometry and assignments, including guides and angle hints; selection,
 * viewport, names and editor annotations cannot stale a Collapse. */
export function projectCpRevision(document: OristudioCpDocumentSnapshot): string {
  const lines = [...document.crease_pattern.line_segments, ...document.crease_pattern.aux_line_segments];
  return keyDigest(lines.map(({ a, b, color, fold_magnitude, fold_direction_hint }) =>
    canonicalJson({ a, b, color, fold_magnitude, fold_direction_hint })).sort(), 'collapse-cp1:');
}
