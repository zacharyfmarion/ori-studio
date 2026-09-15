import type { PropertySheet } from '../../lib/propertyDescriptors';
import { useTextProperties } from '../annotations/useTextProperties';
import type { CanvasObjectKind, CanvasObjectTarget, TargetOf } from '../canvasObjects/canvasObjectKinds';
import { useFoldedFigureProperties } from '../folded/useFoldedFigureProperties';
import { useImageProperties } from '../images/useImageProperties';
import { useInlineSimulationProperties } from '../inlineSimulation/useInlineSimulationProperties';
import { useRegionProperties } from '../regions/useRegionProperties';

/**
 * One entry per canvas-object kind: the hook that turns the resolved target
 * into a {@link PropertySheet}. Store-bound and returning plain data; it is
 * called inside `SheetHost`, which is keyed on kind and id so hook order is
 * fixed for the life of one mount.
 */
export interface CanvasObjectPropertyEntry<K extends CanvasObjectKind> {
  kind: K;
  useSheet: (target: TargetOf<K>) => PropertySheet;
}

/**
 * The registry the Properties pane reads. The mapped `satisfies` is the
 * guarantee: a kind added to `CanvasObjectKind` without a row here fails to
 * typecheck, so a new kind cannot be selectable and sheet-less. React-bearing
 * (it holds hooks), unlike the kind table, which store-free consumers import.
 */
export const CANVAS_OBJECT_PROPERTY_KINDS = {
  image: { kind: 'image', useSheet: useImageProperties },
  text: { kind: 'text', useSheet: useTextProperties },
  suppressionRegion: { kind: 'suppressionRegion', useSheet: useRegionProperties },
  'folded-figure': { kind: 'folded-figure', useSheet: useFoldedFigureProperties },
  'inline-simulation': { kind: 'inline-simulation', useSheet: useInlineSimulationProperties },
} as const satisfies { [K in CanvasObjectKind]: CanvasObjectPropertyEntry<K> };

export type CanvasObjectPropertyTable = { [K in CanvasObjectKind]: CanvasObjectPropertyEntry<K> };

export interface CanvasObjectPropertyRegistry {
  get<K extends CanvasObjectKind>(kind: K): CanvasObjectPropertyEntry<K>;
  /** Run the target's kind's sheet hook. A hook: call it unconditionally, keyed per target. */
  useSheetFor(target: CanvasObjectTarget): PropertySheet;
  kinds: readonly CanvasObjectKind[];
}

/**
 * The parameter exists for the registry test, which drives resolver →
 * registry → renderer with a stub table the way `designKinds/registry.test.ts`
 * does; the app reads the default.
 */
export function canvasObjectPropertyRegistry(
  entries: CanvasObjectPropertyTable = CANVAS_OBJECT_PROPERTY_KINDS
): CanvasObjectPropertyRegistry {
  return {
    get: (kind) => entries[kind],
    useSheetFor: (target) => {
      // The table's `satisfies` clause is what pairs each row's hook with its
      // own target type; at this one dispatch site the union has to be
      // collapsed by hand, because `entries[target.kind]` types the hook's
      // parameter as the intersection of every target.
      const entry = entries[target.kind] as CanvasObjectPropertyEntry<CanvasObjectKind>;
      return (entry.useSheet as (target: CanvasObjectTarget) => PropertySheet)(target);
    },
    kinds: Object.keys(entries) as CanvasObjectKind[],
  };
}
