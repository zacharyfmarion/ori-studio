import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ChevronRight, Download, X } from 'lucide-react';
import {
  cancelCommandDialog,
  resolveCommandDialog,
  type CreasePatternExportDialog,
} from '../store/commandDialogStore';
import {
  buildCreaseExportArtwork,
  composeCreaseExportSvg,
  creaseExportFigureHeight,
  creaseExportPalette,
  creaseExportPaperStyle,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  type CreaseExportCaption,
  type CreaseExportFoldedFigureSettings,
  type CreaseExportOptions,
  type CreaseExportPalette,
  type CreaseExportTheme,
} from '../lib/creaseExport';
import { cpThumbnailSvg, type CpSegment } from '../lib/creasePatternSegmentation';
import { hasNonClassicCreases, isFlatFoldableFold } from '../lib/creaseExportFold';
import {
  ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS,
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MIN_POINT_SIZE,
  ORISTUDIO_CP_MAX_POINT_SIZE,
} from '../lib/creasePatternViewport';
import type { FoldDocument } from '../engine/types';
import { useFoldedFigurePreview } from '../cp-workspace/folded/useFoldedFigurePreview';
import { useExportLayerOrder, useExportLayerOrderLookup } from '../cp-workspace/export/useExportLayerOrder';
import { exportFigureSpreads, useExportFoldedSpread } from '../cp-workspace/export/useExportFoldedSpread';
import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import { LayerSpreadRows } from './paper/LayerSpreadRows';
import {
  creaseExportFigureColours,
  creaseExportFigureStyle,
  openingCreaseExportFigure,
  useCreaseExportPaper,
} from '../hooks/useCreaseExportPaper';
import type { LayerOrderApplied } from '../lib/layerOrder/layerOrderRequest';
import type { PaperExportStyleChoice } from '../lib/paperExportSettings';
import { useSettingsStore } from '../store/settingsStore';
import { useCommandDialogEscape } from './commandDialogEscape';
import { LayerOrderReadoutReserved, LayerOrderRow } from './paper/LayerOrderRow';
import { PaperStyleRow } from './paperExport/PaperStylePicker';
import { FOLDED_FIGURE_SIDES, type FoldedFigureSide } from '../lib/foldedFigureSides';
import { cpFoldAngleDisplayLabel, cpLineStyleLabel } from '../i18n/enumLabels';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { ColorRow, SegmentedRow } from './ui/fieldRows';
import { SegmentedControl } from './ui/SegmentedControl';
import { Slider } from './ui/Slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/Select';
import { Toggle } from './ui/Toggle';
import styles from './CreaseExportDialog.module.css';

const THUMBNAIL_SIZE = 104;

function thumbnailStrokes(palette: CreaseExportPalette): Record<string, string> {
  return {
    B: palette.border,
    M: palette.mountain,
    V: palette.valley,
    F: palette.flat,
    U: palette.unassigned,
  };
}

// Short labels for the segmented control; the full name is the tooltip. These
// mirror the folded-figure menu in the crease-pattern panel.
function foldedSideLabel(t: TFunction, value: FoldedFigureSide): string {
  switch (value) {
    case 'Front0':
      return t('dialogs:export.foldedSideFront', 'Front');
    case 'Back1':
      return t('dialogs:export.foldedSideBack', 'Back');
  }
}

type SectionId = 'appearance' | 'folded' | 'text';

/** A titled group of controls that collapses from the caret beside its title. */
function ExportSection({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  open: boolean;
  onToggle: (id: SectionId) => void;
  children: ReactNode;
}) {
  return (
    <section className="export-modal__section">
      <button
        type="button"
        className="export-modal__section-toggle"
        aria-expanded={open}
        onClick={() => onToggle(id)}
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          className={`export-modal__section-chevron${open ? ' export-modal__section-chevron--open' : ''}`}
        />
        {title}
      </button>
      {open && <div className="export-modal__section-body">{children}</div>}
    </section>
  );
}

interface PatternOption {
  /** Segment id, or null for "all patterns". */
  id: number | null;
  label: string;
  svg: string;
}

/**
 * The dialog's options as it opens: the folded figure on the style last picked
 * for it, its Front and Back from that style's paper (E15), and the layer
 * spread last saved or shared with, if any (decision 5).
 */
function withOpeningFigure(options: CreaseExportOptions): CreaseExportOptions {
  const { style, colours, spread } = openingCreaseExportFigure();
  return {
    ...options,
    foldedFigureStyle: style,
    foldedFigure: { ...options.foldedFigure, ...colours, ...(spread ? { spread } : {}) },
  };
}

export function CreaseExportDialog({ dialog }: { dialog: CreasePatternExportDialog }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<CreaseExportOptions>(() =>
    withOpeningFigure(dialog.initialOptions)
  );
  const paper = useCreaseExportPaper(options.foldedFigureStyle);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    appearance: true,
    // Folding is the expensive, optional step: it stays out of the way until
    // someone asks for it.
    folded: false,
    text: true,
  });
  useEffect(() => {
    setOptions(withOpeningFigure(dialog.initialOptions));
  }, [dialog.initialOptions]);

  const {
    segmentId,
    lineStyle,
    foldAngleDisplay,
    lineWidth,
    pointSize,
    includeUnassigned,
    showBackgroundColor,
    showGrid,
    theme,
    includeFoldedFigure,
    foldedFigure: foldedSettings,
    caption,
  } = options;

  const multiPattern = dialog.segments.length > 1;
  const scopedSegment = useMemo(
    () =>
      segmentId != null ? (dialog.segments.find((entry) => entry.id === segmentId) ?? null) : null,
    [dialog.segments, segmentId]
  );
  // The layer-order solver assumes every face lands in a plane, so a pattern with
  // partial folds cannot produce a figure — it fails inside the solver with a message
  // about its own data structures. Gate the option rather than let it fail.
  const isFlat = useMemo(
    () => isFlatFoldableFold(dialog.fold, scopedSegment),
    [dialog.fold, scopedSegment]
  );
  // Deliberately not `!isFlat`: a 0° crease is flat-foldable but is not a full fold,
  // and the export draws it faded either way. See `hasNonClassicCreases`.
  const hasFoldAngles = useMemo(
    () => hasNonClassicCreases(dialog.fold, scopedSegment),
    [dialog.fold, scopedSegment]
  );
  // Folding needs a kernel document, and one pattern at a time: "All patterns"
  // has no single folded form to draw beside the sheet.
  const canFold = dialog.foldSegment !== null && (!multiPattern || segmentId !== null) && isFlat;
  const foldSegment = dialog.foldSegment;
  const foldScoped = useCallback(
    (settings: CreaseExportFoldedFigureSettings) => {
      if (!foldSegment) throw new Error('This export cannot fold');
      return foldSegment(scopedSegment, settings);
    },
    [foldSegment, scopedSegment]
  );
  const layerOrderHost = dialog.layerOrderHost ?? null;
  const foldScopedInOrder = useCallback(
    (settings: CreaseExportFoldedFigureSettings, order: LayerOrderApplied) => {
      if (!layerOrderHost) throw new Error('This export cannot fold a chosen layer order');
      return layerOrderHost.foldInOrder(scopedSegment, settings, order);
    },
    [layerOrderHost, scopedSegment]
  );
  const orderFor = useExportLayerOrderLookup();
  // The shared preview fold, the share modal's too: cached by pattern and
  // settings for the dialog's life, since the document cannot change while it
  // is open, and folded in the layer order chosen for these creases, if one
  // is. A failure drops the figure and says why, rather than export something
  // the preview never showed.
  const folded = useFoldedFigurePreview({
    enabled: includeFoldedFigure && canFold,
    settings: foldedSettings,
    fold: canFold && foldSegment ? foldScoped : null,
    foldInOrder: canFold && layerOrderHost ? foldScopedInOrder : null,
    orderFor,
    cacheKeyPrefix: String(segmentId ?? 'all'),
    onError: () => setOptions((current) => ({ ...current, includeFoldedFigure: false })),
  });
  const { figure: foldedFigure, scene: foldedScene, transform: foldedTransform } = folded;
  const patternIndex = segmentId === null ? -1 : dialog.segments.findIndex((entry) => entry.id === segmentId);
  const editLayerOrderRef = useRef<HTMLButtonElement | null>(null);
  const layerOrder = useExportLayerOrder({
    surface: 'crease_export',
    host: layerOrderHost,
    segment: scopedSegment,
    preview: folded,
    settings: foldedSettings,
    style: paper.style,
    // A spread figure opens the dialog on X-ray, so its stepper walks the orders the spread tells apart (D5).
    xray: exportFigureSpreads(includeFoldedFigure && canFold, folded, foldedSettings.spread ?? null),
    // One pattern of several by its label, as the pattern list names it; else the document.
    name:
      multiPattern && patternIndex >= 0
        ? t('dialogs:export.patternN', 'Pattern {{index}}', { index: patternIndex + 1 })
        : (layerOrderHost?.documentName ?? ''),
    setFoldCase: (foldCase) =>
      setOptions((current) => ({ ...current, foldedFigure: { ...current.foldedFigure, foldCase } })),
    scope: dialog.id,
    editRef: editLayerOrderRef,
    t,
  });
  const foldedTurnDeg = layerOrder.turnDeg;
  // The dialog's Escape stands down while the Layer order dialog it opened is up.
  useCommandDialogEscape(dialog.id, layerOrder.ordering);
  // The figure's layers spread, settled into the picture the page paints:
  // prepared once per fold, captured as a setting commits, its bitmap (if it
  // needs one) drawn in the figure's colours.
  const { frontColor, backColor } = foldedSettings;
  const figureStyle = useMemo(
    () => creaseExportPaperStyle(paper.style, { frontColor, backColor }),
    [paper.style, frontColor, backColor]
  );
  const setSpreadSetting = useCallback(
    (spread: LayerSpreadOptions | null) =>
      setOptions((current) => ({ ...current, foldedFigure: { ...current.foldedFigure, spread } })),
    []
  );
  const figureHeight = useMemo(
    () => creaseExportFigureHeight(dialog.fold, dialog.segments, segmentId),
    [dialog.fold, dialog.segments, segmentId]
  );
  const spread = useExportFoldedSpread({
    enabled: includeFoldedFigure && canFold,
    preview: folded,
    setting: foldedSettings.spread ?? null,
    setSetting: setSpreadSetting,
    turnDeg: foldedTurnDeg,
    style: figureStyle,
    figureHeight,
    t,
  });
  const foldedSpread = spread.picture;
  // No status line while the figure folds or spreads: the last picture stays, dimmed.
  const previewBusy = folded.folding || spread.busy;

  const toggleSection = (id: SectionId) =>
    setOpenSections((current) => ({ ...current, [id]: !current[id] }));

  const patch = (next: Partial<CreaseExportOptions>) =>
    setOptions((current) => ({ ...current, ...next }));
  const patchCaption = (next: Partial<CreaseExportCaption>) =>
    setOptions((current) => ({ ...current, caption: { ...current.caption, ...next } }));
  const patchFolded = (next: Partial<CreaseExportFoldedFigureSettings>) =>
    setOptions((current) => ({
      ...current,
      foldedFigure: { ...current.foldedFigure, ...next },
    }));
  // A new style re-seeds Front and Back from its paper; editing them after
  // pins over it, as it always has.
  const pickFoldedStyle = (foldedFigureStyle: PaperExportStyleChoice) => {
    const style = creaseExportFigureStyle(useSettingsStore.getState().paperStyle, foldedFigureStyle);
    setOptions((current) => ({
      ...current,
      foldedFigureStyle,
      foldedFigure: { ...current.foldedFigure, ...creaseExportFigureColours(style) },
    }));
  };

  const palette = creaseExportPalette(theme);

  // The drawn artwork is expensive and independent of the caption, so typing a
  // title only re-runs the cheap layout/compose pass below.
  const artwork = useMemo(
    () =>
      buildCreaseExportArtwork(
        dialog.fold,
        dialog.segments,
        {
          ...DEFAULT_CREASE_EXPORT_OPTIONS,
          segmentId,
          lineStyle,
          foldAngleDisplay,
          lineWidth,
          pointSize,
          includeUnassigned,
          showBackgroundColor,
          showGrid,
          theme,
          includeFoldedFigure,
          foldedFigure: foldedSettings,
        },
        {
          foldedFigure,
          foldedFigureScene: foldedScene,
          paper,
          foldedFigureTransform: foldedTransform,
          grid: dialog.grid,
          ...(foldedTurnDeg !== 0 ? { foldedFigureTurnDeg: foldedTurnDeg } : {}),
          ...(foldedSpread ? { foldedFigureSpread: foldedSpread } : {}),
        }
      ),
    [
      dialog.fold,
      dialog.segments,
      dialog.grid,
      segmentId,
      lineStyle,
      foldAngleDisplay,
      lineWidth,
      pointSize,
      includeUnassigned,
      showBackgroundColor,
      showGrid,
      theme,
      includeFoldedFigure,
      foldedSettings,
      foldedFigure,
      foldedScene,
      paper,
      foldedTransform,
      foldedTurnDeg,
      foldedSpread,
    ]
  );

  const previewSrc = useMemo(() => {
    const page = composeCreaseExportSvg(artwork, caption);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;
  }, [artwork, caption]);

  const patterns = usePatternOptions(dialog.fold, dialog.segments, palette, t);

  // Stepped aside while the Layer order dialog it opened is up: that dialog is
  // workspace-sized and over this one anyway, and a dialog hidden rather than
  // gone would still count as the one on top. Every hook above has run, so the
  // settings and the fold cache are here when it comes back.
  if (layerOrder.ordering) return null;

  const confirmLabel =
    dialog.confirmLabel ??
    t('dialogs:export.confirm', 'Export {{format}}', { format: dialog.format.toUpperCase() });
  const cancelLabel = dialog.cancelLabel ?? t('dialogs:common.cancel', 'Cancel');

  return (
    // A shortcut barrier, as the paper export dialog is: Space on its style
    // picker or its switches is theirs, not the Edit workspace's behind it.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
      data-shortcut-barrier=""
      className="simple-modal"
      onMouseDown={() => cancelCommandDialog(dialog.id)}
    >
      <div
        role="document"
        className="simple-modal__document simple-modal__document--export"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <Download size={15} aria-hidden="true" />
            {dialog.title}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:common.closeNamed', 'Close {{name}}', { name: dialog.title })}
            onClick={() => cancelCommandDialog(dialog.id)}
          >
            <X size={15} />
          </IconButton>
        </header>
        <form
          className={`simple-modal__body export-modal${multiPattern ? ' export-modal--with-patterns' : ''}`}
          onSubmit={(event) => {
            event.preventDefault();
            resolveCommandDialog(dialog.id, {
              options,
              content: {
                foldedFigure,
                foldedFigureScene: foldedScene,
                paper,
                foldedFigureTransform: foldedTransform,
                grid: dialog.grid,
                ...(foldedTurnDeg !== 0 ? { foldedFigureTurnDeg: foldedTurnDeg } : {}),
                foldedFigureLayerOrder: layerOrder.chosen ? 'chosen' : 'default',
                ...(foldedSpread ? { foldedFigureSpread: foldedSpread } : {}),
              },
            });
          }}
        >
          {multiPattern && (
            <div
              className="export-modal__patterns"
              role="listbox"
              aria-label={t('dialogs:export.creasePatternToExport', 'Crease pattern to export')}
            >
              {patterns.map((pattern) => (
                <button
                  key={pattern.id ?? 'all'}
                  type="button"
                  role="option"
                  aria-selected={segmentId === pattern.id}
                  aria-label={pattern.label}
                  title={pattern.label}
                  className={`export-modal__pattern-card${segmentId === pattern.id ? ' export-modal__pattern-card--selected' : ''}`}
                  onClick={() =>
                    patch({
                      segmentId: pattern.id,
                      includeFoldedFigure:
                        pattern.id === null ? false : options.includeFoldedFigure,
                    })
                  }
                >
                  {/* Trusted, locally generated SVG string. */}
                  <span
                    className="export-modal__pattern-thumb"
                    dangerouslySetInnerHTML={{ __html: pattern.svg }}
                  />
                  <span className="export-modal__pattern-label">{pattern.label}</span>
                </button>
              ))}
            </div>
          )}
          {/* No status line while the figure folds or spreads: the last picture stays, dimmed. */}
          <div
            className="export-modal__preview"
            aria-label={t('dialogs:export.preview', 'Export preview')}
            aria-busy={previewBusy || undefined}
          >
            <img className={styles.previewImage} data-busy={previewBusy || undefined} src={previewSrc} alt="" />
          </div>
          <div className="export-modal__controls">
            <ExportSection
              id="appearance"
              title={t('dialogs:export.appearanceSection', 'Appearance')}
              open={openSections.appearance}
              onToggle={toggleSection}
            >
              <div className="export-modal__control-group">
                <SegmentedControl<CreaseExportTheme>
                  aria-label={t('dialogs:export.theme', 'Appearance')}
                  value={theme}
                  onChange={(next) => patch({ theme: next })}
                  options={[
                    { value: 'light', label: t('dialogs:export.themeLight', 'Light') },
                    { value: 'dark', label: t('dialogs:export.themeDark', 'Dark') },
                  ]}
                />
              </div>
              <div className="export-modal__control-group">
                <span className="export-modal__label">
                  {t('dialogs:export.lineStyle', 'Line style')}
                </span>
                <Select
                  value={lineStyle}
                  onValueChange={(next) =>
                    patch({ lineStyle: next as CreaseExportOptions['lineStyle'] })
                  }
                >
                  <SelectTrigger
                    aria-label={t('dialogs:export.lineStyle', 'Line style')}
                    className="export-modal__select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORISTUDIO_CP_LINE_STYLES.map((style) => (
                      <SelectItem key={style} value={style}>
                        {cpLineStyleLabel(t, style)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {/* Only where there is an angle to encode. Unlike the View panel's
                  permanent row, this is a modal: a pattern of full folds should not
                  have to read past a control that would change nothing. */}
              {hasFoldAngles && (
                <div className="export-modal__control-group">
                  <span className="export-modal__label">
                    {t('dialogs:export.foldAngleDisplay', 'Fold angle style')}
                  </span>
                  <Select
                    value={foldAngleDisplay}
                    onValueChange={(next) =>
                      patch({ foldAngleDisplay: next as CreaseExportOptions['foldAngleDisplay'] })
                    }
                  >
                    <SelectTrigger
                      aria-label={t('dialogs:export.foldAngleDisplay', 'Fold angle style')}
                      className="export-modal__select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS.map((display) => (
                        <SelectItem key={display} value={display}>
                          {cpFoldAngleDisplayLabel(t, display)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-line-width">
                  {t('dialogs:export.lineWidth', 'Line width')}
                </label>
                <div className="export-modal__slider-row">
                  <Slider
                    id="export-line-width"
                    aria-label={t('dialogs:export.lineWidth', 'Line width')}
                    min={ORISTUDIO_CP_MIN_LINE_WIDTH}
                    max={ORISTUDIO_CP_MAX_LINE_WIDTH}
                    value={lineWidth}
                    onChange={(next) => patch({ lineWidth: next })}
                  />
                  <output>{lineWidth}</output>
                </div>
              </div>
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-point-size">
                  {t('dialogs:export.pointSize', 'Point size')}
                </label>
                <div className="export-modal__slider-row">
                  <Slider
                    id="export-point-size"
                    aria-label={t('dialogs:export.pointSize', 'Point size')}
                    min={ORISTUDIO_CP_MIN_POINT_SIZE}
                    max={ORISTUDIO_CP_MAX_POINT_SIZE}
                    value={pointSize}
                    onChange={(next) => patch({ pointSize: next })}
                  />
                  <output>{pointSize}</output>
                </div>
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>
                    {t('dialogs:export.includeUnassigned', 'Include flat / unassigned creases')}
                  </span>
                </div>
                <Toggle
                  checked={includeUnassigned}
                  onChange={(next) => patch({ includeUnassigned: next })}
                  aria-label={t(
                    'dialogs:export.includeUnassigned',
                    'Include flat / unassigned creases'
                  )}
                />
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>{t('dialogs:export.showBackgroundColor', 'Show background color')}</span>
                </div>
                <Toggle
                  checked={showBackgroundColor}
                  onChange={(next) => patch({ showBackgroundColor: next })}
                  aria-label={t('dialogs:export.showBackgroundColor', 'Show background color')}
                />
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>{t('dialogs:export.showGrid', 'Show grid lines')}</span>
                  {!dialog.grid && (
                    <small className="export-modal__hint">
                      {t(
                        'dialogs:export.showGridNeedsCp',
                        'Open an editable crease pattern to draw its grid'
                      )}
                    </small>
                  )}
                </div>
                <Toggle
                  checked={showGrid}
                  disabled={!dialog.grid}
                  onChange={(next) => patch({ showGrid: next })}
                  aria-label={t('dialogs:export.showGrid', 'Show grid lines')}
                />
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>{t('dialogs:export.includeFoldedFigure', 'Include folded figure')}</span>
                  {!canFold && (
                    <small className="export-modal__hint">
                      {dialog.foldSegment === null
                        ? t(
                            'dialogs:export.foldedFigureNeedsCp',
                            'Open an editable crease pattern to fold it'
                          )
                        : !isFlat
                          ? t(
                              'dialogs:export.foldedFigureNeedsFlat',
                              'This export folds flat only, and this pattern has creases that are not full folds'
                            )
                          : t(
                              'dialogs:export.foldedFigureNeedsOnePattern',
                              'Select a single pattern to fold'
                            )}
                    </small>
                  )}
                  {folded.error && (
                    <small className="export-modal__hint export-modal__hint--error" role="alert">
                      {folded.error}
                    </small>
                  )}
                </div>
                <Toggle
                  checked={includeFoldedFigure}
                  disabled={!canFold}
                  onChange={(next) => {
                    folded.clearError();
                    patch({ includeFoldedFigure: next });
                    // Its section below opens with it, so its rows are there to see; it
                    // appears under the switch, so nothing being edited moves.
                    if (next) setOpenSections((current) => ({ ...current, folded: true }));
                  }}
                  aria-label={t('dialogs:export.includeFoldedFigure', 'Include folded figure')}
                />
              </div>
            </ExportSection>
            {includeFoldedFigure && canFold && (
              <ExportSection
                id="folded"
                title={t('dialogs:export.foldedFigureSection', 'Folded figure')}
                open={openSections.folded}
                onToggle={toggleSection}
              >
                {/* Rows as the Diagram export's and the sidebars' are: the figure's
                    style, the side it shows, its colours, its layer order, then
                    its layers spread, head-on (no Presentation row). */}
                <div className={styles.foldedRows}>
                  <PaperStyleRow value={options.foldedFigureStyle} onChange={pickFoldedStyle} />
                  <SegmentedRow
                    label={t('dialogs:export.foldedSide', 'Side')}
                    value={foldedSettings.side}
                    options={FOLDED_FIGURE_SIDES.map((value) => ({ id: value, label: foldedSideLabel(t, value) }))}
                    onChange={(side) => patchFolded({ side: side as FoldedFigureSide })}
                  />
                  <ColorRow
                    label={t('dialogs:share.frontColor', 'Front color')}
                    value={foldedSettings.frontColor}
                    onChange={(frontColor) => patchFolded({ frontColor })}
                  />
                  <ColorRow
                    label={t('dialogs:share.backColor', 'Back color')}
                    value={foldedSettings.backColor}
                    onChange={(backColor) => patchFolded({ backColor })}
                  />
                  <LayerOrderRow
                    ref={editLayerOrderRef}
                    pager={{
                      previous: layerOrder.row.previous,
                      next: layerOrder.row.next,
                      readout: layerOrder.row.readout ?? <LayerOrderReadoutReserved />,
                    }}
                    edit={layerOrder.row.edit}
                    disabled={layerOrder.row.disabled}
                    note={layerOrder.row.note?.text}
                    noteKind={layerOrder.row.note?.kind}
                    onEditIntent={layerOrder.prefetch}
                  />
                  <LayerSpreadRows toggle={spread.rows.toggle} spread={spread.rows.spread} />
                </div>
              </ExportSection>
            )}
            <ExportSection
              id="text"
              title={t('dialogs:export.textSection', 'Text')}
              open={openSections.text}
              onToggle={toggleSection}
            >
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-title">
                  {t('dialogs:export.title', 'Title')}
                </label>
                <input
                  id="export-title"
                  type="text"
                  className="export-modal__input"
                  value={caption.title}
                  placeholder={t('dialogs:export.titlePlaceholder', 'Optional')}
                  onChange={(event) => patchCaption({ title: event.currentTarget.value })}
                />
              </div>
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-subtitle">
                  {t('dialogs:export.subtitle', 'Subtitle')}
                </label>
                <input
                  id="export-subtitle"
                  type="text"
                  className="export-modal__input"
                  value={caption.subtitle}
                  placeholder={t('dialogs:export.subtitlePlaceholder', 'Optional')}
                  onChange={(event) => patchCaption({ subtitle: event.currentTarget.value })}
                />
              </div>
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-description">
                  {t('dialogs:export.description', 'Description')}
                </label>
                <textarea
                  id="export-description"
                  rows={3}
                  className="export-modal__input export-modal__textarea"
                  value={caption.description}
                  placeholder={t('dialogs:export.descriptionPlaceholder', 'Optional')}
                  onChange={(event) => patchCaption({ description: event.currentTarget.value })}
                />
              </div>
          
            </ExportSection>
          </div>
          <footer className="simple-modal__footer">
            <Button size="sm" variant="ghost" onClick={() => cancelCommandDialog(dialog.id)}>
              {cancelLabel}
            </Button>
            <Button size="sm" variant="primary" type="submit">
              {confirmLabel}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function usePatternOptions(
  fold: FoldDocument,
  segments: CpSegment[],
  palette: CreaseExportPalette,
  t: ReturnType<typeof useTranslation>['t']
): PatternOption[] {
  return useMemo(() => {
    if (segments.length <= 1) return [];
    const thumbnailOptions = {
      size: THUMBNAIL_SIZE,
      strokes: thumbnailStrokes(palette),
      background: palette.canvas,
    };
    return [
      {
        id: null,
        label: t('dialogs:export.allPatterns', 'All patterns'),
        svg: cpThumbnailSvg(fold, segments, thumbnailOptions),
      },
      ...segments.map((segment, index) => ({
        id: segment.id,
        label: t('dialogs:export.patternN', 'Pattern {{index}}', { index: index + 1 }),
        svg: cpThumbnailSvg(fold, [segment], thumbnailOptions),
      })),
    ];
  }, [fold, segments, palette, t]);
}
