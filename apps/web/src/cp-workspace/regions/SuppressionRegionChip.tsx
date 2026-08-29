import { type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, EyeOff, ListChecks, SquareDashed } from 'lucide-react';
import { FloatingToolbar } from '../../components/ui/FloatingToolbar';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { resolveCpViewportCanvas } from '../cpViewportCanvas';
import { useCanvasObjectAnchor } from '../canvasObjects/useCanvasObjectAnchor';
import { AnnotationActions } from '../AnnotationActions';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';
import {
  CP_CHECK_CLASSES,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';

/**
 * The chip a check-suppression region wears: what it is, what it silences, and
 * **how many findings that is costing right now**.
 *
 * # Why it is always on screen
 *
 * Every other inspector in this app appears only while its object is selected,
 * and this one deliberately breaks that rule. A region *hides information*, and a
 * suppressor you cannot see until you click it is a footgun — the failure mode is
 * a user reading "no errors" off a document that is quietly not being checked.
 * The hidden count is the affordance that makes the filter honest, and it only
 * works if it is there to read. It is also why the region type forbids `hidden`:
 * the chip is the region's visible half.
 *
 * Selecting the region expands the same pill with the controls that change it —
 * the class list and the shared {@link AnnotationActions}. Collapsed, the pill is
 * a button that selects, so the chip is its own way in.
 *
 * # Why there is no Solve button here, ever
 *
 * This is what the rail tool creates: a plain box that suppresses checks, useful
 * for a library of CP fragments, a work-in-progress corner, or a reference
 * pattern that will never be folded. Solve belongs to the *detection* case only,
 * and `SolveRegionChip` composes it on top by passing `children` — a second
 * component rather than a conditional inside this one, because suppression and
 * solve share no invariant and merging them would put a state machine into a
 * component whose job is a label and four checkboxes.
 *
 * Anchored by {@link useCanvasObjectAnchor}, which subscribes to the camera here
 * rather than in the panel, so the chip stays glued to its box through a pan
 * while the (huge) panel does not re-render. {@link CpImageInspector} is the
 * template for the rest, `wheelTarget` included: without it a scroll over the
 * chip zooms the page instead of the pattern.
 */

/**
 * Presentation lives inline rather than in `theme.css`.
 *
 * Not a preference — this stage owns no stylesheet. These are theme tokens either
 * way, so the rules move to a `.cp-region-chip*` block unchanged whenever someone
 * touches `theme.css` next; the class names below are already in place for it.
 */
const SUMMARY_BASE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: 260,
  padding: '2px 4px',
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 11,
  lineHeight: 1.4,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const SUMMARY_BUTTON: CSSProperties = { ...SUMMARY_BASE, cursor: 'pointer' };

const LABEL_STYLE: CSSProperties = {
  color: 'var(--text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const CLASSES_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/**
 * The hidden count wears the theme's warning hue rather than muted text.
 *
 * `--status-warning` is written by the active theme preset, so it follows light
 * and dark; `--text-warning` is defined nowhere in this app and would silently
 * resolve to its fallback — the mistake `.cp-folded-figure-toolbar__notice`
 * records having made.
 */
const HIDDEN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  color: 'var(--status-warning)',
};

export interface SuppressionRegionChipProps {
  region: CpSuppressionRegion;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  /** Selected: the controls that change the region join the summary. */
  expanded: boolean;
  /** Findings this region alone is hiding. See `useCpRegions`. */
  hiddenCount: number;
  onSelect: () => void;
  onToggleCheckClass: (cpCheckClass: CpCheckClass) => void;
  onOpacity: (value: number) => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
  /**
   * Appended after everything else — the slot `SolveRegionChip` composes into.
   * Nothing else should use it; a second consumer means a third chip component.
   */
  children?: ReactNode;
}

export function SuppressionRegionChip({
  region,
  container,
  expanded,
  hiddenCount,
  onSelect,
  onToggleCheckClass,
  onOpacity,
  onGestureStart,
  onGestureCommit,
  onBringToFront,
  onSendToBack,
  onDelete,
  children,
}: SuppressionRegionChipProps) {
  const { t } = useTranslation();
  // Subscribed here, not in the panel: this pill re-renders per camera frame so
  // it tracks its box, while the panel does not.
  const anchorRect = useCanvasObjectAnchor(region, 'model', container);

  const label = region.label ?? t('panels:cpRegion.defaultLabel', 'Suppression region');
  const classList = region.suppress.map((cpCheckClass) => cpCheckClassLabel(t, cpCheckClass));
  const suppressionText =
    classList.length === 0
      ? t('panels:cpRegion.nothingSuppressed', 'All checks on')
      : t('panels:cpRegion.suppressing', 'Checks off: {{classes}}', {
          classes: classList.join(', '),
        });
  const hiddenText =
    hiddenCount > 0
      ? t('panels:cpRegion.hidden', {
          count: hiddenCount,
          defaultValue_one: '1 finding hidden',
          defaultValue_other: '{{count}} findings hidden',
        })
      : null;

  const summaryContent = (
    <>
      <SquareDashed size={12} aria-hidden="true" />
      <span className="cp-region-chip__label" style={LABEL_STYLE}>
        {label}
      </span>
      <span className="cp-region-chip__classes" style={CLASSES_STYLE}>
        {suppressionText}
      </span>
      {hiddenText !== null && (
        <span className="cp-region-chip__hidden" style={HIDDEN_STYLE}>
          <EyeOff size={11} aria-hidden="true" />
          {hiddenText}
        </span>
      )}
    </>
  );

  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-region-chip"
      ariaLabel={t('panels:cpRegion.controls', 'Check suppression region')}
    >
      {/*
        A button while collapsed and a plain span while expanded. Not a disabled
        button — the same argument `NoticeChip` makes: once the controls are on
        screen, re-selecting is not an action the chip still offers, and a dead
        button reads as one that is temporarily unavailable.
      */}
      {expanded ? (
        <span className="cp-region-chip__summary" style={SUMMARY_BASE} title={suppressionText}>
          {summaryContent}
        </span>
      ) : (
        <button
          type="button"
          className="cp-region-chip__summary"
          style={SUMMARY_BUTTON}
          title={suppressionText}
          onClick={onSelect}
        >
          {summaryContent}
        </button>
      )}
      {expanded && (
        <>
          <span className="floating-toolbar__separator" />
          <CheckClassMenu suppress={region.suppress} onToggle={onToggleCheckClass} />
          <AnnotationActions
            opacity={region.opacity}
            onOpacity={onOpacity}
            onGestureStart={onGestureStart}
            onGestureCommit={onGestureCommit}
            onBringToFront={onBringToFront}
            onSendToBack={onSendToBack}
            onDelete={onDelete}
          />
        </>
      )}
      {children}
    </FloatingToolbar>
  );
}

/**
 * The check classes, as a checkbox list naming the theorems.
 *
 * **A tick means suppressed**, which is the opposite polarity to the View panel's
 * rows — those sit under "Foldability issues" and read as *show*. Both are right
 * where they are: this menu is titled by what the region does, and a region's
 * whole content is the set it silences, so an inverted list here would make the
 * chip's summary and its own control disagree.
 *
 * The menu stays open across a select, as the viewport overflow menu does: these
 * arrive in runs — the detection preset is two of the four — and closing after
 * each would cost a reopening per class.
 */
function CheckClassMenu({
  suppress,
  onToggle,
}: {
  suppress: readonly CpCheckClass[];
  onToggle: (cpCheckClass: CpCheckClass) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={t('panels:cpRegion.checksMenu', 'Suppressed checks')}
        icon={<ListChecks size={14} />}
        isActive={suppress.length > 0}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          {CP_CHECK_CLASSES.map((cpCheckClass) => {
            const checked = suppress.includes(cpCheckClass);
            return (
              <DropdownMenu.CheckboxItem
                key={cpCheckClass}
                className="context-menu__item"
                checked={checked}
                onSelect={(event) => {
                  event.preventDefault();
                  onToggle(cpCheckClass);
                }}
              >
                <span className="context-menu__icon">{checked && <Check size={12} />}</span>
                <span className="context-menu__label">{cpCheckClassLabel(t, cpCheckClass)}</span>
              </DropdownMenu.CheckboxItem>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
