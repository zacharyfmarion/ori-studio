import { PropertySheetView } from '../../components/properties/PropertySheetView';
import { trackCanvasObjectPropertyChanged } from '../../analytics/trackCanvasObjectPropertyChanged';
import { CANVAS_COMPANION_PROPS } from '../canvasObjects/canvasCompanionSurface';
import type { CanvasObjectTarget } from '../canvasObjects/canvasObjectKinds';
import {
  canvasObjectPropertyRegistry,
  type CanvasObjectPropertyRegistry,
} from './canvasObjectPropertyRegistry';

const DEFAULT_REGISTRY = canvasObjectPropertyRegistry();

/**
 * The selected object's sheet: look its kind up, run that kind's hook, render.
 *
 * Mount it with `key={`${target.kind}:${target.id}`}` — the hook a kind runs
 * differs per kind, and a fresh mount per object is what keeps React's hook
 * order fixed and every row's draft reset when the selection moves.
 *
 * The sheet and every menu it opens carry the companion attribute, so a press
 * in here neither blurs a focused simulation window nor ends a text edit.
 */
export function SheetHost({
  target,
  registry = DEFAULT_REGISTRY,
}: {
  target: CanvasObjectTarget;
  registry?: CanvasObjectPropertyRegistry;
}) {
  const sheet = registry.useSheetFor(target);
  return (
    <PropertySheetView
      sheet={sheet}
      surfaceProps={CANVAS_COMPANION_PROPS}
      onCommit={(property) => trackCanvasObjectPropertyChanged({ objectKind: target.kind, property })}
    />
  );
}
