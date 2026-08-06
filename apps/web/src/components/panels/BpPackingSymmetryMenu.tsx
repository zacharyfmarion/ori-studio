import { useEffect, useRef, useState } from 'react';
import { FlipHorizontal2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../ui/IconButton';
import { Toggle } from '../ui/Toggle';
import { SYMMETRY_FOLDS, symmetryFoldLabel } from '../../lib/bpSymmetryLabels';
import type { BpPackingSymmetryView } from '../../hooks/useBpPackingSymmetry';

/**
 * Mirror draw for the packing pane: whether it is on, and which fold of the
 * paper the mirror is.
 *
 * The fold sits here rather than only in the optimize dialog because it
 * describes *this* pane — it decides where the mirror line falls on the paper
 * and where a mirrored flap lands. It is the same design state the dialog
 * writes, so changing it in either place updates the other.
 *
 * Deliberately next to the sheet-size control in the toolbar: a book fold is the
 * vertical axis on a rectangular sheet and the diagonal one on a diamond sheet,
 * so the fold and the grid type decide each other's meaning.
 */
export function BpPackingSymmetryMenu({ symmetry }: { symmetry: BpPackingSymmetryView }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div className="viewport-toolbar__menu-anchor" ref={menuRef}>
      <IconButton
        size="sm"
        variant="toolbar"
        title={
          symmetry.enabled
            ? t('panels:bpPacking.mirrorDrawOn', 'Mirror draw (on)')
            : t('panels:bpPacking.mirrorDraw', 'Mirror draw')
        }
        isActive={open || symmetry.enabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FlipHorizontal2 size={14} />
      </IconButton>
      {open && (
        <div
          className="viewport-toolbar__dropdown symmetry-menu__panel"
          role="menu"
          aria-label={t('panels:bpPacking.symmetryControls', 'Box Pleat symmetry controls')}
        >
          <div className="symmetry-menu__toggle-row">
            <span className="symmetry-menu__toggle-copy">
              {t('panels:bpPacking.mirrorDraw', 'Mirror draw')}
              <small>{t('panels:bpPacking.mirrorDrawHint', 'New nodes get a twin')}</small>
            </span>
            <Toggle
              checked={symmetry.enabled}
              onChange={() => symmetry.toggle()}
              aria-label={t('panels:bpPacking.mirrorDraw', 'Mirror draw')}
            />
          </div>
          {/*
            * Below the toggle rather than behind it: the fold and the status are
            * facts about the design, not about whether the next node is drawn
            * with a twin. A design keeps its pairs — and keeps mirroring their
            * moves — after mirror draw is switched off.
            */}
          <div className="symmetry-menu__section-label">
            {t('panels:bpPacking.fold', 'Fold')}
          </div>
          <div className="bp-sheet-menu__segment">
            {SYMMETRY_FOLDS.map((fold) => {
              const unavailable = symmetry.foldUnavailable(fold);
              return (
                <button
                  key={fold}
                  type="button"
                  className={symmetry.fold === fold ? 'is-active' : undefined}
                  disabled={unavailable !== null}
                  title={unavailable ?? undefined}
                  onClick={() => symmetry.setFold(fold)}
                >
                  {symmetryFoldLabel(t, fold)}
                </button>
              );
            })}
          </div>
          <p className="symmetry-menu__status">{symmetry.status}</p>
        </div>
      )}
    </div>
  );
}
