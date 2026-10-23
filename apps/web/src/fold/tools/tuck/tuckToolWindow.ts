/**
 * The tuck tool's window (plan Phase 11, D14), as the plain descriptor the
 * one Fold window renderer draws (`components/fold/FoldToolWindow`), in the
 * reverse tool's shape (`tools/reverse/reverseToolWindow`).
 *
 * It locates the line as every fold does — the steps for the line mode and
 * the line-mode select — and then, previewing:
 *
 * - **the direction**, Valley or Mountain, as the plain fold's V / M
 *   control: a valley tuck goes under its target, a mountain tuck over it;
 * - **the moving side**, Swap, and **the flaps** to tuck, through the layer
 *   picker and the chips, as a fold's layers;
 * - **the target**: one of the layers the engine lists as taking the tuck,
 *   stepped through — never a free pick of any layer — with how many there
 *   are; the folded pane lights them, the one taken brightest;
 * - **the layer order**, when the tuck leaves several, a stepper;
 * - a refusal in the folder's words with the engine's fixes — another
 *   listed target among them — and Cancel and the tuck.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { FoldDirection } from '../../document/foldSequenceDocument';
import { foldToolLabel, foldTuckLabel } from '../foldToolCatalog';
import {
  layersSection,
  lineModeSelect,
  locateInstructions,
  queuedNote,
  settingsMeta,
  type FoldToolHost,
  type FoldToolInstructions,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../foldToolWindow';
import { foldRefusalNotice, sectionFlapNames } from '../refusalNotice';
import { choiceStepper, type FoldChoiceStepper } from '../reverse/reverseToolWindow';

const TUCK_DIRECTIONS: readonly FoldDirection[] = ['valley', 'mountain'];

/** What the tuck tool's window is drawn from, beside every tool's view. */
export interface FoldTuckWindowView {
  /** As the viewer sees it: a valley tuck goes under its target, a mountain tuck over it. */
  direction: FoldDirection;
  /** The engine has listed the layers: what takes the tuck is known. */
  known: boolean;
  /** How many layers are listed to tuck against, and the one taken. */
  targets: number;
  target: number;
  /** The listed layers' faces, in the order they are stepped through: what a fix's layer is numbered by. */
  faces: readonly number[];
  pinned?: readonly number[];
  /** How many orders the tuck leaves, when it leaves several (else 0), and the one taken. */
  orders: number;
  order: number;
}

/** The tuck's own controls: the layer it goes against and the order it lands in. */
export interface FoldTuckControls {
  /** "Tuck under: 2 of 3"; null while there is no choice of layer. */
  target: FoldChoiceStepper | null;
  order: FoldChoiceStepper | null;
  /** How many layers take the tuck here, in a line; null while unknown. */
  note: string | null;
  additional?: readonly { label: string; checked: boolean; disabled: boolean; toggle: () => void }[];
}

/**
 * Under or over, as the viewer sees it: the direction's. Never the engine's
 * placement, which is in the model frame — over, for a valley tuck on a
 * view turned over.
 */
function under(tuck: FoldTuckWindowView): boolean {
  return tuck.direction === 'valley';
}

function targetsNote(t: TFunction, tuck: FoldTuckWindowView): string | null {
  if (!tuck.known) return null;
  if (tuck.targets === 0) return t('tools:fold.tuck.noTargets', 'No layer here takes the tuck.');
  return under(tuck)
    ? t('tools:fold.tuck.targetsUnder', {
        count: tuck.targets,
        defaultValue_one: 'One layer here takes the tuck under it.',
        defaultValue_other: '{{count}} layers here take the tuck under them: the folded paper lights each.',
      })
    : t('tools:fold.tuck.targetsOver', {
        count: tuck.targets,
        defaultValue_one: 'One layer here takes the tuck over it.',
        defaultValue_other: '{{count}} layers here take the tuck over them: the folded paper lights each.',
      });
}

function tuckControls(t: TFunction, tuck: FoldTuckWindowView, verbs: FoldToolWindowVerbs, readOnly: boolean): FoldTuckControls {
  const targetLabel = under(tuck) ? t('tools:fold.tuck.under', 'Tuck under') : t('tools:fold.tuck.over', 'Tuck over');
  return {
    target: choiceStepper(t, targetLabel, tuck.target, tuck.targets, verbs.stepTuckTarget, readOnly),
    order: choiceStepper(t, t('tools:fold.reverse.order', 'Layer order'), tuck.order, tuck.orders, verbs.stepOrder, readOnly),
    note: targetsNote(t, tuck),
    additional: verbs.toggleTuckPinned ? tuck.faces.flatMap((face, index) => index === tuck.target ? [] : [{
      label: under(tuck)
        ? t('tools:fold.tuck.alsoUnder', 'Also tuck under layer {{number}}', { number: index + 1 })
        : t('tools:fold.tuck.alsoOver', 'Also tuck over layer {{number}}', { number: index + 1 }),
      checked: tuck.pinned?.includes(face) ?? false,
      disabled: readOnly || ((tuck.pinned?.length ?? 0) >= 64 && !tuck.pinned?.includes(face)),
      toggle: () => verbs.toggleTuckPinned?.(face),
    }]) : [],
  };
}

function previewInstructions(
  t: TFunction,
  action: string,
  host: FoldToolHost,
  view: FoldToolWindowView,
  tuck: FoldTuckWindowView
): FoldToolInstructions {
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items: [
      t('tools:fold.steps.pickFlapsToTuck', 'Pick which flaps tuck.'),
      // A layer to pick only when more than one takes the tuck.
      ...(tuck.targets > 1 ? [t('tools:fold.steps.pickTuckTarget', 'Pick the layer to tuck against.')] : []),
      host.coarse
        ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action })
        : t('tools:fold.steps.commit', 'Press Enter to fold.'),
    ],
    // Narrowing the flaps and stepping the target are both optional: the
    // window leads with the first and never marks it done.
    current: 0,
    notes: view.preview ? queuedNote(t, view.preview) : [],
  };
}

/** The tuck tool's window: locating its line, then previewing the tuck (see the module docs). */
export function tuckToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const { preview, tuck } = view;
  if (!preview || !tuck) {
    const title = foldToolLabel(t, 'tuck');
    // Once the line is in: the flaps that tuck and the layer they go against.
    const then = host.coarse
      ? t('tools:fold.steps.tuckFinishTouch', 'Pick the flaps and the layer to tuck against, then tap {{action}}.', { action: title })
      : t('tools:fold.steps.tuckFinish', 'Pick the flaps and the layer to tuck against, then press Enter.');
    return {
      phase: 'locate',
      title,
      meta: settingsMeta(t, 1),
      instructions: locateInstructions(t, view, title, host, then),
      lineMode: lineModeSelect(t, view, verbs),
      kind: null,
      movingSide: null,
      layers: null,
      refusal: null,
      divide: null,
      footer: null,
    };
  }
  const title = foldTuckLabel(t, tuck.direction);
  const controls = tuckControls(t, tuck, verbs, readOnly);
  const settings = 3 + (controls.target ? 1 : 0) + (controls.order ? 1 : 0);
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, settings),
    instructions: previewInstructions(t, title, host, view, tuck),
    lineMode: null,
    // The plain fold's V / M control, each a tuck in the words the Step pane uses.
    kind: {
      label: t('tools:fold.window.kind', 'Fold'),
      value: tuck.direction,
      options: TUCK_DIRECTIONS.map((value) => ({ value, label: foldTuckLabel(t, value) })),
      disabled: readOnly,
      set: (kind) => {
        if (kind === 'valley' || kind === 'mountain') verbs.setTuckDirection?.(kind);
      },
    },
    movingSide: {
      label: t('tools:fold.window.movingSide', 'Moving side'),
      swapLabel: t('tools:fold.window.swap', 'Swap'),
      shortcut: 'fold.swapSide',
      disabled: readOnly,
      swap: verbs.swapSide,
    },
    layers: preview.section || !preview.refused ? layersSection(t, preview, verbs, readOnly, host.coarse) : null,
    tuck: controls,
    refusal: preview.refused
      ? foldRefusalNotice(
          t,
          preview.refused,
          {
            kind: 'tuck',
            readOnly,
            ...sectionFlapNames(preview.section),
            tuck: {
              under: under(tuck),
              targetNumber: (face) => {
                const at = tuck.faces.indexOf(face);
                return at >= 0 ? at + 1 : null;
              },
            },
          },
          verbs
        )
      : null,
    divide: null,
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: title,
        shortcut: 'fold.commit',
        disabled: readOnly || preview.landing || preview.refused !== null,
        run: verbs.commit,
      },
    },
  };
}
