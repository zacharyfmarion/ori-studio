import { useMemo, useRef } from 'react';
import { ANALYTICS_EVENTS, track } from '../analytics';
import {
  applyCreaseStyle,
  creaseStyleOf,
  DEFAULT_PAPER_STYLE,
  getPaperStyleField,
  paperStyleValueEquals,
  withPaperStyleOverride,
  type Hex,
  type PaperStyle,
  type PaperStyleField,
  type PaperStyleOverrides,
  type PaperStyleValue,
} from '../lib/paper/paperStyle';
import { useSettingsStore } from '../store/settingsStore';

/** The pens the simulator's rows edit the colour of. */
export type SimulatorPenField = 'mountainFolds' | 'valleyFolds' | 'edges';

/**
 * The fields the Simulate pane's Paper and Creases rows edit, and so the ones
 * its reset touches. The simulator policy applies more — the aux pen, its
 * toggle and erode joined it in Phase 5 — but those rows are Settings ▸
 * Paper's; a reset here leaves them where the user put them. So are the
 * pens' widths, dashes and caps: the pane edits a pen's colour only.
 */
export const SIMULATOR_PANE_FIELDS: readonly PaperStyleField[] = [
  'paper.front',
  'paper.back',
  'edges',
  'mountainFolds',
  'valleyFolds',
  'foldsAsEdges',
  'light',
];

export interface SimulatorPaperStyleBinding {
  /** The app's display style — what the Simulate workspace and every window draw with. */
  style: PaperStyle;
  setPaperColor: (side: 'paper.front' | 'paper.back', color: Hex) => void;
  setPenColor: (pen: SimulatorPenField, color: Hex) => void;
  /**
   * Draw every fold in the edge pen's colour, dash and cap, at the average of
   * the fold pens' widths — or by direction again.
   */
  setFoldsAsEdges: (on: boolean) => void;
  setLighting: (enabled: boolean) => void;
  /**
   * The end of one continuous adjustment — a colour picker closing. A control
   * that fires per pointer move calls its setter per move and this once;
   * nothing is written, it only settles the analytics count.
   */
  endAdjustment: () => void;
  /**
   * The rows this binding offers — {@link SIMULATOR_PANE_FIELDS} — back to
   * the Default preset, as one store update. The rest of the display style —
   * the aux and arrow pens, erode, every pen's width — is Settings ▸ Paper's
   * and stays where the user put it; see {@link resetRowValue} for the rows
   * that edit one property of a field.
   */
  reset: () => void;
}

/**
 * A row's value under the Default preset. A pen's row edits its colour and
 * the light row its switch, so each resets that property and keeps the rest:
 * the pens' widths, dashes and caps and the light's angles are Settings ▸
 * Paper's — since X14 a simulation draws every line at its own pen's width,
 * set there and nowhere in the pane.
 */
function resetRowValue<F extends PaperStyleField>(style: PaperStyle, field: F): PaperStyleValue<F> {
  switch (field) {
    case 'edges':
    case 'mountainFolds':
    case 'valleyFolds': {
      const pen = field as SimulatorPenField;
      return { ...style[pen], color: DEFAULT_PAPER_STYLE[pen].color } as PaperStyleValue<F>;
    }
    case 'light':
      return { ...style.light, enabled: DEFAULT_PAPER_STYLE.light.enabled } as PaperStyleValue<F>;
    default:
      return getPaperStyleField(DEFAULT_PAPER_STYLE, field);
  }
}

/**
 * The simulator's rows of the app-wide paper style, bound to the settings
 * store — the Simulate pane's Paper and Creases sections and the inline
 * window's sheet share it, which is the point: one value, two places to reach
 * it, never two values. Preferences, not document edits: nothing here opens a
 * bracket or records undo.
 *
 * Each field an edit touches is counted once per adjustment (`paper style
 * changed`), never per pointer move: a continuous control's setter counts the
 * first write of a run and stays quiet until
 * {@link SimulatorPaperStyleBinding.endAdjustment} settles it.
 */
export function useSimulatorPaperStyle(): SimulatorPaperStyleBinding {
  const style = useSettingsStore((state) => state.paperStyle.display);
  const setField = useSettingsStore((state) => state.setPaperStyleField);
  const setFields = useSettingsStore((state) => state.setPaperStyleFields);
  // The fields counted in the adjustment under way; a ref so a per-move write
  // re-renders nothing.
  const adjusting = useRef(new Set<PaperStyleField>());
  return useMemo(() => {
    const changed = (field: PaperStyleField) =>
      track(ANALYTICS_EVENTS.paperStyleChanged, { slot: 'display', field });
    const endAdjustment = () => {
      adjusting.current.clear();
    };
    /** A continuous control's write: counted on the first of a run. */
    const count = (field: PaperStyleField) => {
      if (adjusting.current.has(field)) return;
      adjusting.current.add(field);
      changed(field);
    };
    /** A discrete control's write: counted every time, and it ends any run. */
    const once = (field: PaperStyleField) => {
      endAdjustment();
      changed(field);
    };
    return {
      style,
      setPaperColor: (side, color) => {
        count(side);
        setField('display', side, color);
      },
      setPenColor: (pen, color) => {
        count(pen);
        setField('display', pen, { ...style[pen], color });
        // Under a mono style the fold pens *are* the edge ink: a new edge
        // colour re-applies the mode so they keep following it, rather than
        // staying on the old ink and reading as custom.
        const mode = pen === 'edges' ? creaseStyleOf(style) : 'custom';
        if (mode !== 'mono' && mode !== 'mono-dashed') return;
        const next = applyCreaseStyle({ ...style, edges: { ...style.edges, color } }, mode);
        count('mountainFolds');
        count('valleyFolds');
        setField('display', 'mountainFolds', next.mountainFolds);
        setField('display', 'valleyFolds', next.valleyFolds);
      },
      setFoldsAsEdges: (on) => {
        once('foldsAsEdges');
        setField('display', 'foldsAsEdges', on);
      },
      setLighting: (enabled) => {
        once('light');
        setField('display', 'light', { ...style.light, enabled });
      },
      endAdjustment,
      reset: () => {
        endAdjustment();
        // Only the rows that differ are counted and written, and all of them
        // in one update: a reset is one edit, not one per row.
        let fields: PaperStyleOverrides | undefined;
        for (const field of SIMULATOR_PANE_FIELDS) {
          const value = resetRowValue(style, field);
          if (paperStyleValueEquals(getPaperStyleField(style, field), value)) continue;
          changed(field);
          fields = withPaperStyleOverride(fields, field, value);
        }
        if (fields) setFields('display', fields);
      },
    };
  }, [style, setField, setFields]);
}
