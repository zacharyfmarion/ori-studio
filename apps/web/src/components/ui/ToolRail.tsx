import { type ReactNode, useState } from 'react';
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
      <div className={styles.groups} data-rail-part="groups">
        {groups.map((group) => (
          <ToolRailSection key={group.id} group={group} idPrefix={idPrefix} storageKey={storageKey} />
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

function ToolRailSection({
  group,
  idPrefix,
  storageKey,
}: {
  group: ToolRailGroup;
  idPrefix: string;
  storageKey: string | undefined;
}) {
  const [open, setOpen] = useState(
    () => readOpenState(storageKey)[group.id] ?? group.collapsedByDefault !== true
  );
  const buttonsId = `${idPrefix}-${group.id}`;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (storageKey) writeJson(storageKey, { ...readOpenState(storageKey), [group.id]: next });
  };

  return (
    <section className={styles.group} aria-label={group.label} data-open={open || undefined}>
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
      <TooltipContent side="right">{tool.tooltip}</TooltipContent>
    </Tooltip>
  );
}
