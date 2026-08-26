/**
 * The Folded models controls, without the container that holds them.
 *
 * Extracted because a phone shows them in a modal and everything else shows
 * them in a dropdown, and the alternative to one body with two frames is two
 * bodies that drift. There are eleven controls here — a figure list, a display
 * style, a side, four colours, a shadow toggle — and a second copy of them would
 * be a maintenance bill paid forever for a difference that is entirely
 * presentational.
 *
 * Reads nothing and owns nothing: every value and every verb arrives as a prop,
 * which is what lets the same element tree sit inside a `role="menu"` dropdown
 * and inside a `role="dialog"` modal without either frame leaking in here.
 */
import { useTranslation } from 'react-i18next';
import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureState,
} from '../../engine/oristudioCpTypes';
import { hexToRgbColor, rgbColorToHex } from '../../lib/rgbColor';
import { FOLDED_FIGURE_SIDES } from '../../lib/foldedFigureSides';
import { ColorField } from '../../components/ui/ColorField';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Toggle } from '../../components/ui/Toggle';
import { foldedAppearanceEnabled } from './foldedFigureAppearance';
import { isFoldedFigureReady } from './foldedFigureActions';
import { foldedFigureCapabilities } from './foldedFigureCapabilities';
import { foldedFigureSubtitle } from './foldedFigureNotice';
import {
  FOLDED_COLOR_FIELDS,
  FOLDED_DISPLAY_STYLE_OPTIONS,
  foldedColorLabel,
  foldedDisplayStyleLabel,
  foldedStateLabel,
} from './foldedFigureControlOptions';

export interface FoldedFigureControlsProps {
  figures: OristudioCpFoldedFigureEntry[];
  activeFigure: OristudioCpFoldedFigureEntry | null;
  /**
   * Figures whose source creases have changed since they were folded. Derived
   * per document revision rather than stamped on the entry — see
   * `lib/foldedFigureStaleness.ts`.
   */
  staleFigureIds: ReadonlySet<string>;
  onSelectFigure: (id: string) => void;
  onDisplayStyle: (displayStyle: OristudioCpFoldedFigureDisplayStyle) => void;
  /**
   * Apply a model change. `scope` groups the stream of changes a single drag
   * emits (colour picker, alpha slider) into one undo entry; omit it for
   * discrete controls, which record immediately.
   */
  onModelUpdate: (update: Partial<OristudioCpFoldedFigureModel>, scope?: string) => void;
  /** End a scoped run of {@link onModelUpdate} changes and record one entry. */
  onModelGestureEnd: (scope: string, label: string) => void;
}

export function FoldedFigureControls({
  figures,
  activeFigure,
  staleFigureIds,
  onSelectFigure,
  onDisplayStyle,
  onModelUpdate,
  onModelGestureEnd,
}: FoldedFigureControlsProps) {
  const { t } = useTranslation();
  // A flat figure keeps its model in the kernel snapshot, a 3D one on
  // `folded3d`. Reading only the first left every control here showing its
  // fallback for a 3D figure.
  const model = activeFigure?.snapshot?.model ?? activeFigure?.folded3d?.model ?? null;
  const capabilities = foldedFigureCapabilities(activeFigure);
  // A 3D figure is "ready" without a flat snapshot — that is the kind witness,
  // not a missing field — but its *model* controls stay off, because it keeps no
  // appearance in the kernel to change.
  const activeReady = activeFigure ? isFoldedFigureReady(activeFigure) : false;
  const modelReady = activeReady && capabilities.editModel;

  // Keep any display style already saved on a document selectable even if it is
  // no longer offered as a fresh choice (e.g. legacy Dev/None figures).
  const currentDisplayStyle = activeFigure?.displayStyle ?? 'Paper5';
  // Filtered rather than replaced, so this list keeps its own order while the
  // capability list decides membership.
  const offeredDisplayStyles = FOLDED_DISPLAY_STYLE_OPTIONS.filter((value) =>
    capabilities.styleChoices.includes(value)
  );
  const foldedDisplayStyleOptions = offeredDisplayStyles.includes(currentDisplayStyle)
    ? offeredDisplayStyles
    : [...offeredDisplayStyles, currentDisplayStyle];

  return (
    <>
      <div className="folded-figure-menu__header">
        <span>{t('panels:creasePattern.foldedModels', 'Folded models')}</span>
        <span>{activeFigure ? activeFigure.title : t('panels:creasePattern.none', 'None')}</span>
      </div>
      {figures.length > 0 && (
        <div className="folded-figure-menu__list">
          {figures.map((figure) => (
            <button
              key={figure.id}
              type="button"
              className="folded-figure-menu__figure"
              data-active={figure.id === activeFigure?.id ? true : undefined}
              data-status={figure.status}
              role="menuitemradio"
              aria-checked={figure.id === activeFigure?.id}
              onClick={() => onSelectFigure(figure.id)}
            >
              <span>{figure.title}</span>
              <small data-stale={staleFigureIds.has(figure.id) || undefined}>
                {foldedFigureSubtitle(t, figure, staleFigureIds.has(figure.id))}
              </small>
            </button>
          ))}
        </div>
      )}
      <label className="folded-figure-menu__field">
        <span>{t('panels:creasePattern.display', 'Display')}</span>
        <select
          aria-label={t('panels:creasePattern.foldedDisplayStyle', 'Folded display style')}
          value={activeFigure?.displayStyle ?? 'Paper5'}
          disabled={!activeReady}
          onChange={(event) =>
            onDisplayStyle(event.currentTarget.value as OristudioCpFoldedFigureDisplayStyle)
          }
        >
          {foldedDisplayStyleOptions.map((value) => (
            <option key={value} value={value}>
              {foldedDisplayStyleLabel(t, value)}
            </option>
          ))}
        </select>
      </label>
      <div className="folded-figure-menu__field folded-figure-menu__field--segmented">
        <span>{t('panels:creasePattern.side', 'Side')}</span>
        {/* The value is the kernel's full state, not just the two offered
            sides: a figure loaded from Oriedita in an overlay state keeps
            rendering as saved, and marks neither side current until one is
            picked. */}
        <SegmentedControl<OristudioCpFoldedFigureState>
          aria-label={t('panels:creasePattern.foldedModelSide', 'Folded model side')}
          options={FOLDED_FIGURE_SIDES.map((value) => ({
            value,
            label: foldedStateLabel(t, value),
          }))}
          value={model?.state ?? 'Front0'}
          disabled={!modelReady}
          onChange={(state) => onModelUpdate({ state })}
        />
      </div>
      {/* `inline`, not `row`: a dropdown is not an options pane, and the ruled,
          padded rows a `control-row` draws would not match the fields above. */}
      {FOLDED_COLOR_FIELDS.map((field) => (
        <ColorField
          key={field.key}
          layout="inline"
          label={foldedColorLabel(t, field.key)}
          value={rgbColorToHex(model?.[field.key] ?? field.fallback)}
          disabled={!modelReady}
          onChange={(value) =>
            onModelUpdate({ [field.key]: hexToRgbColor(value) }, `color:${field.key}`)
          }
          onCommit={() =>
            onModelGestureEnd(
              `color:${field.key}`,
              t('panels:creasePattern.changeFoldedColor', 'Change folded model color')
            )
          }
        />
      ))}
      {/* No Case field: stepping through the layer-ordering solutions is
          "Another solution" on the figure's own toolbar and context menu. */}
      <div
        className="folded-figure-menu__toggle-row"
        // Shown but disabled on a 3D figure rather than hidden: a control
        // that disappears between figure kinds reads as a bug, and one that
        // is enabled and does nothing is worse than either. The title says
        // which case this is. See `foldedFigureAppearance`.
        title={
          activeFigure && !foldedAppearanceEnabled(activeFigure, 'shadow')
            ? t(
                'panels:creasePattern.shadowUnsupported3d',
                'Shadows are not drawn for a 3D folded model yet'
              )
            : undefined
        }
      >
        <span>{t('panels:creasePattern.shadow', 'Shadow')}</span>
        <Toggle
          checked={model?.display_shadows ?? false}
          disabled={
            !modelReady || (activeFigure ? !foldedAppearanceEnabled(activeFigure, 'shadow') : false)
          }
          onChange={(display_shadows) => onModelUpdate({ display_shadows })}
          aria-label={t('panels:creasePattern.showFoldedModelShadow', 'Show folded model shadow')}
        />
      </div>
      {/* No Color alpha toggle: it only reaches the Transparent display
          style, and transparency is not a supported surface right now. The
          model keeps `transparency_color` so Oriedita files round-trip.

          No Duplicate or Delete either: both act on one figure, and the
          figure's own toolbar and context menu already carry them — from
          `foldedFigureActions`, acting on the figure you clicked rather than
          on whichever happens to be active. */}
    </>
  );
}
