/**
 * One preset in Settings ▸ Paper: a picture of the style, its name, and the
 * verbs that act on it.
 *
 * The picture is drawn by the app's own shading rather than an approximation
 * of it (`paperThumbnail`), so what a card shows is what applying it will
 * draw. The card itself is a single button — applying is the whole point of
 * it — and export / delete are separate buttons beside it rather than nested
 * inside, which is not markup a browser accepts.
 */
import { useTranslation } from 'react-i18next';
import { Check, Download, Trash2 } from 'lucide-react';
import { paperThumbnail } from '../../lib/paper/paperThumbnail';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { paperPresetRowLabel, type PaperPresetRow } from '../../lib/paperPresetRows';
import { IconButton } from '../ui/IconButton';

export function PaperPresetCard({
  row,
  applied,
  disabled,
  onApply,
  onExport,
  onDelete,
}: {
  row: PaperPresetRow;
  /** Whether the slot is showing this preset; drawn as an accent border and a check. */
  applied: boolean;
  disabled: boolean;
  onApply: () => void;
  onExport: () => void;
  /** null for a built-in, which cannot be deleted. */
  onDelete: (() => void) | null;
}) {
  const { t } = useTranslation();
  const label = paperPresetRowLabel(t, row);
  const sub = row.builtIn
    ? t('dialogs:settings.paper.presets.builtIn', 'Built in')
    : row.preset.author
      ? t('dialogs:settings.paper.presets.by', 'By {{author}}', { author: row.preset.author })
      : t('dialogs:settings.paper.presets.yours', 'Saved by you');

  return (
    <div
      className="settings-paper-preset"
      data-testid={`settings-paper-preset-${row.key}`}
      data-applied={applied || undefined}
    >
      <button
        type="button"
        className="settings-paper-preset__apply"
        aria-pressed={applied}
        disabled={disabled}
        onClick={onApply}
      >
        <PaperPresetThumbnail style={row.preset.style} />
        <span className="settings-paper-preset__copy">
          <span className="settings-paper-preset__name">{label}</span>
          <span className="settings-paper-preset__sub">{sub}</span>
        </span>
      </button>
      {applied && (
        <span className="settings-paper-preset__badge" aria-hidden="true">
          <Check size={11} strokeWidth={3.4} />
        </span>
      )}
      <span className="settings-paper-preset__verbs">
        <IconButton
          size="sm"
          aria-label={t('dialogs:settings.paper.presets.downloadNamed', 'Download preset {{name}}', {
            name: label,
          })}
          title={t('dialogs:settings.paper.presets.download', 'Download preset')}
          onClick={onExport}
        >
          <Download size={13} aria-hidden="true" />
        </IconButton>
        {onDelete && (
          <IconButton
            size="sm"
            aria-label={t('dialogs:settings.paper.presets.deleteNamed', 'Delete {{name}}', {
              name: label,
            })}
            title={t('dialogs:settings.paper.presets.delete', 'Delete')}
            onClick={onDelete}
          >
            <Trash2 size={13} aria-hidden="true" />
          </IconButton>
        )}
      </span>
    </div>
  );
}

/**
 * The style as a picture: the crease-pattern square with its mountain
 * diagonals and valley midlines, and a folded flap beside it lit by the
 * style's own light.
 *
 * Decoration — the card's words already say which preset this is — so it is
 * hidden from the accessibility tree. A viewBox rather than the drawing's own
 * pixels: the grid narrows to two columns and then one, and the picture should
 * scale with the card rather than be cropped by it.
 */
function PaperPresetThumbnail({ style }: { style: PaperStyle }) {
  const thumb = paperThumbnail(style);
  return (
    <svg
      className="settings-paper-preset__thumb"
      viewBox={`0 0 ${thumb.width} ${thumb.height}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={thumb.sheet.x}
        y={thumb.sheet.y}
        width={thumb.sheet.size}
        height={thumb.sheet.size}
        fill={thumb.sheet.fill}
        stroke={thumb.sheet.stroke}
        strokeWidth={thumb.sheet.strokeWidth}
      />
      {thumb.lines.map((line, index) => (
        <line
          key={index}
          x1={line.x1}
          y1={line.y1}
          x2={line.x2}
          y2={line.y2}
          stroke={line.stroke}
          strokeWidth={line.strokeWidth}
          strokeDasharray={line.dash ?? undefined}
        />
      ))}
      {thumb.faces.map((face, index) => (
        <path
          key={index}
          d={face.d}
          fill={face.fill}
          stroke={face.stroke}
          strokeWidth={face.strokeWidth}
        />
      ))}
    </svg>
  );
}
