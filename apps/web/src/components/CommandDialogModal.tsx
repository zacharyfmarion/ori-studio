import { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Download, Ruler, X } from 'lucide-react';
import {
  cancelCommandDialog,
  registerCommandDialogHost,
  resolveCommandDialog,
  useCommandDialogStore,
} from '../store/commandDialogStore';
import { serializeCreasePatternSvg, type CreaseExportOptions } from '../lib/creaseExport';
import {
  ORISTUDIO_CP_LINE_STYLES,
  ORISTUDIO_CP_LINE_STYLE_LABELS,
  ORISTUDIO_CP_MIN_LINE_WIDTH,
  ORISTUDIO_CP_MAX_LINE_WIDTH,
  ORISTUDIO_CP_MIN_POINT_SIZE,
  ORISTUDIO_CP_MAX_POINT_SIZE,
} from '../lib/creasePatternViewport';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Slider } from './ui/Slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/Select';
import { Toggle } from './ui/Toggle';

export function CommandDialogModal() {
  const dialog = useCommandDialogStore((state) => state.dialog);
  const [draft, setDraft] = useState('');
  const [exportOptions, setExportOptions] = useState<CreaseExportOptions | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => registerCommandDialogHost(), []);

  useEffect(() => {
    if (dialog?.type !== 'number') return;
    setDraft(dialog.initialValue);
    setTouched(false);
  }, [dialog]);

  useEffect(() => {
    if (dialog?.type !== 'crease-export') return;
    setExportOptions(dialog.initialOptions);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelCommandDialog(dialog.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dialog]);

  const activeExportOptions =
    dialog?.type === 'crease-export' ? (exportOptions ?? dialog.initialOptions) : null;
  const exportPreviewSrc = useMemo(() => {
    if (dialog?.type !== 'crease-export' || !activeExportOptions) return '';
    const previewSvg = serializeCreasePatternSvg(dialog.fold, dialog.segments, activeExportOptions);
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(previewSvg)}`;
  }, [dialog, activeExportOptions]);

  if (!dialog) return null;

  const cancelLabel = dialog.cancelLabel ?? 'Cancel';

  if (dialog.type === 'crease-export') {
    const options = activeExportOptions ?? dialog.initialOptions;
    const confirmLabel = dialog.confirmLabel ?? `Export ${dialog.format.toUpperCase()}`;

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
            <IconButton size="sm" aria-label={`Close ${dialog.title}`} onClick={() => cancelCommandDialog(dialog.id)}>
              <X size={15} />
            </IconButton>
          </header>
          <form
            className="simple-modal__body export-modal"
            onSubmit={(event) => {
              event.preventDefault();
              resolveCommandDialog(dialog.id, options);
            }}
          >
            <div className="export-modal__preview" aria-label="Export preview">
              <img src={exportPreviewSrc} alt="" />
            </div>
            <div className="export-modal__controls">
              {dialog.segments.length > 1 && (
                <div className="export-modal__control-group">
                  <span className="export-modal__label">Crease pattern</span>
                  <div className="export-modal__pattern-list" role="listbox" aria-label="Crease pattern to export">
                    <button
                      type="button"
                      role="option"
                      aria-selected={options.segmentId === null}
                      className={`export-modal__pattern${options.segmentId === null ? ' export-modal__pattern--selected' : ''}`}
                      onClick={() =>
                        setExportOptions((current) => ({ ...(current ?? options), segmentId: null }))
                      }
                    >
                      All patterns
                    </button>
                    {dialog.segments.map((segment, index) => (
                      <button
                        key={segment.id}
                        type="button"
                        role="option"
                        aria-selected={options.segmentId === segment.id}
                        className={`export-modal__pattern${options.segmentId === segment.id ? ' export-modal__pattern--selected' : ''}`}
                        onClick={() =>
                          setExportOptions((current) => ({
                            ...(current ?? options),
                            segmentId: segment.id,
                          }))
                        }
                      >
                        Pattern {index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="export-modal__control-group">
                <span className="export-modal__label">Line style</span>
                <Select
                  value={options.lineStyle}
                  onValueChange={(lineStyle) =>
                    setExportOptions((current) => ({
                      ...(current ?? options),
                      lineStyle: lineStyle as CreaseExportOptions['lineStyle'],
                    }))
                  }
                >
                  <SelectTrigger aria-label="Line style" className="export-modal__select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORISTUDIO_CP_LINE_STYLES.map((style) => (
                      <SelectItem key={style} value={style}>
                        {ORISTUDIO_CP_LINE_STYLE_LABELS[style]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-line-width">
                  Line width
                </label>
                <div className="export-modal__slider-row">
                  <Slider
                    id="export-line-width"
                    aria-label="Line width"
                    min={ORISTUDIO_CP_MIN_LINE_WIDTH}
                    max={ORISTUDIO_CP_MAX_LINE_WIDTH}
                    value={options.lineWidth}
                    onChange={(lineWidth) =>
                      setExportOptions((current) => ({ ...(current ?? options), lineWidth }))
                    }
                  />
                  <output>{options.lineWidth}</output>
                </div>
              </div>
              <div className="export-modal__control-group">
                <label className="export-modal__label" htmlFor="export-point-size">
                  Point size
                </label>
                <div className="export-modal__slider-row">
                  <Slider
                    id="export-point-size"
                    aria-label="Point size"
                    min={ORISTUDIO_CP_MIN_POINT_SIZE}
                    max={ORISTUDIO_CP_MAX_POINT_SIZE}
                    value={options.pointSize}
                    onChange={(pointSize) =>
                      setExportOptions((current) => ({ ...(current ?? options), pointSize }))
                    }
                  />
                  <output>{options.pointSize}</output>
                </div>
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>Include flat / unassigned creases</span>
                </div>
                <Toggle
                  checked={options.includeUnassigned}
                  onChange={(includeUnassigned) => {
                    setExportOptions((current) => ({
                      ...(current ?? options),
                      includeUnassigned,
                    }));
                  }}
                  aria-label="Include flat / unassigned creases"
                />
              </div>
              <div className="export-modal__toggle-row">
                <div className="export-modal__toggle-copy">
                  <span>Show background color</span>
                </div>
                <Toggle
                  checked={options.showBackgroundColor}
                  onChange={(showBackgroundColor) => {
                    setExportOptions((current) => ({
                      ...(current ?? options),
                      showBackgroundColor,
                    }));
                  }}
                  aria-label="Show background color"
                />
              </div>
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

  if (dialog.type === 'confirm') {
    const confirmLabel = dialog.confirmLabel ?? 'OK';
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        className="simple-modal"
        onMouseDown={() => cancelCommandDialog(dialog.id)}
      >
        <div role="document" className="simple-modal__document" onMouseDown={(event) => event.stopPropagation()}>
          <header className="simple-modal__header">
            <span>
              <CircleAlert size={15} aria-hidden="true" />
              {dialog.title}
            </span>
            <IconButton size="sm" aria-label={`Close ${dialog.title}`} onClick={() => cancelCommandDialog(dialog.id)}>
              <X size={15} />
            </IconButton>
          </header>
          <div className="simple-modal__body">
            <p className="simple-modal__message">{dialog.message}</p>
            <footer className="simple-modal__footer">
              <Button size="sm" variant="ghost" onClick={() => cancelCommandDialog(dialog.id)}>
                {cancelLabel}
              </Button>
              <Button
                size="sm"
                variant={dialog.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => resolveCommandDialog(dialog.id, true)}
              >
                {confirmLabel}
              </Button>
            </footer>
          </div>
        </div>
      </div>
    );
  }

  const minimum = dialog.minExclusive ?? 0;
  const value = Number.parseFloat(draft);
  const isValid = Number.isFinite(value) && value > minimum;
  const showError = touched && !isValid;
  const confirmLabel = dialog.confirmLabel ?? 'OK';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={dialog.title}
      className="simple-modal"
      onMouseDown={() => cancelCommandDialog(dialog.id)}
    >
      <div role="document" className="simple-modal__document" onMouseDown={(event) => event.stopPropagation()}>
        <header className="simple-modal__header">
          <span>
            <Ruler size={15} aria-hidden="true" />
            {dialog.title}
          </span>
          <IconButton size="sm" aria-label={`Close ${dialog.title}`} onClick={() => cancelCommandDialog(dialog.id)}>
            <X size={15} />
          </IconButton>
        </header>
        <form
          className="simple-modal__body"
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
            if (!isValid) return;
            resolveCommandDialog(dialog.id, value);
          }}
        >
          <label className="field-row">
            <span>{dialog.label}</span>
            <input
              type="number"
              min={minimum}
              step={dialog.step ?? 0.01}
              value={draft}
              autoFocus
              onChange={(event) => {
                setTouched(true);
                setDraft(event.currentTarget.value);
              }}
            />
          </label>
          {dialog.meta && <div className="simple-modal__meta">{dialog.meta}</div>}
          {showError && (
            <div className="simple-modal__error" role="alert">
              Enter a number greater than {minimum}.
            </div>
          )}
          <footer className="simple-modal__footer">
            <Button size="sm" variant="ghost" onClick={() => cancelCommandDialog(dialog.id)}>
              {cancelLabel}
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!isValid}>
              {confirmLabel}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
