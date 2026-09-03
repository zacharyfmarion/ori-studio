export const CONTROL_RADIUS_CLASS = 'ui-control--rounded';

export const CONTROL_SIZE_CLASSES = {
  sm: 'ui-control--sm',
  md: 'ui-control--md',
  lg: 'ui-control--lg',
} as const;

export const ICON_CONTROL_SIZE_CLASSES = {
  sm: 'ui-icon-control--sm',
  md: 'ui-icon-control--md',
  lg: 'ui-icon-control--lg',
} as const;

/**
 * Chips get their own scale rather than reusing {@link CONTROL_SIZE_CLASSES}.
 *
 * Those are fixed-height controls — 28 / 32 / 36px — because a button, an input
 * and a select have to line up in a row. A chip is a pill sized by its own
 * padding, and forcing one to 28px tall would make the dense context-panel rows
 * (currently 2px of vertical padding) more than twice their height.
 *
 * Only the sizes in use: `sm` is the dense in-panel row, `md` the standalone
 * popover where a chip is a primary target rather than a detail.
 */
export const CHIP_SIZE_CLASSES = {
  sm: 'ui-chip--sm',
  md: 'ui-chip--md',
} as const;
