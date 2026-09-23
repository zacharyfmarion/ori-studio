/**
 * The pattern's auxiliary lines, as the References workspace draws them.
 *
 * An aux line is a guide the crease pattern draws on the paper and nothing
 * folds — on a diagram, usually a crease that is already in the paper before
 * the sequence starts. The planner never sees one: the analysis keeps them
 * apart from a sheet's creases (`aux_segment_indices`), so an aux line is
 * never a step and never a target. The workspace draws them from the first
 * step on, in the paper style's aux pen, and a tap passes through them.
 *
 * Whether they are drawn is a view option, the way a folded figure's is in
 * Properties: the paper style's own switch (`auxCreases.visible`) until the
 * reader sets it in the References view pane, and the style's again after a
 * reset (`settingsStore.referencesShowAuxCreases`). The creases an earlier
 * step made are a different thing — the paper as it stands — and are drawn
 * whatever this says.
 */
import { useMemo } from 'react';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import type { DiagramSegment } from './diagram/diagramFrames';
import type { PrecreaseComponent } from './sheetFrames';
import type { ReferencesPaperInks } from './usePaperStyleTokens';

/** Whether the pattern's aux lines are drawn: the option when set, else the style's switch. */
export function referencesShowsAux(style: PaperStyle, option: boolean | null): boolean {
  if (option !== null) return option;
  return applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references).auxCreases.visible;
}

/** One sheet's aux lines, in each space something draws them in. */
export interface ReferencesSheetAux {
  /** The sheet they are on. */
  component: number;
  /** The editor's 1-based crease ids, for the canvas, which draws the document's own. */
  ids: ReadonlySet<number>;
  /** In the planner's unit square, for a card. */
  unit: readonly DiagramSegment[];
  /** In model space, for a page, which has no document under it. */
  model: readonly DiagramSegment[];
}

/** The aux lines on `component`, or null when it has none. */
export function referencesSheetAux(
  component: PrecreaseComponent,
  geometry: CpGeometryTransport
): ReferencesSheetAux | null {
  const indices = component.aux_segment_indices;
  if (indices.length === 0) return null;
  const endpoints = geometry.segEndpoints;
  const model: DiagramSegment[] = [];
  for (const index of indices) {
    const base = index * 4;
    if (base + 3 >= endpoints.length) continue;
    model.push([
      { x: endpoints[base]!, y: endpoints[base + 1]! },
      { x: endpoints[base + 2]!, y: endpoints[base + 3]! },
    ]);
  }
  return {
    component: component.id,
    ids: new Set(indices.map((index) => index + 1)),
    unit: component.aux_unit_segments.map(([x1, y1, x2, y2]) => [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ]),
    model,
  };
}

/** {@link referencesSheetAux} for the selected sheet, kept while the sheet and the geometry are. */
export function useReferencesSheetAux(
  component: PrecreaseComponent | null,
  geometry: CpGeometryTransport | null
): ReferencesSheetAux | null {
  return useMemo(
    () => (component && geometry ? referencesSheetAux(component, geometry) : null),
    [component, geometry]
  );
}

/**
 * What the canvas draws of a sheet's aux lines: their ids and the pen, when
 * they are shown (`referencesCreaseVisibility`), else nothing.
 */
export function shownSheetAux(
  sheet: ReferencesSheetAux | null,
  inks: Pick<ReferencesPaperInks, 'aux' | 'showAux'>
): { ids: ReadonlySet<number>; pen: ReferencesPaperInks['aux'] } | null {
  return sheet && inks.showAux ? { ids: sheet.ids, pen: inks.aux } : null;
}
