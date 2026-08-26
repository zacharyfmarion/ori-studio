/**
 * The Folded models controls, as a modal, for the phone.
 *
 * # Why a phone gets a different frame
 *
 * The dropdown is anchored to a trigger in the viewport bar. On a phone that bar
 * sits at the bottom of the screen and now carries the favorite tools, so the
 * trigger moved into the overflow menu — and a popover anchored to a menu item
 * is a popover inside a menu's focus trap, which is the exact shape
 * `viewportToolbarLayout` documents as the reason `kind: 'node'` exists.
 *
 * A modal has no anchor to be wrong about. It also has the height these controls
 * actually want: eleven of them, which as a dropdown over a 375px screen is a
 * panel taller than the canvas it is supposed to be modifying.
 *
 * # What it does not do
 *
 * It does not own the controls — `FoldedFigureControls` does, and the dropdown
 * renders the same element tree. This file is the frame: a backdrop, a titled
 * header, a close button, and Escape.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, X } from 'lucide-react';
import { isShortcutEditingTarget } from '../../keyboard/shortcutDispatcher';
import { IconButton } from '../../components/ui/IconButton';
import { FoldedFigureControls, type FoldedFigureControlsProps } from './FoldedFigureControls';

export function FoldedFigureModal({
  close,
  ...controls
}: FoldedFigureControlsProps & { close: () => void }) {
  const { t } = useTranslation();
  const title = t('panels:creasePattern.foldedModels', 'Folded models');

  // Focus the document, the way the tool sheet and the View drawer do:
  // `aria-modal` hides everything outside this dialog from a screen reader, so
  // focus left on the trigger behind it sits on a node VoiceOver can no longer
  // see — nothing announced, and the controls reachable only by exploring.
  //
  // The other half of this lives in `ViewportToolbarOverflowMenu`: the only way
  // in is a Radix menu item, and Radix restores focus to the menu's trigger as
  // it unmounts — asynchronously, and measurably later than either a mount
  // effect or a yielded one, so the restore wins and the dialog opens with focus
  // behind it. The item that opens this carries `opensDialog`, which is what
  // stops that restore; this effect is then free to be the ordinary one.
  const documentRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    documentRef.current?.focus();
  }, []);

  // Capture-phase on `window`, like every other dialog here, so Escape fires
  // wherever focus landed inside rather than only on what happens to be focused.
  // `isShortcutEditingTarget` is the repo's one answer to "does this target own
  // its keystrokes", and this body holds a colour input and a select.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (isShortcutEditingTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="simple-modal folded-figure-modal"
      /*
        `click`, not `mousedown` — the retargeting hazard the tool sheet
        documents. Dismissing on the down event unmounts the backdrop inside the
        commit, and the rest of the gesture goes to whatever is newly underneath;
        on a phone that is the canvas, and the tap that closed this would also
        have drawn on the paper.
      */
      onClick={close}
    >
      <div
        ref={documentRef}
        role="document"
        tabIndex={-1}
        className="simple-modal__document folded-figure-modal__document"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <ListChecks size={15} aria-hidden="true" />
            {title}
          </span>
          <IconButton
            size="sm"
            aria-label={t('panels:creasePattern.closeFoldedModels', 'Close folded models')}
            onClick={close}
          >
            <X size={15} />
          </IconButton>
        </header>
        <div className="simple-modal__body folded-figure-modal__body">
          <FoldedFigureControls {...controls} />
        </div>
      </div>
    </div>
  );
}
