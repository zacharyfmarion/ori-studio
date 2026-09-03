import { type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, EyeOff, ListChecks, Trash2 } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { MenuIconButton } from '../../components/ui/MenuIconButton';
import { CpRegionChipBar } from './CpRegionChipBar';
import { RegionImageMenu, type CpRegionImageActions } from './RegionImageMenu';
import { useCpRegionChipDrag } from './useCpRegionChipDrag';
import { cpCheckClassLabel } from '../diagnostics/checkSuppression';
import type { Vec2 } from '../annotations/annotationTransform';
import type { CpImage } from '../images/cpImage';
import {
  CP_CHECK_CLASSES,
  type CpCheckClass,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';

/**
 * The bar a check-suppression region wears: **how many findings it is hiding
 * right now**, and the controls that change that.
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
 * # Why there is no prose on it
 *
 * The bar is as wide as its region, and a region is usually the size of a sheet
 * of paper at whatever zoom the user is working at — which is routinely under
 * 200 px. It carried a name, a "Checks off: …" list and a solve status sentence,
 * and at ordinary zoom all three were already ellipsized to nothing while the
 * buttons they were competing with stayed put. So the bar keeps the one number
 * that cannot be recovered from anywhere else, and everything else moved to the
 * surface that has room for a sentence: the solve's outcome is a toast, the
 * suppressed classes are ticks inside the menu that sets them, and the region's
 * name is the bar's accessible name.
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
 * Opacity and stacking order **for the region itself** — the rest of the shared
 * {@link AnnotationActions} set. A suppression region is a filter with a fixed,
 * faint fill; neither control says anything about what it does, and both crowded
 * out the ones that do. Delete is composed directly here instead.
 *
 * A region that owns a *reference image* is a different question, and gets
 * {@link RegionImageMenu}: that image is locked so it never takes a click meant
 * for the creases being repaired, which in the shipped build left it with no way
 * to be hidden, faded or removed at all. Show/opacity/delete for it are on the
 * bar, in their own dropdown, and only when there is one.
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
 * The hidden count wears the theme's warning hue rather than muted text.
 *
 * Presentation lives inline rather than in `theme.css` — not a preference, this
 * stage owns no stylesheet. These are theme tokens either way, so the rules move
 * to a `.cp-region-chip*` block unchanged whenever someone touches `theme.css`
 * next; the class names are already in place for it. The bar's font size is the
 * one thing that is *not* here, and deliberately: see `CpRegionChipBar`.
 *
 * `--status-warning` is written by the active theme preset, so it follows light
 * and dark; `--text-warning` is defined nowhere in this app and would silently
 * resolve to its fallback — the mistake `.cp-folded-figure-toolbar__notice`
 * records having made.
 *
 * It is now the bar's only flexible item, so it is also the only thing that can
 * absorb a narrow region — hence `1 1 auto` and the ellipsis. It shrinks last
 * and never disappears: the controls beside it are buttons, and a clipped button
 * says nothing at all while a truncated count still says findings are hidden
 * here. The size comes from the bar (see `CpRegionChipBar`), not from here.
 */
const HIDDEN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
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

/**
 * The bar's accessible name: the region's own label when it has one.
 *
 * This is where `label` lives now that no span renders it. Not a demotion — a
 * bar with two icon buttons and a number needs a name more than one carrying its
 * own title did, and it is what tells two stacked regions apart for anyone
 * reading by keyboard or by test.
 */
function chipAriaLabel(t: TFunction, region: CpSuppressionRegion): string {
  const generic = t('panels:cpRegion.controls', 'Check suppression region');
  return region.label ? `${generic}: ${region.label}` : generic;
}

export interface SuppressionRegionChipProps extends CpRegionImageActions {
  region: CpSuppressionRegion;
  /**
   * The reference image this region owns, or null for one that has none.
   *
   * Resolved by the caller from `region.imageId`, never looked up here: a chip is
   * a readout, and a dangling id has to resolve to "no image control" rather than
   * to a crash — which is a decision about the annotation array, not about this
   * component.
   */
  image: CpImage | null;
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
  image,
  container,
  hiddenCount,
  onSelect,
  onToggleCheckClass,
  onMove,
  onGestureStart,
  onGestureCommit,
  onDelete,
  onToggleImageHidden,
  onImageOpacity,
  onDeleteImage,
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
      ariaLabel={chipAriaLabel(t, region)}
      drag={drag}
    >
      {/*
        A span, never a button. The whole bar is the affordance — it selects on
        press and moves on drag — so a button here would be a second, smaller
        target for something the surface around it already does, and its own
        press handling would have to be excluded from the drag.

        Rendered even at zero, as an empty spacer, so the controls stay pinned
        right and do not jump left the moment a solve clears the last finding.
      */}
      <span className="cp-region-chip__hidden" style={HIDDEN_STYLE}>
        {hiddenText !== null && (
          <>
            <EyeOff size={11} aria-hidden="true" />
            {hiddenText}
          </>
        )}
      </span>
      <span className="cp-region-chip__controls" style={CONTROLS_STYLE}>
        {children}
        {image && (
          <RegionImageMenu
            image={image}
            onToggleImageHidden={onToggleImageHidden}
            onImageOpacity={onImageOpacity}
            onDeleteImage={onDeleteImage}
            onGestureStart={onGestureStart}
            onGestureCommit={onGestureCommit}
          />
        )}
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
