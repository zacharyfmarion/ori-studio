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
 * # Two frames, one body
 *
 * Anchored to the toolbar field when there is one, and a centred modal when
 * there is not — the phone layout, where the field does not render, and any
 * case where `Shift+A` fires while the bar is collapsed. That split is the same
 * call `FoldedFigureModal` documents: a popover has to have something to point
 * at, and pointing at nothing is worse than not pointing.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Chip } from '../../components/ui/Chip';
import { IconButton } from '../../components/ui/IconButton';
import { FloatingToolbar, type FloatingAnchorRect } from '../../components/ui/FloatingToolbar';
import { FOLD_ANGLE_PRESETS } from './foldAngleActions';
import { formatCreaseAngleValue, parseCreaseAngle } from './activeCreaseAngle';
import type { OristudioCpFoldDirectionHint } from '../../engine/oristudioCpTypes';

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
  /** Pane the anchored frame must stay inside. See {@link FloatingToolbar}. */
  boundaryRef?: RefObject<HTMLElement | null>;
}

/** What `FloatingToolbar` anchors against: viewport CSS px. */
function anchorRectOf(element: HTMLElement): FloatingAnchorRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

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
  const bodyRef = useRef<HTMLDivElement | null>(null);
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
   * turns out to be, so it is also indifferent to the modal path (no portal)
   * versus the anchored one. Counting passes would have to be right twice.
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
      if (bodyRef.current?.contains(event.target as Node)) return;
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

  const body = (
    <div
      ref={bodyRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="crease-angle-popover"
      onKeyDown={(event) => {
        // Handled here rather than on `window` because the input inside owns
        // its own keystrokes: `isShortcutEditingTarget`, the guard the other
        // dialogs use to leave text fields alone, would swallow exactly the
        // Escape this popover most needs to honour.
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="crease-angle-popover__header">
        <span>{title}</span>
        <IconButton
          size="sm"
          aria-label={t('tools:creaseAngle.close', 'Close crease angle')}
          onClick={onClose}
        >
          <X size={14} />
        </IconButton>
      </div>
      <input
        ref={focusOnAttach}
        type="text"
        inputMode="decimal"
        className="crease-angle-popover__input"
        aria-label={t('tools:creaseAngle.degrees', 'Crease angle in degrees')}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          commitDraft();
        }}
      />
      <div className="crease-angle-popover__chips">
        {FOLD_ANGLE_PRESETS.map((preset) => (
          <Chip
            key={preset.id}
            // Bigger than the dense context-panel rows: here a chip is the
            // primary target rather than a detail beside a field, and it is a
            // Tab stop the keyboard path is built around.
            size="md"
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
    </div>
  );

  // One pre-paint pass, before the layout effect above has run.
  if (!placement) return null;

  if (!placement.rect) {
    return (
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
        <div
          className="simple-modal__document crease-angle-popover__modal"
          onClick={(event) => event.stopPropagation()}
        >
          {body}
        </div>
      </div>
    );
  }

  return (
    <FloatingToolbar
      anchorRect={placement.rect}
      placement="top"
      boundary={placement.boundary}
      ariaLabel={title}
      className="crease-angle-popover__floating"
    >
      {body as ReactNode}
    </FloatingToolbar>
  );
}
