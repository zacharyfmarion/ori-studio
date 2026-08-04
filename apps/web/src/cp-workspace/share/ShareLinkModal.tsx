import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, X } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { copyToClipboard } from '../../lib/shareLink';
import {
  buildCreaseExportArtwork,
  composeCreaseExportSvg,
  DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  svgToPngCard,
  type CreaseExportFoldedFigureSettings,
} from '../../lib/creaseExport';
import { useFoldedFigurePreview } from '../folded/useFoldedFigurePreview';
import { readRememberedAuthor } from './cpShareService';
import { Button } from '../../components/ui/Button';
import { ColorField } from '../../components/ui/ColorField';
import { IconButton } from '../../components/ui/IconButton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Toggle } from '../../components/ui/Toggle';
import type { OristudioCpFoldedFigureState } from '../../engine/oristudioCpTypes';

/** Only front and back: `Both2` and `Transparent3` exist but are export-dialog territory. */
type ShareFoldedSide = Extract<OristudioCpFoldedFigureState, 'Front0' | 'Back1'>;

/**
 * The share modal for one crease pattern.
 *
 * Reads its draft from the store rather than from the selection: every selection-toolbar
 * action clears the selection as it runs, which unmounts the toolbar, so anything the
 * toolbar owned would vanish the moment this opened.
 *
 * Nothing is copied or focused on open. Writing to someone's clipboard as a side effect
 * of opening a dialog is a surprise — it silently replaces whatever they had — so copying
 * stays an explicit act: click Copy, or select the text.
 *
 * The controls are deliberately a fraction of the export dialog's. A social card is a
 * preview, not a deliverable; line style, width, point size, theme and background do not
 * earn a decision here, so they take `DEFAULT_CREASE_EXPORT_OPTIONS`. Title and author are
 * not controls at all — they are drawn *into* the card, through the same caption block
 * the export layout already lays out.
 */
export function ShareLinkModal() {
  const { t } = useTranslation();
  const draft = useWorkspaceStore((state) => state.oristudioCpShareDraft);
  const dismiss = useWorkspaceStore((state) => state.dismissOristudioCpShare);
  const publish = useWorkspaceStore((state) => state.publishOristudioCpShare);
  const foldShareFigure = useWorkspaceStore((state) => state.foldOristudioCpShareFigure);
  const canFold = useWorkspaceStore((state) => state.oristudioCpDocument !== null);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [showFolded, setShowFolded] = useState(false);
  const [side, setSide] = useState<ShareFoldedSide>('Front0');
  const [frontColor, setFrontColor] = useState(DEFAULT_CREASE_EXPORT_FOLDED_FIGURE.frontColor);
  const [backColor, setBackColor] = useState(DEFAULT_CREASE_EXPORT_FOLDED_FIGURE.backColor);
  const [publishing, setPublishing] = useState(false);
  const [justCopied, setJustCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const open = draft !== null;
  const url = draft?.url ?? null;

  useEffect(() => {
    if (!open) return;
    setAuthor(readRememberedAuthor());
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismiss, open]);

  const foldedSettings: CreaseExportFoldedFigureSettings = useMemo(
    () => ({ side, frontColor, backColor, foldCase: 1 }),
    [side, frontColor, backColor]
  );

  const foldFn = useCallback(
    (settings: CreaseExportFoldedFigureSettings) => foldShareFigure(settings),
    [foldShareFigure]
  );

  const folded = useFoldedFigurePreview({
    enabled: open && showFolded && canFold,
    settings: foldedSettings,
    fold: canFold ? foldFn : null,
    cacheKeyPrefix: String(draft?.segmentId ?? ''),
    onError: () => setShowFolded(false),
  });

  // The card is composed from the same primitives the export dialog previews with, so
  // what is published is what was shown.
  const card = useMemo(() => {
    if (!draft) return null;
    const artwork = buildCreaseExportArtwork(
      draft.fold,
      draft.segments,
      {
        ...DEFAULT_CREASE_EXPORT_OPTIONS,
        segmentId: draft.segmentId,
        includeFoldedFigure: showFolded && folded.figure !== null,
        foldedFigure: foldedSettings,
      },
      { foldedFigure: folded.figure, foldedFigureTransform: folded.transform }
    );
    const page = composeCreaseExportSvg(artwork, {
      title: title.trim(),
      subtitle: author.trim() ? t('dialogs:share.byLine', 'by {{author}}', { author: author.trim() }) : '',
      description: '',
    });
    return { ...page, background: artwork.palette.canvas };
  }, [draft, showFolded, folded.figure, folded.transform, foldedSettings, title, author, t]);

  const previewSrc = useMemo(
    () => (card ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(card.svg)}` : null),
    [card]
  );

  if (!draft || !card) return null;

  const renderCard = async (): Promise<Uint8Array | null> => {
    try {
      return await svgToPngCard(card.svg, card.width, card.height, { background: card.background });
    } catch (error) {
      // A card is decoration; the Worker serves a generic one when R2 has nothing, so a
      // failure here must never take the share link down with it.
      console.warn('[share] preview card render failed:', error);
      return null;
    }
  };

  const onPublish = async () => {
    setPublishing(true);
    try {
      await publish({ title: title.trim(), author: author.trim() || null, renderCard });
    } finally {
      setPublishing(false);
    }
  };

  const copy = async () => {
    if (!url) return;
    if (await copyToClipboard(url)) {
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1500);
    } else {
      inputRef.current?.select();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:shareLink.title', 'Share crease pattern')}
      className="simple-modal"
      onMouseDown={dismiss}
    >
      <div
        role="document"
        className="simple-modal__document share-link-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <Link2 size={15} aria-hidden="true" />
            {t('dialogs:shareLink.title', 'Share crease pattern')}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:shareLink.close', 'Close share')}
            onClick={dismiss}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="simple-modal__body">
          <div
            className="share-link-modal__preview"
            style={{ aspectRatio: `${SHARE_CARD_WIDTH} / ${SHARE_CARD_HEIGHT}` }}
          >
            {previewSrc && (
              <img
                src={previewSrc}
                alt={t('dialogs:share.previewAlt', 'Preview of the shared crease pattern')}
              />
            )}
          </div>

          <div className="share-link-modal__fields">
            <label className="share-link-modal__field">
              <span>{t('dialogs:share.title', 'Title')}</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                placeholder={t('dialogs:share.titlePlaceholder', 'Untitled crease pattern')}
              />
            </label>
            <label className="share-link-modal__field">
              <span>{t('dialogs:share.author', 'Author')}</span>
              <input
                type="text"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                maxLength={60}
                placeholder={t('dialogs:share.authorPlaceholder', 'Optional')}
              />
            </label>
          </div>

          <div className="share-link-modal__toggle-row">
            <span>
              {t('dialogs:share.foldedFigure', 'Show folded figure')}
              {folded.folding && (
                <small className="export-modal__hint">
                  {t('dialogs:share.folding', 'Folding…')}
                </small>
              )}
              {folded.error && (
                <small className="export-modal__hint export-modal__hint--error" role="alert">
                  {folded.error}
                </small>
              )}
            </span>
            <Toggle
              checked={showFolded}
              disabled={!canFold}
              onChange={(next) => {
                folded.clearError();
                setShowFolded(next);
              }}
              aria-label={t('dialogs:share.foldedFigure', 'Show folded figure')}
            />
          </div>

          {showFolded && canFold && (
            <div className="share-link-modal__folded">
              <div className="export-modal__control-group">
                <span className="export-modal__label">
                  {t('dialogs:share.side', 'Side')}
                </span>
                <SegmentedControl<ShareFoldedSide>
                  aria-label={t('dialogs:share.side', 'Side')}
                  value={side}
                  onChange={setSide}
                  options={[
                    { value: 'Front0', label: t('dialogs:share.sideFront', 'Front') },
                    { value: 'Back1', label: t('dialogs:share.sideBack', 'Back') },
                  ]}
                />
              </div>
              <ColorField
                label={t('dialogs:share.frontColor', 'Front color')}
                value={frontColor}
                onChange={setFrontColor}
              />
              <ColorField
                label={t('dialogs:share.backColor', 'Back color')}
                value={backColor}
                onChange={setBackColor}
              />
            </div>
          )}

          {url ? (
            <div className="share-link-modal__row">
              <input
                ref={inputRef}
                type="text"
                readOnly
                className="share-link-modal__url"
                value={url}
                aria-label={t('dialogs:shareLink.url', 'Share link')}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button onClick={() => void copy()}>
                {justCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {justCopied
                  ? t('dialogs:shareLink.copied', 'Copied')
                  : t('dialogs:shareLink.copy', 'Copy')}
              </Button>
            </div>
          ) : (
            <Button variant="primary" disabled={publishing} onClick={() => void onPublish()}>
              {publishing
                ? t('dialogs:share.creating', 'Creating link…')
                : t('dialogs:share.create', 'Create share link')}
            </Button>
          )}

          <p className="share-link-modal__meta">
            {t('dialogs:shareLink.summary', '{{creases}} creases', {
              creases: draft.creaseCount,
            })}
          </p>

          <p className="share-link-modal__note">
            {t(
              'dialogs:share.scope',
              'Anyone with this link can view it, and links cannot be deleted or changed. Carries the crease pattern only — not reference images, annotations, or saved simulations.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
