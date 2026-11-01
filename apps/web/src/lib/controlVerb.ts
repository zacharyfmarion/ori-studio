/**
 * Something a control does when it is pressed, as plain data: what it is
 * called, whether it can act now and why not, and what it does.
 *
 * A catalog builds these, free of React and of the store; a renderer draws
 * them — a pager's ‹ and ›, a Properties sheet's header verbs, a button on a
 * row. One shape for all of them, so a catalog's command can be handed to any
 * of those surfaces as it is (a folded figure's `FoldedFigureCommand` is one).
 */
export interface ControlVerb {
  /** Translated; the control's accessible name. */
  label: string;
  /**
   * It cannot act now. A surface that keeps the focus a press gave it — a
   * pager while its step runs — refuses the press (`aria-disabled`); others
   * disable the control.
   */
  disabled: boolean;
  /** Translated; why it cannot act, shown in place of the label while it cannot. */
  hint?: string;
  run(): void;
}
