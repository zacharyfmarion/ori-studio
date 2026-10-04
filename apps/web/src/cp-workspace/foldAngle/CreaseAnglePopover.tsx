/**
 * Set the active crease angle: an input and a row of preset chips.
 *
 * The keyboard path for the pen. `Shift+A` opens it with focus in the input, so
 * the whole interaction is type-and-Enter — or Tab onto a chip and Enter, for
 * the angles worth not typing.
 *
 * # The chips are ordinary tab stops
 *
 * Deliberately *not* a roving-tabindex composite, which is what an ARIA
 * toolbar or radiogroup would make them. A roving group is one tab stop with
 * arrow keys inside it, so Tab would skip the whole row — the opposite of what
 * this control is for. Plain buttons in DOM order give `Tab` → chip → chip and
 * `Enter` to pick, which is the interaction this was asked for and also the one
 * a screen-reader user gets for free.
 *
 * # It looks like the tool window
 *
 * The same `FloatingPanel` the tool window is, holding the same kind of
 * content: the fold-angle group a selection shows there is these presets and a
 * Degrees field, and the two have to read as one control applied to two
 * things. Only the order differs — the field comes first here, because focus
 * opens in it and Tab walks on to the chips, and what is seen first must be
 * what is focused first.
 *
 * # Two frames, one body
 *
 * Anchored to the toolbar field when there is one, and a centred modal when
 * there is not — the phone layout, where the field does not render, and any
 * case where `Shift+A` fires while the bar is collapsed. A popover has to have
 * something to point at, and pointing at nothing is worse than not pointing.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FloatingPortal } from '@floating-ui/react';
import { Chip } from '../../components/ui/Chip';
import {
  FloatingPanel,
  FloatingPanelBody,
  FloatingPanelClose,
  FloatingPanelHeader,
} from '../../components/ui/FloatingPanel';
import {
  useAnchoredFloating,
  type FloatingAnchorRect,
} from '../../components/ui/useAnchoredFloating';
import { CANVAS_COMPANION_PROPS } from '../canvasObjects/canvasCompanionSurface';
import { TOOL_HINT_WIDTH } from '../../components/ui/tools/toolHintPlacement';
import { FOLD_ANGLE_PRESETS } from './foldAngleActions';
import { formatCreaseAngleValue, parseCreaseAngle } from './activeCreaseAngle';
import type { OristudioCpFoldDirectionHint } from '../../engine/oristudioCpTypes';
import styles from './CreaseAnglePopover.module.css';

export interface CreaseAnglePopoverProps {
  /** The live pen, in degrees (a magnitude). */
  degrees: number;
  /**
   * Apply a new pen. The popover closes itself after. `direction` is set only
   * when the entry carried an explicit sign, and asks for the line type to
   * change with it.
   */
  onChange: (degrees: number, direction: OristudioCpFoldDirectionHint | null) => void;
  onClose: () => void;
  /**
   * The toolbar field to hang off. A ref rather than a rect, and measured here
   * rather than by the panel, for two reasons: reading `.current` during the
   * panel's render is exactly what `react-hooks/refs` forbids, and a rect
   * captured at render is stale the moment the bar moves — which it does, since
   * it is centred on a pane that resizes.
   *
   * An empty ref (no field rendered, as on a phone) falls back to the centred
   * frame.
   */
  anchorRef: RefObject<HTMLElement | null>;
  /** Pane the anchored frame must stay inside. See `useAnchoredFloating`. */
  boundaryRef?: RefObject<HTMLElement | null>;
}

/** What the anchored frame hangs off: viewport CSS px. */
function anchorRectOf(element: HTMLElement): FloatingAnchorRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

/**
 * The tool window's width, which is what holds all six presets on one row
 * there; the same row here is the same width.
 */
const WIDTH_STYLE = { width: TOOL_HINT_WIDTH };

/**
 * Narrowest a cramped pane may squeeze the anchored frame to before it
 * overflows the pane instead: the Degrees row's label and a field still usable
 * beside it.
 */
const MIN_WIDTH = 160;

export function CreaseAnglePopover({
  degrees,
  onChange,
  onClose,
  anchorRef,
  boundaryRef,
}: CreaseAnglePopoverProps) {
  const { t } = useTranslation();
  const title = t('tools:creaseAngle.title', 'Crease angle');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState(() => formatCreaseAngleValue(degrees));
  /**
   * Where to hang, measured. `null` means "not measured yet" and is distinct
   * from `{ rect: null }`, which means "measured, and there is nothing to hang
   * off" — the phone case that takes the centred frame. Without that
   * distinction the first pass would render the modal and the second would
   * swap it for the popover, which is a visible flash.
   */
  const [placement, setPlacement] = useState<{
    rect: FloatingAnchorRect | null;
    boundary: Element | null;
  } | null>(null);

  // `useLayoutEffect`, so the measurement lands before paint and the null-return
  // below costs no visible frame. Re-measured on resize because the bar is
  // centred on a pane whose width the popover has no other way to hear about.
  useLayoutEffect(() => {
    const measure = () => {
      const anchor = anchorRef.current;
      setPlacement({
        rect: anchor ? anchorRectOf(anchor) : null,
        boundary: boundaryRef?.current ?? null,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [anchorRef, boundaryRef]);

  // Called whichever frame renders, as hooks must be; without an anchor it is
  // simply never visible.
  const floating = useAnchoredFloating({
    anchorRect: placement?.rect ?? null,
    placement: 'top',
    offset: 8,
    boundary: placement?.boundary ?? null,
    minWidth: MIN_WIDTH,
  });
  const { setFloating } = floating;
  const attachAnchored = useCallback(
    (node: HTMLElement | null) => {
      panelRef.current = node;
      setFloating(node);
    },
    [setFloating]
  );

  /**
   * Focus the input the moment it exists.
   *
   * A callback ref, not a mount effect, because the input is **two deferrals
   * away** from this component's first render and neither is ours to see: the
   * layout effect above has not measured yet on pass one, and `FloatingPortal`
   * mounts its portal node in an effect of its own, so the anchored body only
   * appears on a later pass still. A `useEffect(..., [])` therefore ran against
   * a null ref and silently did nothing — Shift+A opened the popover with focus
   * left on whatever opened it, and typing went nowhere.
   *
   * A callback ref fires exactly when the node attaches, whichever pass that
   * turns out to be, so it is also indifferent to the modal path (no
   * `FloatingPortal`) versus the anchored one. Counting passes would have to be
   * right twice.
   */
  const focusOnAttach = useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (!node) return;
    node.focus();
    node.select();
  }, []);

  // Opened by a chord that can fire from anywhere — a canvas, the rail, another
  // field — so there is no fixed trigger to hand focus back to. Remember what
  // had it and restore that, rather than assuming.
  useEffect(() => {
    const restoreTo = document.activeElement;
    return () => {
      if (restoreTo instanceof HTMLElement && restoreTo.isConnected) restoreTo.focus();
    };
  }, []);

  // Capture-phase on `window`, like the other dialogs here, so a press outside
  // closes wherever it lands.
  //
  // `pointerdown` and not `mousedown`: the crease-pattern canvas cancels
  // `pointerdown` on essentially every press, which suppresses the
  // compatibility mouse events entirely — that is what made the viewport bar's
  // popovers undismissable on an iPad. Tapping the paper has to put this away.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => window.removeEventListener('pointerdown', onPointerDown, true);
  }, [onClose]);

  const commitDraft = () => {
    const parsed = parseCreaseAngle(draft);
    // A blank or out-of-range entry closes without changing the pen rather than
    // resetting it: the user opened this to set an angle, and silently putting
    // it back to 180 because they mistyped is the one outcome nobody wants.
    if (parsed !== null) onChange(parsed.degrees, parsed.direction);
    onClose();
  };

  // One pre-paint pass, before the layout effect above has run.
  if (!placement) return null;

  const content = (
    <>
      <FloatingPanelHeader
        title={title}
        action={
          <FloatingPanelClose
            label={t('tools:creaseAngle.close', 'Close crease angle')}
            onClick={onClose}
          />
        }
      />
      <FloatingPanelBody>
        {/* The fold-angle group's field row (`FoldAngleControl`), so the two
            read as the same control. */}
        <label className="cp-context-panel__field">
          <span>{t('tools:creaseAngle.degreesLabel', 'Degrees')}</span>
          <input
            ref={focusOnAttach}
            type="text"
            inputMode="decimal"
            aria-label={t('tools:creaseAngle.degrees', 'Crease angle in degrees')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              commitDraft();
            }}
          />
        </label>
        <div className={styles.chips}>
          {FOLD_ANGLE_PRESETS.map((preset) => (
            <Chip
              key={preset.id}
              // `aria-pressed`, so the chip announces whether it is the pen now.
              // The presets are not a radio group: picking one is an action that
              // closes this, not a selection that persists in the row.
              aria-pressed={degrees === preset.degrees}
              onClick={() => {
                // Magnitude only. A chip says "this far", never "and the other
                // way" — flipping mountain to valley on a press labelled `90°`
                // would be a change nobody asked that chip for. The sign is
                // typed, deliberately.
                onChange(preset.degrees, null);
                onClose();
              }}
            >
              {preset.label}
            </Chip>
          ))}
        </div>
      </FloatingPanelBody>
    </>
  );

  const dialogProps = {
    role: 'dialog',
    'aria-modal': true,
    'aria-label': title,
    // Handled here rather than on `window` because the input inside owns its
    // own keystrokes: `isShortcutEditingTarget`, the guard the other dialogs use
    // to leave text fields alone, would swallow exactly the Escape this popover
    // most needs to honour.
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
  } as const;

  if (!placement.rect) {
    // Portaled like every other modal. Rendered in place it was inside the
    // crease-pattern viewport's stacking context, so its backdrop sat *under*
    // the tool window, which is body-portaled: on a phone the window floated
    // undimmed over the modal, close enough to tap by mistake.
    return createPortal(
      <div
        role="presentation"
        className="simple-modal"
        /*
          `click`, not `mousedown` — dismissing on the down event unmounts the
          backdrop mid-gesture and the rest of the tap goes to whatever is newly
          underneath, which on a phone is the canvas. The tap that closed this
          would also have drawn on the paper.
        */
        onClick={onClose}
      >
        <FloatingPanel
          ref={panelRef}
          {...dialogProps}
          className={styles.centred}
          style={WIDTH_STYLE}
          onClick={(event) => event.stopPropagation()}
        >
          {content}
        </FloatingPanel>
      </div>,
      document.body
    );
  }

  if (!floating.visible) return null;

  return (
    <FloatingPortal>
      <FloatingPanel
        ref={attachAnchored}
        {...dialogProps}
        className={styles.anchored}
        // It edits what new creases on the canvas will be, so a press inside it
        // must not read as leaving the canvas's selection.
        {...CANVAS_COMPANION_PROPS}
        style={{ ...floating.style, ...WIDTH_STYLE }}
      >
        {content}
      </FloatingPanel>
    </FloatingPortal>
  );
}
