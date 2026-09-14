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
 * Seven field kinds and no action kind: the sheet holds *properties* — things
 * with a value — and verbs (delete, duplicate, refold, stacking, Solve) keep
 * the toolbars, chips and menus that already own them. A property that cannot
 * be expressed as one of the seven is a sign it is not a property.
 */

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
 * Three commit protocols. Which one a field uses is data, so the renderer never
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
  /** An icon *name*, resolved to a node by the renderer; the catalog stays JSX-free. */
  icon?: string;
}

export type ToggleField = FieldBase & { kind: 'toggle' } & DiscreteCommit<boolean>;
/** `value: null` is the mixed state — nothing chosen, the placeholder shown. */
export type SelectField = FieldBase & {
  kind: 'select';
  options: readonly PropertyOption[];
  placeholder?: string;
} & DiscreteCommit<string | null>;
export type SegmentedField = FieldBase & {
  kind: 'segmented';
  options: readonly PropertyOption[];
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
export type ColorField = FieldBase & { kind: 'color' } & ContinuousCommit<string>;

export type PropertyField =
  | ToggleField
  | SelectField
  | SegmentedField
  | NumberField
  | TextField
  | SliderField
  | ColorField;

export type PropertyFieldKind = PropertyField['kind'];

export interface PropertySection {
  id: string;
  title?: string;
  /** e.g. "Shared with the Simulate workspace". */
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  fields: readonly PropertyField[];
}

export interface PropertySheet {
  /** The registry key; the analytics `object_kind` enum. */
  kind: string;
  targetId: string;
  title: string;
  /** Read-only context (an image's natural size, a figure's stale note) — the one place the sheet shows something it does not edit. */
  subtitle?: string;
  /** An icon name, resolved by the renderer. */
  icon?: string;
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
