import { useCallback, useState, type RefObject } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import type { DiagramAsset, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import { snapRadiusUnits, type SnapContext } from './annotateSnap';
import type { SnapTarget } from './pictureSnap';

const NO_TARGETS: readonly SnapTarget[] = [];

function sameTargets(a: readonly SnapTarget[], b: readonly SnapTarget[]): boolean {
  return (
    a.length === b.length &&
    a.every((target, index) => {
      const other = b[index]!;
      return target.kind === other.kind && target.at[0] === other.at[0] && target.at[1] === other.at[1];
    })
  );
}

/**
 * The Annotate canvas's snapping (decisions 9 and 10): Edit's snap radius at
 * the zoom a press is made at, the Step pane's switch, and the targets shown
 * over the marks — where a press would land as the pointer hovers, and where
 * the ends in hand have landed during a drag.
 *
 * The targets are the canvas's state, never the drawing's: showing one
 * re-renders the canvas, not the marks (`DiagramAnnotationLayer`), and only
 * when what is shown changes.
 */
export function useAnnotateSnap({
  step,
  assets,
  style,
  overlay,
  unit,
}: {
  step: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
  style: DiagramStyle;
  overlay: RefObject<SVGSVGElement | null>;
  /** World px per picture unit; null before the picture is laid out. */
  unit: number | null;
}) {
  const enabled = useSettingsStore((state) => state.diagramAnnotateSnap);
  const setting = useSettingsStore((state) => state.cpSnapRadius);
  const [targets, setTargets] = useState<readonly SnapTarget[]>(NO_TARGETS);

  /** What a press snaps against now, its radius at the zoom the canvas is at. */
  const context = useCallback((): SnapContext => {
    const screenPerWorld = overlay.current?.getScreenCTM()?.a ?? 0;
    return {
      step,
      assets,
      annotations: step.annotations,
      enabled,
      radius: unit === null ? 0 : snapRadiusUnits(setting, screenPerWorld * unit),
      style,
    };
  }, [step, assets, style, enabled, setting, overlay, unit]);

  /** Show these targets — none to clear them — re-rendering only for a change. */
  const show = useCallback((next: readonly (SnapTarget | null)[]) => {
    const shown = next.filter((target): target is SnapTarget => target !== null);
    setTargets((current) => (sameTargets(current, shown) ? current : shown.length === 0 ? NO_TARGETS : shown));
  }, []);

  return { enabled, context, targets, show };
}
