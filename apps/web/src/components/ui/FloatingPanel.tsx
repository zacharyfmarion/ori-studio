/**
 * A titled window floating over a canvas: a frame, a title bar and a body.
 *
 * The tool window (`ToolHintWindow`, Edit's and Simulate's) wears it, and so
 * does the crease-angle popover. The chrome is one thing, so a window over the canvas
 * looks like the others whatever it holds. It used to be two: the popover was a
 * toolbar pill with a ground and a title of its own, offering the same angle
 * presets the tool window offered beside it in a different look.
 *
 * Presentation only, like `Toolbar`. Where a window sits is its owner's: a
 * `className` on the root for placement, and inline style for anything
 * measured. So is what it does — collapsing, animating its height, closing.
 */
import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import styles from './FloatingPanel.module.css';

export interface FloatingPanelProps extends HTMLAttributes<HTMLElement> {
  /**
   * The edge that holds still while the owner animates the frame's height
   * (`useAnimatedHeight`). Mid-resize the content sits on that edge, so
   * everything near it stays put and only the far edge travels.
   */
  pin?: 'top' | 'bottom';
}

export const FloatingPanel = forwardRef<HTMLElement, FloatingPanelProps>(function FloatingPanel(
  { className, pin, ...props },
  ref
) {
  return (
    <section
      ref={ref}
      className={className ? `${styles.panel} ${className}` : styles.panel}
      data-pin={pin}
      {...props}
    />
  );
});

export interface FloatingPanelHeaderProps {
  /** Names the window, so even a collapsed one still says what it is for. */
  title: ReactNode;
  /** What is inside, in a word: a setting count, or "Instructions". */
  meta?: ReactNode;
  /**
   * Chrome that belongs to the window rather than its content: a Reset, a
   * {@link FloatingPanelClose}.
   */
  action?: ReactNode;
  collapsed?: boolean;
  /**
   * Makes the bar the window's collapse toggle. Collapsed, the window is its
   * bar alone.
   */
  onCollapsedChange?: (collapsed: boolean) => void;
}

/**
 * The title bar.
 *
 * As a collapse toggle the whole bar is one button, which cannot nest the
 * action's — so the action is floated over the bar's end, which keeps a gutter
 * clear for it while it renders anything. A bar that toggles nothing is not a
 * button, and the action simply takes its place at the end.
 */
export function FloatingPanelHeader({
  title,
  meta,
  action,
  collapsed = false,
  onCollapsedChange,
}: FloatingPanelHeaderProps) {
  if (!onCollapsedChange) {
    return (
      <div className={styles.header}>
        <div className={styles.bar} data-static="">
          <span className={styles.title}>{title}</span>
          <span className={styles.end}>
            {meta !== undefined && <span className={styles.meta}>{meta}</span>}
            {action}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <button
        className={styles.bar}
        type="button"
        aria-expanded={!collapsed}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{meta}</span>
      </button>
      {/* Always mounted, so the bar reserves its gutter only while the action
          actually renders something (`:has()` in the module). */}
      <div className={styles.action} data-header-action="">
        {action}
      </div>
    </div>
  );
}

export interface FloatingPanelBodyProps extends Omit<HTMLAttributes<HTMLDivElement>, 'className'> {
  /**
   * The content's own box, which is always its natural height however tall the
   * frame is mid-resize: what `useAnimatedHeight` measures.
   */
  contentRef?: Ref<HTMLDivElement>;
}

/**
 * The body. It scrolls when an owner caps the frame's height; the bar stays put,
 * so the window is always named even mid-scroll.
 */
export const FloatingPanelBody = forwardRef<HTMLDivElement, FloatingPanelBodyProps>(
  function FloatingPanelBody({ contentRef, children, ...props }, ref) {
    return (
      <div ref={ref} className={styles.body} {...props}>
        <div ref={contentRef} className={styles.content}>
          {children}
        </div>
      </div>
    );
  }
);

/** A close button sized for the title bar, for {@link FloatingPanelHeaderProps.action}. */
export function FloatingPanelClose({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className={styles.close} type="button" aria-label={label} onClick={onClick}>
      <X size={13} aria-hidden="true" />
    </button>
  );
}
