import { type ReactNode, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { readJson, writeJson } from '../../lib/storage';
import { Tooltip, TooltipContent, TooltipTrigger } from './Tooltip';
import { useTouchLabel } from './useTouchLabel';
import styles from './ToolRail.module.css';

/** One icon-only tool in a rail group. */
export interface ToolRailTool {
  id: string;
  /** Its name: the button's accessible name and the start of its tooltip. */
  label: string;
  /** The whole tooltip: the name, its shortcut, and what it does or why it cannot. */
  tooltip: string;
  glyph: ReactNode;
  active: boolean;
  /** False keeps it focusable, so its tooltip can say why, but a click does nothing. */
  available: boolean;
  /**
   * Switched on and off rather than taken in hand (a style's Bold, say):
   * `active` is whether it is on, said as `aria-pressed`.
   */
  toggle?: boolean;
  /** Where its tooltip opens; beside the rail unless that would cover the tool a hand moves to next. */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left';
  onSelect: () => void;
}

export interface ToolRailGroup {
  id: string;
  /** The group's accessible name. */
  label: string;
  /** The short header the rail shows, which toggles the group. */
  railLabel: string;
  collapsedByDefault?: boolean;
  /**
   * Scrolled into the rail's view as it appears: a group a tool brings with
   * it, which on a short screen would otherwise come in below the fold and
   * show nothing for the press that brought it.
   */
  reveal?: boolean;
  /**
   * Its content: tool buttons in the rail's grid, or one control across the
   * grid's width (a segmented control whose options are the group's tools).
   */
  content: { tools: readonly ToolRailTool[] } | { control: ReactNode };
}

interface ToolRailProps {
  'aria-label': string;
  /** Prefixes each group's button list id: `${idPrefix}-${group.id}`. */
  idPrefix: string;
  groups: readonly ToolRailGroup[];
  /**
   * A full-width row above the groups. The rail's constraint is horizontal, so
   * what a header spends is height, in a column that already scrolls.
   */
  header?: ReactNode;
  /** Where the groups' open state persists; without one, it lasts as long as the rail. */
  storageKey?: string;
}

/**
 * The tool rail down the left of a canvas: collapsible groups of icon-only
 * tools, each named by its tooltip, or on touch by a press-and-hold. A phone
 * has no rail; the surface that hosts one gives it a tool sheet instead.
 */
export function ToolRail({ 'aria-label': ariaLabel, idPrefix, groups, header, storageKey }: ToolRailProps) {
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <aside className={styles.rail} aria-label={ariaLabel} data-header={header ? '' : undefined}>
      {/*
        Rendered only when there is one: the rail is a grid with one explicit
        row, so an empty header div would still open a second implicit one.
      */}
      {header && (
        <div className={styles.header} data-rail-part="touch-header">
          {header}
        </div>
      )}
      <div ref={scroller} className={styles.groups} data-rail-part="groups">
        {groups.map((group) => (
          <ToolRailSection key={group.id} group={group} idPrefix={idPrefix} storageKey={storageKey} scroller={scroller} />
        ))}
      </div>
    </aside>
  );
}

/** Which groups the user has opened, keyed by group id. */
function readOpenState(storageKey: string | undefined): Record<string, boolean> {
  if (!storageKey) return {};
  const stored = readJson<unknown>(storageKey, {});
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return stored as Record<string, boolean>;
}

/**
 * How far a column scrolled to `view` must move to show `item` (both by their
 * top and bottom on the screen): nothing when it shows it whole, else the
 * least that does — or that shows its top, when it is taller than the column.
 */
export function revealScroll(item: { top: number; bottom: number }, view: { top: number; bottom: number }): number {
  if (item.top >= view.top && item.bottom <= view.bottom) return 0;
  if (item.top < view.top || item.bottom - item.top > view.bottom - view.top) return item.top - view.top;
  return item.bottom - view.bottom;
}

function ToolRailSection({
  group,
  idPrefix,
  storageKey,
  scroller,
}: {
  group: ToolRailGroup;
  idPrefix: string;
  storageKey: string | undefined;
  scroller: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(
    () => readOpenState(storageKey)[group.id] ?? group.collapsedByDefault !== true
  );
  const buttonsId = `${idPrefix}-${group.id}`;
  const section = useRef<HTMLElement>(null);
  const reveal = group.reveal === true;
  // Before it paints, so it never shows the column first without it. The rail's own column scrolls, and nothing round it.
  useLayoutEffect(() => {
    const [column, shown] = [scroller.current, section.current];
    if (!reveal || !column || !shown) return;
    const box = column.getBoundingClientRect();
    const by = revealScroll(shown.getBoundingClientRect(), { top: box.top, bottom: box.top + column.clientHeight });
    if (by !== 0) column.scrollTop += by;
  }, [reveal, scroller]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) writeJson(storageKey, { ...readOpenState(storageKey), [group.id]: next });
  };

  return (
    <section ref={section} className={styles.group} aria-label={group.label} data-open={open || undefined}>
      <button
        type="button"
        className={styles.groupToggle}
        aria-expanded={open}
        aria-controls={buttonsId}
        onClick={toggle}
      >
        <span className={styles.groupLabel}>{group.railLabel}</span>
        <ChevronDown className={styles.groupChevron} size={10} aria-hidden="true" />
      </button>
      {open && (
        <div
          className={styles.buttons}
          id={buttonsId}
          data-group={group.id}
          data-control={'control' in group.content ? '' : undefined}
        >
          {'control' in group.content
            ? group.content.control
            : group.content.tools.map((tool) => <ToolRailButton key={tool.id} tool={tool} />)}
        </div>
      )}
    </section>
  );
}

/**
 * Rail tools inside a group's own control — toggles beside a select, say: the
 * rail's grid and its buttons, so they look and size as every tool above them.
 */
export function ToolRailButtons({ tools }: { tools: readonly ToolRailTool[] }) {
  return (
    <div className={styles.buttons}>
      {tools.map((tool) => (
        <ToolRailButton key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolRailButton({ tool }: { tool: ToolRailTool }) {
  // The rail does not use `IconButton`, so it wires the hold itself: a rail is
  // a column of icons whose only label is a tooltip, which Radix gives no touch
  // path, and the hold is how a finger asks what one is.
  const hold = useTouchLabel();

  const button = (
    <button
      type="button"
      className={styles.button}
      aria-label={tool.label}
      aria-disabled={!tool.available}
      aria-pressed={tool.toggle ? tool.active : undefined}
      data-active={tool.active || undefined}
      {...hold.handlers}
      onClick={() => {
        // Holding a tool to find out what it is must not also arm it.
        if (hold.consumeClick()) return;
        if (!tool.available) return;
        tool.onSelect();
      }}
    >
      {tool.glyph}
    </button>
  );

  return (
    <Tooltip open={hold.open}>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tool.tooltipSide ?? 'right'}>{tool.tooltip}</TooltipContent>
    </Tooltip>
  );
}
