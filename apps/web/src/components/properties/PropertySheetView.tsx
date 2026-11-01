import { useId, useRef, useSyncExternalStore } from 'react';
import {
  Copy,
  FileDown,
  Image,
  Origami,
  Play,
  SquareDashed,
  Trash2,
  Type,
  type LucideIcon,
} from 'lucide-react';
import {
  visiblePropertyFields,
  type ColorField,
  type ControlVerb,
  type NumberField,
  type PropertyField,
  type PropertyNotice,
  type PropertySection,
  type PropertySheet,
  type PropertySheetAction,
  type SegmentedField,
  type SliderField,
  type StepperField,
} from '../../lib/propertyDescriptors';
import { Button } from '../ui/Button';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import { IconButton } from '../ui/IconButton';
import { Notice } from '../ui/Notice';
import { Pager } from '../ui/Pager';
import { SegmentedControl } from '../ui/SegmentedControl';
import {
  ColorRow,
  FieldRow,
  NumberRow,
  SegmentedRow,
  SelectRow,
  SliderRow,
  StackedRow,
  TextRow,
  ToggleRow,
} from '../ui/fieldRows';
import styles from './PropertySheetView.module.css';

/**
 * Attributes a host puts on the sheet's own DOM and on every menu the sheet
 * opens outside it (a select's portalled list), so a press on either counts
 * as a press on the host's surface. `data-*` only: the host is marking the
 * surface, not styling or wiring it.
 */
export type PropertySurfaceProps = Record<`data-${string}`, string>;

/**
 * The names a catalog may put in `sheet.icon`. The catalog is JSX-free, so the
 * resolution to a glyph lives here; an unknown name draws nothing.
 */
const SHEET_ICONS: Record<string, LucideIcon> = {
  image: Image,
  text: Type,
  region: SquareDashed,
  'folded-figure': Origami,
  'inline-simulation': Play,
};

/**
 * The names a catalog may put in an action's `icon`: the glyphs the object's
 * toolbar draws for the same verbs (`foldedFigureActionIcons`), and the
 * Diagram's Step pane for its step's.
 */
const ACTION_ICONS: Record<string, LucideIcon> = {
  export: FileDown,
  duplicate: Copy,
  delete: Trash2,
};

/**
 * One {@link PropertySheet}, rendered.
 *
 * The renderer knows the eight field kinds and the four commit protocols and
 * nothing else — not which object the sheet describes, nor where its values
 * live. Every decision that could differ per kind is data on the field:
 * `support` hides (`not-applicable`) or disables with `reason` (`unsupported`),
 * `reset` is the row's trailing affordance — on a toggle, an "Overridden" note
 * and a switch back to `inherited` — and the protocol says how the row
 * commits. That is what lets a catalog be tested with identity `t` and
 * `vi.fn` deps, and what keeps a new object kind from needing a new form.
 *
 * `onCommit(fieldId)` fires once per recorded change — inside the discrete
 * commit, the draft commit, the continuous `end`, the reset and a stepper's
 * press — never per input event, so a host can count property edits without
 * seeing values. `onAction(actionId)` fires once per press of a header verb.
 *
 * The parts only some kinds use — header `actions`, a warning subtitle, a
 * `stacked` segmented field, a stepper, a `note`, a `spaced` section, a
 * section's `notice` — draw nothing for a kind that leaves them out, which
 * renders as it always has.
 */
export function PropertySheetView({
  sheet,
  surfaceProps,
  onCommit,
  onAction,
}: {
  sheet: PropertySheet;
  surfaceProps?: PropertySurfaceProps;
  onCommit?: (fieldId: string) => void;
  onAction?: (actionId: string) => void;
}) {
  const Icon = sheet.icon ? SHEET_ICONS[sheet.icon] : undefined;
  const actions = sheet.actions ?? [];
  return (
    <div className={styles.sheet} data-property-sheet="" {...surfaceProps}>
      <header className={styles.header} data-actions={actions.length > 0 || undefined}>
        {Icon && (
          <span className={styles.icon}>
            <Icon size={14} aria-hidden />
          </span>
        )}
        <div className={styles.titles}>
          <h2 className={styles.title}>{sheet.title}</h2>
          {sheet.subtitle && (
            <span className={styles.subtitle} data-property-sheet-subtitle="" data-tone={sheet.subtitleTone}>
              {sheet.subtitle}
            </span>
          )}
        </div>
        {actions.length > 0 && (
          <div className={styles.actions}>
            {actions.map((action) => (
              <ActionButton key={action.id} action={action} onAction={onAction} />
            ))}
          </div>
        )}
      </header>
      {sheet.sections.map((section) => (
        <SectionView
          key={section.id}
          section={section}
          surfaceProps={surfaceProps}
          onCommit={onCommit}
        />
      ))}
    </div>
  );
}

function SectionView({
  section,
  surfaceProps,
  onCommit,
}: {
  section: PropertySection;
  surfaceProps?: PropertySurfaceProps;
  onCommit?: (fieldId: string) => void;
}) {
  const fields = visiblePropertyFields(section);
  if (fields.length === 0) return null;
  const fieldRows = fields.map((field) => (
    <FieldView key={field.id} field={field} surfaceProps={surfaceProps} onCommit={onCommit} />
  ));
  const notice = section.notice ? <SectionNoticeView notice={section.notice} /> : null;
  const rows = section.spaced ? (
    <div className={styles.spaced}>
      {fieldRows}
      {notice}
    </div>
  ) : (
    <>
      {fieldRows}
      {notice}
    </>
  );
  // An untitled section is the sheet's plain body: rows with no header to
  // fold behind, the shape a one-section sheet wants.
  if (section.title === undefined) {
    return (
      <div className={styles.section} data-property-sheet-section="">
        {section.description && <p className="collapsible-section__hint">{section.description}</p>}
        {rows}
      </div>
    );
  }
  return (
    <CollapsibleSection
      title={section.title}
      description={section.description}
      collapsible={section.collapsible}
      defaultOpen={section.defaultOpen ?? true}
    >
      {rows}
    </CollapsibleSection>
  );
}

function FieldView({
  field,
  surfaceProps,
  onCommit,
}: {
  field: PropertyField;
  surfaceProps?: PropertySurfaceProps;
  onCommit?: (fieldId: string) => void;
}) {
  const disabled = field.support === 'unsupported';
  const title = disabled ? field.reason : undefined;
  const committed = () => onCommit?.(field.id);
  const reset = field.reset
    ? () => {
        field.reset?.();
        committed();
      }
    : undefined;

  switch (field.kind) {
    case 'toggle':
      return (
        <ToggleRow
          label={field.label}
          checked={field.value}
          inherited={field.inherited}
          disabled={disabled}
          title={title}
          onChange={(next) => {
            field.commit(next);
            committed();
          }}
          onReset={reset}
        />
      );
    case 'select':
      return (
        <SelectRow
          label={field.label}
          value={field.value}
          options={field.options}
          placeholder={field.placeholder}
          disabled={disabled}
          title={title}
          onChange={(next) => {
            if (next === field.value) return;
            field.commit(next);
            committed();
          }}
          onReset={reset}
          contentProps={surfaceProps}
        />
      );
    case 'segmented':
      if (field.layout === 'stacked') {
        return (
          <StackedSegmentedFieldView
            field={field}
            disabled={disabled}
            title={title}
            onCommit={committed}
          />
        );
      }
      return (
        <SegmentedRow
          label={field.label}
          value={field.value}
          options={field.options}
          disabled={disabled}
          title={title}
          onChange={(next) => {
            if (next === field.value) return;
            field.commit(next);
            committed();
          }}
          onReset={reset}
        />
      );
    case 'number':
      return (
        <NumberFieldView
          field={field}
          disabled={disabled}
          title={title}
          onCommit={committed}
          onReset={reset}
        />
      );
    case 'text':
      return (
        <TextRow
          label={field.label}
          value={field.value}
          placeholder={field.placeholder}
          disabled={disabled}
          title={title}
          onCommit={(next) => {
            field.commit(next);
            committed();
          }}
          onReset={reset}
        />
      );
    case 'slider':
      return (
        <SliderFieldView
          field={field}
          disabled={disabled}
          title={title}
          onCommit={committed}
          onReset={reset}
        />
      );
    case 'color':
      return (
        <ColorFieldView
          field={field}
          disabled={disabled}
          title={title}
          onCommit={committed}
          onReset={reset}
        />
      );
    case 'stepper':
      return (
        <StepperFieldView field={field} disabled={disabled} title={title} onCommit={committed} />
      );
  }
}

/**
 * A section's notice, after its rows and inset as the Diagram's Picture
 * section insets its own: the sentence, and the fixes it offers as buttons
 * under it.
 */
function SectionNoticeView({ notice }: { notice: PropertyNotice }) {
  return (
    <div className={styles.notice}>
      <Notice
        tone={notice.tone}
        actions={(notice.actions ?? []).map((action) => ({
          id: action.id,
          label: action.label,
          disabled: action.disabled,
          run: action.run,
        }))}
      >
        {notice.text}
      </Notice>
    </div>
  );
}

/**
 * One of the object's verbs, in the header as the Step pane has its step's:
 * a small icon button named by its label, disabled with its hint.
 */
function ActionButton({
  action,
  onAction,
}: {
  action: PropertySheetAction;
  onAction?: (actionId: string) => void;
}) {
  const Icon = ACTION_ICONS[action.icon];
  return (
    <IconButton
      size="sm"
      aria-label={action.label}
      title={action.disabled && action.hint ? action.hint : action.label}
      disabled={action.disabled}
      onClick={() => {
        action.run();
        onAction?.(action.id);
      }}
    >
      {Icon && <Icon size={15} />}
    </IconButton>
  );
}

/**
 * A segmented field laid out `stacked`: the label over the control, the
 * control across the row (the Step pane's Show as). The visible label names
 * the group, so it is announced once.
 */
function StackedSegmentedFieldView({
  field,
  disabled,
  title,
  onCommit,
}: {
  field: SegmentedField;
  disabled: boolean;
  title?: string;
  onCommit: () => void;
}) {
  const labelId = useId();
  return (
    <StackedRow label={field.label} labelId={labelId} disabled={disabled} title={title}>
      <SegmentedControl
        size="sm"
        fill
        aria-labelledby={labelId}
        value={field.value}
        disabled={disabled}
        options={field.options.map((option) => ({ value: option.id, label: option.label }))}
        onChange={(next) => {
          if (next === field.value) return;
          field.commit(next);
          onCommit();
        }}
      />
    </StackedRow>
  );
}

/**
 * ‹ where it stands ›, in a row with its label and its note, and the row's
 * button after it when it has one. A refused verb — the descriptor's, or every
 * one on an unsupported field, with its reason — keeps its place and its focus
 * and does nothing. A step that runs is one commit; the button opens what it
 * opens and commits nothing.
 */
function StepperFieldView({
  field,
  disabled,
  title,
  onCommit,
}: {
  field: StepperField;
  disabled: boolean;
  title?: string;
  onCommit: () => void;
}) {
  const refusable = (verb: ControlVerb, after?: () => void): ControlVerb => {
    const refused = disabled || verb.disabled;
    return {
      label: verb.label,
      disabled: refused,
      hint: disabled ? (field.reason ?? verb.hint) : verb.hint,
      run: () => {
        if (refused) return;
        verb.run();
        after?.();
      },
    };
  };
  const step = (verb: ControlVerb | undefined) => (verb ? refusable(verb, onCommit) : undefined);
  // Named by the row's label, so "Layer order" is said once.
  const labelId = useId();
  const pager = (
    <Pager labelledBy={labelId} previous={step(field.previous)} next={step(field.next)}>
      {field.readout}
    </Pager>
  );
  const action = field.action ? refusable(field.action) : undefined;
  return (
    <FieldRow
      label={field.label}
      labelId={labelId}
      kind="text"
      disabled={disabled}
      title={title}
      note={field.note?.text}
      noteKind={field.note?.kind}
    >
      {action ? (
        <span className={styles.stepper}>
          {pager}
          <Button
            size="sm"
            variant="secondary"
            title={action.disabled ? action.hint : undefined}
            aria-disabled={action.disabled || undefined}
            onClick={action.run}
          >
            {action.label}
          </Button>
        </span>
      ) : (
        pager
      )}
    </FieldRow>
  );
}

/**
 * A number row that shows a live value while one moves (an orbit mid-drag) and
 * the committed value otherwise. Subscribed here so only this row re-renders
 * for it.
 */
function NumberFieldView({
  field,
  disabled,
  title,
  onCommit,
  onReset,
}: {
  field: NumberField;
  disabled: boolean;
  title?: string;
  onCommit: () => void;
  onReset?: () => void;
}) {
  const live = field.live;
  const liveValue = useSyncExternalStore<number | undefined>(
    live?.subscribe ?? subscribeNothing,
    live?.read ?? readNothing
  );
  return (
    <NumberRow
      label={field.label}
      value={liveValue ?? field.value}
      min={field.min}
      max={field.max}
      step={field.step}
      suffix={field.suffix}
      disabled={disabled}
      title={title}
      normalize={field.normalize}
      onCommit={(next) => {
        field.commit(next);
        onCommit();
      }}
      onReset={onReset}
    />
  );
}

function subscribeNothing(): () => void {
  return () => {};
}

function readNothing(): undefined {
  return undefined;
}

/**
 * The continuous protocol on a slider: `GestureSlider` opens the gesture on
 * the first `input` and closes it on the native `change`, and a refused
 * `begin` leaves the thumb where the value is. `held` disables the row while
 * another surface has the layer.
 */
function SliderFieldView({
  field,
  disabled,
  title,
  onCommit,
  onReset,
}: {
  field: SliderField;
  disabled: boolean;
  title?: string;
  onCommit: () => void;
  onReset?: () => void;
}) {
  return (
    <SliderRow
      label={field.label}
      value={field.value}
      min={field.min}
      max={field.max}
      step={field.step}
      disabled={disabled || field.held}
      title={title}
      format={field.format}
      onChange={field.update}
      onGestureStart={field.begin}
      onGestureCommit={() => {
        field.end();
        onCommit();
      }}
      commitLabel={field.undoLabel ?? ''}
      onReset={onReset}
    />
  );
}

/**
 * The continuous protocol on a colour swatch: the native picker fires `change`
 * per pointer move while open, so the first one opens the gesture and the
 * blur that closes the picker ends it. The latch is a ref rather than the
 * bracket's own state because a `begin` refused for the whole pick must not
 * be retried on every move of that same pick.
 */
function ColorFieldView({
  field,
  disabled,
  title,
  onCommit,
  onReset,
}: {
  field: ColorField;
  disabled: boolean;
  title?: string;
  onCommit: () => void;
  onReset?: () => void;
}) {
  const pick = useRef<'idle' | 'open' | 'refused'>('idle');
  return (
    <ColorRow
      label={field.label}
      value={field.value}
      disabled={disabled || field.held}
      clearDisabled={(disabled && !field.resetWhileUnsupported) || field.held}
      title={title}
      onChange={(next) => {
        if (pick.current === 'refused') return;
        if (pick.current === 'idle') {
          if (!field.begin()) {
            pick.current = 'refused';
            return;
          }
          pick.current = 'open';
        }
        field.update(next);
      }}
      onCommit={() => {
        const state = pick.current;
        pick.current = 'idle';
        if (state !== 'open') return;
        field.end();
        onCommit();
      }}
      onClear={onReset}
    />
  );
}
