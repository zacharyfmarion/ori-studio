/**
 * The descriptor language a properties sheet is written in.
 *
 * A kind's catalog (`build<Kind>Properties(target, deps)`) returns one
 * {@link PropertySheet}: plain data, no React, no store — the discipline
 * `cp-workspace/folded/foldedFigureActions.ts` set for verbs, applied to
 * fields. One generic renderer maps each field's `kind` to a shared row by
 * exhaustive switch, so a catalog is testable with an identity `t` and
 * `vi.fn` deps, and a new object kind adds a catalog rather than a form.
 *
 * Nothing here knows about the crease pattern, so a later Design-side
 * inspector can reuse the field and protocol types unchanged.
 *
 * Fields hold *properties* — things with a value — in eight kinds, and a
 * property that cannot be expressed as one of them is a sign it is not a
 * property. Verbs on the object as a whole (Export…, Duplicate, Delete) may
 * also sit in the sheet's header, as `actions`, so a pane can read like the
 * Diagram's Step pane, whose header carries its step's verbs (Zach,
 * 2026-10-25: "id like it to look the same way that the diagram sidebar
 * looks"). They are the object's catalog verbs, the same ones its toolbar and
 * menu run, never new ones; and the one field kind that is pressed rather
 * than set, the stepper, steps a value — which layer order shows — rather
 * than standing in for a verb. Every one of these parts is optional: a kind
 * that uses none renders as it always has. Every verb, wherever it sits, is a
 * {@link ControlVerb}.
 */

import type { ControlVerb } from './controlVerb';

export type { ControlVerb };

/** The answer `foldedFigureAppearance.ts` gives, generalised: hide 'not-applicable', disable 'unsupported' with a reason. */
export type PropertySupport = 'supported' | 'unsupported' | 'not-applicable';

/**
 * A value that moves outside React — an orbit camera mid-drag, a fold
 * percentage. The row subscribes to it and re-renders alone; the sheet, and
 * the document-derived memos behind it, do not.
 */
export interface LiveValue<T> {
  read(): T;
  subscribe(listener: () => void): () => void;
}

interface FieldBase {
  /** Stable per kind ('opacity', 'frontColor', …). Doubles as the analytics `property` enum. */
  id: string;
  /** Already translated: the catalog calls `t('panels:cpProperties.<kind>.<id>', 'English')` literally. */
  label: string;
  support: PropertySupport;
  /** Translated; the row's title while 'unsupported'. */
  reason?: string;
  /** Translated history label. Absent for non-document fields (an app-wide preference). */
  undoLabel?: string;
  /**
   * Put the property back to its default, when a default exists — a camera row
   * back to the fold's view. `ColorField.onClear`'s affordance generalised: a
   * reset is still a property edit, not a verb, and it records `undoLabel`
   * like any other commit.
   */
  reset?: () => void;
}

/**
 * Four commit protocols. Which one a field uses is data, so the renderer never
 * guesses how a control commits.
 */
export interface DiscreteCommit<T> {
  /** Toggles, selects, segmented controls: one commit per interaction. */
  protocol: 'discrete';
  value: T;
  commit(next: T): void;
}

export interface DraftCommit<T> {
  /** Typed fields: commit on blur, Enter or a step; the row skips a no-op commit. */
  protocol: 'draft';
  value: T;
  commit(next: T): void;
}

export interface ContinuousCommit<T> {
  /** Sliders and colour pickers: many updates, one recorded gesture. */
  protocol: 'continuous';
  value: T;
  /**
   * Opens the layer's undo bracket; false when another owner holds it (the row
   * then resyncs and does nothing). Called once per gesture by the row.
   */
  begin(): boolean;
  /** Per pointer move; writes the store, records nothing. A no-op once the bracket was aborted underneath it. */
  update(next: T): void;
  /** Closes the bracket once and records `undoLabel` once. */
  end(): void;
  /** True while another surface holds this layer's bracket — the row renders disabled. */
  held: boolean;
}

export interface PropertyOption {
  id: string;
  label: string;
}

export type ToggleField = FieldBase & {
  kind: 'toggle';
  /**
   * The value the row shows once `reset` has cleared it — what it follows
   * while nothing is pinned. A toggle offers no reset button (`FieldRow`), so
   * while `reset` is offered, switching to this value runs `reset` rather than
   * pinning a value that merely agrees with it.
   */
  inherited?: boolean;
} & DiscreteCommit<boolean>;
/** `value: null` is the mixed state — nothing chosen, the placeholder shown. */
export type SelectField = FieldBase & {
  kind: 'select';
  options: readonly PropertyOption[];
  placeholder?: string;
} & DiscreteCommit<string | null>;
export type SegmentedField = FieldBase & {
  kind: 'segmented';
  options: readonly PropertyOption[];
  /**
   * `stacked` puts the label over the control and the control across the
   * row, as the Step pane's Show as is: for choices too wide to sit beside
   * their label in a narrow pane. Beside it otherwise.
   */
  layout?: 'beside' | 'stacked';
} & DiscreteCommit<string | null>;
export type NumberField = FieldBase & {
  kind: 'number';
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  normalize?: (value: number) => number;
  /** The row shows this while it moves (an orbit mid-drag) and `value` otherwise. */
  live?: LiveValue<number>;
} & DraftCommit<number>;
export type TextField = FieldBase & { kind: 'text'; placeholder?: string } & DraftCommit<string>;
export type SliderField = FieldBase & {
  kind: 'slider';
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
} & ContinuousCommit<number>;
/** `value` is `#rrggbb`. */
export type ColorField = FieldBase & {
  kind: 'color';
  /**
   * Keep `reset` live while the row is 'unsupported'. An unsupported row's
   * reset is disabled with it, which is right while the whole pin is inert;
   * this is for a colour that is moot here but pinned as part of a pen whose
   * other parts still draw — a fold pen while every fold is drawn as an edge,
   * whose width still sets how heavy those folds are.
   */
  resetWhileUnsupported?: boolean;
} & ContinuousCommit<string>;

/**
 * A short line under a row's label, read with it (`FieldRow.note`).
 *
 * - `reason`: why the row cannot be used now ("Layer order couldn’t be
 *   determined for this figure."). It keeps the label's ink and wraps, since
 *   it is there to be read.
 * - `status`: a quiet fact about the value ("3 constraints"): one line, in
 *   tertiary ink, cut short rather than wrapped.
 */
export interface FieldNote {
  kind: 'reason' | 'status';
  /** Translated. */
  text: string;
}

export interface SteppedCommit {
  /**
   * A stepper: each press of ‹ or › is one commit, under that verb's own undo
   * label. A refused verb (`disabled`) keeps its place and the focus a press
   * gave it, and a press does nothing.
   */
  protocol: 'stepped';
  /** Where it stands, read out between the two ("2 of 5+"), and announced as it changes. */
  readout: string;
  /** Back to the one before; its place stays empty when absent. */
  previous?: ControlVerb;
  /** On to the next; its place stays empty when absent. */
  next?: ControlVerb;
  /** A button after the pager, for what the row opens ("Edit…", the Layer order dialog). */
  action?: ControlVerb;
}

/**
 * A value stepped through one at a time, ‹ where it stands › — a folded
 * figure's layer orders, as the Diagram's pager steps a flat fold's. On an
 * 'unsupported' field every verb is refused, with `reason` as its hint.
 */
export type StepperField = FieldBase & { kind: 'stepper'; note?: FieldNote } & SteppedCommit;

export type PropertyField =
  | ToggleField
  | SelectField
  | SegmentedField
  | NumberField
  | TextField
  | SliderField
  | ColorField
  | StepperField;

export type PropertyFieldKind = PropertyField['kind'];

/**
 * A sentence a section needs read, after its rows (`components/ui/Notice`):
 * what is wrong with what the rows show, and the fix it offers — a folded
 * figure's layer constraints that need attention, with Review…, as the
 * Diagram's Picture section has a step's. It says nothing a row's note
 * already does.
 */
export interface PropertyNotice {
  tone: 'info' | 'warning';
  /** Translated. */
  text: string;
  /** Buttons under the sentence; `id` is stable among them. */
  actions?: readonly (ControlVerb & { id: string })[];
}

export interface PropertySection {
  id: string;
  title?: string;
  /** e.g. "Shared with the Simulate workspace". */
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /**
   * Rows a little apart rather than ruled edge to edge, as the Diagram Step
   * pane's Pose section has them.
   */
  spaced?: boolean;
  fields: readonly PropertyField[];
  /** After the rows, while there is something to say. */
  notice?: PropertyNotice;
}

/**
 * A verb on the object itself, in the sheet's header — Export…, Duplicate,
 * Delete — taken from the object's own catalog, as its toolbar and menu take
 * them (a catalog's command can be handed over as it is).
 */
export interface PropertySheetAction extends ControlVerb {
  /** Stable per kind ('export', 'duplicate', …). Doubles as the analytics `action` enum. */
  id: string;
  /** An icon name, resolved by the renderer. */
  icon: string;
}

export interface PropertySheet {
  /** The registry key; the analytics `object_kind` enum. */
  kind: string;
  targetId: string;
  title: string;
  /** Read-only context (an image's natural size, a figure's stale note) — the one place the sheet shows something it does not edit. */
  subtitle?: string;
  /** The subtitle drawn as a warning: a state that needs a look (a figure's layer constraints since an edit). */
  subtitleTone?: 'warning';
  /** An icon name, resolved by the renderer. */
  icon?: string;
  /** The object's verbs, at the header's end. */
  actions?: readonly PropertySheetAction[];
  sections: readonly PropertySection[];
}

/** Fields the renderer shows: everything but `not-applicable`. */
export function visiblePropertyFields(section: PropertySection): PropertyField[] {
  return section.fields.filter((field) => field.support !== 'not-applicable');
}

/** A sheet with no visible field anywhere has nothing to say; the renderer shows nothing. */
export function propertySheetIsEmpty(sheet: PropertySheet): boolean {
  return sheet.sections.every((section) => visiblePropertyFields(section).length === 0);
}
