import { useRef, useSyncExternalStore } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Image,
  Origami,
  Play,
  SquareDashed,
  Type,
  type LucideIcon,
} from 'lucide-react';
import {
  visiblePropertyFields,
  type ColorField,
  type NumberField,
  type PropertyField,
  type PropertySection,
  type PropertySheet,
  type SliderField,
} from '../../lib/propertyDescriptors';
import { CollapsibleSection } from '../ui/CollapsibleSection';
import {
  ColorRow,
  NumberRow,
  SegmentedRow,
  SelectRow,
  SliderRow,
  TextRow,
  ToggleRow,
} from '../ui/fieldRows';

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

/** The names a catalog may put on a segmented option's `icon`. */
const OPTION_ICONS: Record<string, LucideIcon> = {
  'align-left': AlignLeft,
  'align-center': AlignCenter,
  'align-right': AlignRight,
};

function optionIcon(name: string | undefined) {
  const Icon = name ? OPTION_ICONS[name] : undefined;
  return Icon ? <Icon size={14} aria-hidden /> : undefined;
}

/**
 * One {@link PropertySheet}, rendered.
 *
 * The renderer knows the seven field kinds and the three commit protocols and
 * nothing else — not which object the sheet describes, nor where its values
 * live. Every decision that could differ per kind is data on the field:
 * `support` hides (`not-applicable`) or disables with `reason` (`unsupported`),
 * `reset` is the row's trailing affordance, and the protocol says how the row
 * commits. That is what lets a catalog be tested with identity `t` and
 * `vi.fn` deps, and what keeps a new object kind from needing a new form.
 *
 * `onCommit(fieldId)` fires once per recorded change — inside the discrete
 * commit, the draft commit, the continuous `end` and the reset — never per
 * input event, so a host can count property edits without seeing values.
 */
export function PropertySheetView({
  sheet,
  surfaceProps,
  onCommit,
}: {
  sheet: PropertySheet;
  surfaceProps?: PropertySurfaceProps;
  onCommit?: (fieldId: string) => void;
}) {
  const Icon = sheet.icon ? SHEET_ICONS[sheet.icon] : undefined;
  return (
    <div className="property-sheet" {...surfaceProps}>
      <header className="property-sheet__header">
        {Icon && (
          <span className="property-sheet__icon">
            <Icon size={14} aria-hidden />
          </span>
        )}
        <div className="property-sheet__titles">
          <h2 className="property-sheet__title">{sheet.title}</h2>
          {sheet.subtitle && <span className="property-sheet__subtitle">{sheet.subtitle}</span>}
        </div>
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
  const rows = fields.map((field) => (
    <FieldView key={field.id} field={field} surfaceProps={surfaceProps} onCommit={onCommit} />
  ));
  // An untitled section is the sheet's plain body: rows with no header to
  // fold behind, the shape a one-section sheet wants.
  if (section.title === undefined) {
    return (
      <div className="property-sheet__section">
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
      return (
        <SegmentedRow
          label={field.label}
          value={field.value}
          options={field.options.map((option) => {
            const icon = optionIcon(option.icon);
            return { id: option.id, label: option.label, icon, iconOnly: icon !== undefined };
          })}
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
  }
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
