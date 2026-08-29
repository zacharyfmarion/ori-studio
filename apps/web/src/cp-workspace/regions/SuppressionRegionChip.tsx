import { type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, EyeOff, ListChecks, SquareDashed, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { CpRegionChipBar } from './CpRegionChipBar';
import { useCpRegionChipDrag } from './useCpRegionChipDrag';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';
import type { Vec2 } from '../annotations/annotationTransform';
import {
  CP_CHECK_CLASSES,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';

/**
 * The bar a check-suppression region wears: what it is, what it silences, and
 * **how many findings that is costing right now**.
 *
 * # Why it is always on screen, and why all of it is
 *
 * Every other inspector in this app appears only while its object is selected,
 * and this one deliberately breaks that rule. A region *hides information*, and a
 * suppressor you cannot see until you click it is a footgun — the failure mode is
 * a user reading "no errors" off a document that is quietly not being checked.
 * The hidden count is the affordance that makes the filter honest, and it only
 * works if it is there to read. It is also why the region type forbids `hidden`:
 * the chip is the region's visible half.
 *
 * The controls follow the same rule rather than waiting for a selection. There
 * is no collapsed state: the class list, the delete and (on `SolveRegionChip`)
 * Solve are on the bar whenever the region is. Splitting them out cost a click
 * to reach anything and, worse, made the visible half of a suppressor smaller
 * than the thing it was suppressing.
 *
 * # Why the bar spans the region
 *
 * It is a title bar, not a pill floating nearby — see {@link CpRegionChipBar}
 * and {@link regionChipPlacement}. That is not only cosmetic: the region's body
 * takes no pointer events, so that creases *inside* it stay editable, which
 * leaves this bar as the only thing that selects or moves the region. A handle
 * has to look attached to what it moves.
 *
 * # What is deliberately not here
 *
 * Opacity and stacking order — the rest of the shared {@link AnnotationActions}
 * set. Those exist for reference images, where "which one is on top" and "how
 * strongly does it show through the creases" are real questions. A suppression
 * region is a filter with a fixed, faint fill; neither control says anything
 * about what it does, and both crowded out the ones that do. Delete is composed
 * directly here instead.
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
 */

/**
 * Presentation lives inline rather than in `theme.css`.
 *
 * Not a preference — this stage owns no stylesheet. These are theme tokens either
 * way, so the rules move to a `.cp-region-chip*` block unchanged whenever someone
 * touches `theme.css` next; the class names below are already in place for it.
 */
const SUMMARY_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  // Takes the slack and gives it back first: the bar is as wide as its region,
  // which on a small one is not wide enough for everything. The controls keep
  // their size and the prose ellipsizes, because a truncated label still says
  // which region this is while a clipped button says nothing at all.
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  color: 'var(--text-secondary)',
  fontSize: 11,
  lineHeight: 1.4,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

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
  // Outside the shrinking summary on purpose: this is the safety affordance, so
  // it is the last thing on the bar that may be ellipsized away.
  flex: '0 0 auto',
  color: 'var(--status-warning)',
};

/** Pinned right, and never squeezed — every child is a control. */
const CONTROLS_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flex: '0 0 auto',
  marginLeft: 'auto',
};

export interface SuppressionRegionChipProps {
  region: CpSuppressionRegion;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  /** Findings this region alone is hiding. See `useCpRegions`. */
  hiddenCount: number;
  onSelect: () => void;
  onToggleCheckClass: (cpCheckClass: CpCheckClass) => void;
  /** Write a new centre during a bar drag. Unbracketed — see `useCpRegions`. */
  onMove: (center: Vec2) => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
  onDelete: () => void;
  /**
   * Appended before the controls — the slot `SolveRegionChip` composes into.
   * Nothing else should use it; a second consumer means a third chip component.
   */
  children?: ReactNode;
}

export function SuppressionRegionChip({
  region,
  container,
  hiddenCount,
  onSelect,
  onToggleCheckClass,
  onMove,
  onGestureStart,
  onGestureCommit,
  onDelete,
  children,
}: SuppressionRegionChipProps) {
  const { t } = useTranslation();
  const drag = useCpRegionChipDrag({
    center: region.center,
    onSelect,
    onMove,
    onGestureStart,
    onGestureCommit,
  });

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

  return (
    <CpRegionChipBar
      box={region}
      container={container}
      ariaLabel={t('panels:cpRegion.controls', 'Check suppression region')}
      drag={drag}
    >
      {/*
        A span, never a button. The whole bar is the affordance now — it selects
        on press and moves on drag — so a button inside it would be a second,
        smaller target for something the surface around it already does, and its
        own press handling would have to be excluded from the drag.
      */}
      <span className="cp-region-chip__summary" style={SUMMARY_STYLE} title={suppressionText}>
        <SquareDashed size={12} aria-hidden="true" />
        <span className="cp-region-chip__label" style={LABEL_STYLE}>
          {label}
        </span>
        <span className="cp-region-chip__classes" style={CLASSES_STYLE}>
          {suppressionText}
        </span>
      </span>
      {hiddenText !== null && (
        <span className="cp-region-chip__hidden" style={HIDDEN_STYLE}>
          <EyeOff size={11} aria-hidden="true" />
          {hiddenText}
        </span>
      )}
      <span className="cp-region-chip__controls" style={CONTROLS_STYLE}>
        {children}
        <CheckClassMenu suppress={region.suppress} onToggle={onToggleCheckClass} />
        <IconButton
          size="sm"
          variant="toolbar"
          title={t('panels:cpRegion.delete', 'Delete region')}
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </IconButton>
      </span>
    </CpRegionChipBar>
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
