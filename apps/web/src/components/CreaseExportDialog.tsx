import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  creaseExportPalette,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  type CreaseExportCaption,
  type CreaseExportFoldedFigureSettings,
  type CreaseExportOptions,
  type CreaseExportPalette,
  type CreaseExportTheme,
} from '../lib/creaseExport';
import { cpThumbnailSvg, type CpSegment } from '../lib/creasePatternSegmentation';
import type { CreaseExportFoldResult } from '../lib/creaseExportFold';
import {
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MIN_POINT_SIZE,
  ORISTUDIO_CP_MAX_POINT_SIZE,
} from '../lib/creasePatternViewport';
import type { FoldDocument } from '../engine/types';
import type {
  OristudioCpFoldedFigureState,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import { cpLineStyleLabel } from '../i18n/enumLabels';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
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

const FOLDED_SIDE_OPTIONS: OristudioCpFoldedFigureState[] = [
  'Front0',
  'Back1',
  'Both2',
  'Transparent3',
];

// Short labels for the segmented control; the full name is the tooltip. These
// mirror the folded-figure menu in the crease-pattern panel.
function foldedSideLabel(t: TFunction, value: OristudioCpFoldedFigureState): string {
  switch (value) {
    case 'Front0':
      return t('dialogs:export.foldedSideFrontShort', 'F');
    case 'Back1':
      return t('dialogs:export.foldedSideBackShort', 'B');
    case 'Both2':
      return t('dialogs:export.foldedSideBoth', 'Both');
    default:
      return t('dialogs:export.foldedSideTransparentShort', 'T');
  }
}

function foldedSideTitle(t: TFunction, value: OristudioCpFoldedFigureState): string {
  switch (value) {
    case 'Front0':
      return t('dialogs:export.foldedSideFront', 'Front');
    case 'Back1':
      return t('dialogs:export.foldedSideBack', 'Back');
    case 'Both2':
      return t('dialogs:export.foldedSideBothTitle', 'Both sides');
    default:
      return t('dialogs:export.foldedSideTransparent', 'Transparent');
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

export function CreaseExportDialog({ dialog }: { dialog: CreasePatternExportDialog }) {
  const { t } = useTranslation();
  const [options, setOptions] = useState<CreaseExportOptions>(dialog.initialOptions);
  const [foldedFigure, setFoldedFigure] = useState<OristudioCpFoldedRenderSnapshot | null>(null);
  const [folding, setFolding] = useState(false);
  const [foldError, setFoldError] = useState<string | null>(null);
  const [discoveredCases, setDiscoveredCases] = useState(1);
  const [openSections, setOpenSections] = useState<Record<SectionId, boolean>>({
    appearance: true,
    // Folding is the expensive, optional step: it stays out of the way until
    // someone asks for it.
    folded: false,
    text: true,
  });
  // The document cannot change while the dialog is open, so a pattern folded
  // with the same settings is reused instead of refolded.
  const foldCache = useRef(new Map<string, CreaseExportFoldResult>());

  useEffect(() => {
    setOptions(dialog.initialOptions);
  }, [dialog.initialOptions]);

  const {
    segmentId,
    lineStyle,
    lineWidth,
    pointSize,
    includeUnassigned,
    showBackgroundColor,
    theme,
    includeFoldedFigure,
    foldedFigure: foldedSettings,
    caption,
  } = options;

  const multiPattern = dialog.segments.length > 1;
  // Folding needs a kernel document, and one pattern at a time: "All patterns"
  // has no single folded form to draw beside the sheet.
  const canFold = dialog.foldSegment !== null && (!multiPattern || segmentId !== null);
  const foldSegment = dialog.foldSegment;

  useEffect(() => {
    if (!includeFoldedFigure || !canFold || !foldSegment) {
      setFoldedFigure(null);
      setFolding(false);
      return undefined;
    }

    const key = `${segmentId ?? 'all'}:${foldedSettings.side}:${foldedSettings.frontColor}:${foldedSettings.backColor}:${foldedSettings.foldCase}`;
    const cached = foldCache.current.get(key);
    if (cached) {
      setFoldedFigure(cached.snapshot);
      setDiscoveredCases(cached.discoveredCases);
      setFoldError(null);
      return undefined;
    }

    let cancelled = false;
    setFolding(true);
    setFoldError(null);
    void foldSegment(
      dialog.segments.find((entry) => entry.id === segmentId) ?? null,
      foldedSettings
    )
      .then((result) => {
        foldCache.current.set(key, result);
        if (cancelled) return;
        setFoldedFigure(result.snapshot);
        setDiscoveredCases(result.discoveredCases);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // The preview is the contract: rather than export something the preview
        // never showed, drop the figure and say why.
        setFoldedFigure(null);
        setFoldError(error instanceof Error ? error.message : String(error));
        setOptions((current) => ({ ...current, includeFoldedFigure: false }));
      })
      .finally(() => {
        if (!cancelled) setFolding(false);
      });

    return () => {
      cancelled = true;
    };
  }, [includeFoldedFigure, canFold, foldSegment, segmentId, foldedSettings, dialog.segments]);

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
          lineWidth,
          pointSize,
          includeUnassigned,
          showBackgroundColor,
          theme,
          includeFoldedFigure,
        },
        { foldedFigure }
      ),
    [
      dialog.fold,
      dialog.segments,
      segmentId,
      lineStyle,
      lineWidth,
      pointSize,
      includeUnassigned,
      showBackgroundColor,
      theme,
      includeFoldedFigure,
      foldedFigure,
    ]
  );

  const previewSrc = useMemo(() => {
    const page = composeCreaseExportSvg(artwork, caption);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`;
  }, [artwork, caption]);

  const patterns = usePatternOptions(dialog.fold, dialog.segments, palette, t);

  const confirmLabel =
    dialog.confirmLabel ??
    t('dialogs:export.confirm', 'Export {{format}}', { format: dialog.format.toUpperCase() });
  const cancelLabel = dialog.cancelLabel ?? t('dialogs:common.cancel', 'Cancel');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
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
            resolveCommandDialog(dialog.id, { options, content: { foldedFigure } });
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
          <div
            className="export-modal__preview"
            aria-label={t('dialogs:export.preview', 'Export preview')}
          >
            <img src={previewSrc} alt="" />
          </div>
          <div className="export-modal__controls">
            <ExportSection
              id="appearance"
              title={t('dialogs:export.appearanceSection', 'Appearance')}
              open={openSections.appearance}
              onToggle={toggleSection}
            >
              <div className="export-modal__control-group">
                <span className="export-modal__label">
                  {t('dialogs:export.theme', 'Appearance')}
                </span>
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
                  <span>{t('dialogs:export.includeFoldedFigure', 'Include folded figure')}</span>
                  {!canFold && (
                    <small className="export-modal__hint">
                      {dialog.foldSegment === null
                        ? t(
                            'dialogs:export.foldedFigureNeedsCp',
                            'Open an editable crease pattern to fold it'
                          )
                        : t(
                            'dialogs:export.foldedFigureNeedsOnePattern',
                            'Select a single pattern to fold'
                          )}
                    </small>
                  )}
                  {folding && (
                    <small className="export-modal__hint">
                      {t('dialogs:export.folding', 'Folding…')}
                    </small>
                  )}
                  {foldError && (
                    <small className="export-modal__hint export-modal__hint--error" role="alert">
                      {foldError}
                    </small>
                  )}
                </div>
                <Toggle
                  checked={includeFoldedFigure}
                  disabled={!canFold}
                  onChange={(next) => {
                    setFoldError(null);
                    patch({ includeFoldedFigure: next });
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
                <div className="export-modal__control-group">
                  <span className="export-modal__label">
                    {t('dialogs:export.foldedSide', 'Side')}
                  </span>
                  <SegmentedControl<OristudioCpFoldedFigureState>
                    aria-label={t('dialogs:export.foldedSide', 'Side')}
                    value={foldedSettings.side}
                    onChange={(side) => patchFolded({ side })}
                    options={FOLDED_SIDE_OPTIONS.map((value) => ({
                      value,
                      label: foldedSideLabel(t, value),
                      title: foldedSideTitle(t, value),
                    }))}
                  />
                </div>
                <div className="export-modal__colors">
                  <label className="export-modal__color">
                    <span>{t('dialogs:export.foldedFrontColor', 'Front')}</span>
                    <input
                      type="color"
                      aria-label={t('dialogs:export.foldedFrontColor', 'Front')}
                      value={foldedSettings.frontColor}
                      onChange={(event) =>
                        patchFolded({ frontColor: event.currentTarget.value })
                      }
                    />
                  </label>
                  <label className="export-modal__color">
                    <span>{t('dialogs:export.foldedBackColor', 'Back')}</span>
                    <input
                      type="color"
                      aria-label={t('dialogs:export.foldedBackColor', 'Back')}
                      value={foldedSettings.backColor}
                      onChange={(event) =>
                        patchFolded({ backColor: event.currentTarget.value })
                      }
                    />
                  </label>
                </div>
                <div className="export-modal__control-group">
                  <label className="export-modal__label" htmlFor="export-fold-case">
                    {t('dialogs:export.foldedCase', 'Fold case')}
                  </label>
                  <input
                    id="export-fold-case"
                    type="number"
                    min={1}
                    step={1}
                    className="export-modal__input"
                    value={foldedSettings.foldCase}
                    onChange={(event) => {
                      const next = Number.parseInt(event.currentTarget.value, 10);
                      patchFolded({ foldCase: Number.isFinite(next) ? Math.max(1, next) : 1 });
                    }}
                  />
                  <small className="export-modal__hint">
                    {t('dialogs:export.foldedCasesFound', '{{count}} found so far', {
                      count: discoveredCases,
                    })}
                  </small>
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
