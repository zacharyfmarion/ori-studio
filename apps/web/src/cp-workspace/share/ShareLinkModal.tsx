import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Link2, X } from 'lucide-react';
import { track } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { copyToClipboard } from '../../lib/shareLink';
import {
  buildCreaseExportArtwork,
  composeCreaseExportSvg,
  DEFAULT_CREASE_EXPORT_FOLDED_FIGURE,
  DEFAULT_CREASE_EXPORT_OPTIONS,
  EMPTY_CREASE_EXPORT_CAPTION,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  svgToPngCard,
  type CreaseExportFoldedFigureSettings,
} from '../../lib/creaseExport';
import { isFlatFoldableFold } from '../../lib/creaseExportFold';
import { shareCardTitle } from '../../lib/shareCardText';
import { useFoldedFigurePreview } from '../folded/useFoldedFigurePreview';
import { readRememberedAuthor } from './cpShareService';
import { Button } from '../../components/ui/Button';
import { ColorField } from '../../components/ui/ColorField';
import { IconButton } from '../../components/ui/IconButton';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Toggle } from '../../components/ui/Toggle';
import type { FoldedFigureSide } from '../../lib/foldedFigureSides';

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
  const hasDocument = useWorkspaceStore((state) => state.oristudioCpDocument !== null);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [showFolded, setShowFolded] = useState(false);
  const [side, setSide] = useState<FoldedFigureSide>('Front0');
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

  // The layer-order solver assumes a flat-folded model, so a pattern with partial folds
  // has no figure to draw and fails inside the solver rather than at the boundary. Gate
  // the option instead of offering something that cannot work.
  const isFlat = useMemo(
    () =>
      draft
        ? isFlatFoldableFold(
            draft.fold,
            draft.segments.find((entry) => entry.id === draft.segmentId) ?? null
          )
        : true,
    [draft]
  );
  const canFold = hasDocument && isFlat;

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
  //
  // Deliberately captionless: title and author are *metadata*, not artwork. They ride in
  // the OpenGraph tags, where Discord, Slack and iMessage lay them out in their own
  // typography beside the image. Drawing them into the PNG as well would render them
  // twice, at a size and font we do not control, and would waste card area that the
  // crease pattern should have.
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
    const page = composeCreaseExportSvg(artwork, EMPTY_CREASE_EXPORT_CAPTION);
    return { ...page, background: artwork.palette.canvas };
  }, [draft, showFolded, folded.figure, folded.transform, foldedSettings]);

  // Exactly what the Worker will write into the OpenGraph tags — same helpers, so the
  // preview cannot promise a card the crawler never receives.
  const cardText = {
    title: title.trim() || t('dialogs:share.titlePlaceholder', 'Untitled crease pattern'),
    author: author.trim() || null,
  };
  const shareHost = url ? new URL(url).host : window.location.host;

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
      // Funnel step after `crease pattern shared`. The URL itself is never sent.
      track('share link copied');
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

        {/* Controls left, preview right. The preview is the thing being judged, so it gets
            its own lit surface and stays put while the controls beside it change. */}
        <div className="share-link-modal__columns">
          <div className="share-link-modal__controls">
            <label className="share-link-modal__field">
              <span className="share-link-modal__field-label">
                {t('dialogs:share.title', 'Title')}
              </span>
              <input
                type="text"
                className="ph-no-capture"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={100}
                placeholder={t('dialogs:share.titlePlaceholder', 'Untitled crease pattern')}
              />
            </label>
            <label className="share-link-modal__field">
              <span className="share-link-modal__field-label">
                {t('dialogs:share.author', 'Author')}
              </span>
              <input
                type="text"
                className="ph-no-capture"
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                maxLength={60}
                placeholder={t('dialogs:share.authorPlaceholder', 'Optional')}
              />
            </label>

            <div className="share-link-modal__divider" />

            <div className="share-link-modal__toggle-row">
              <span>
                {t('dialogs:share.foldedFigure', 'Show folded figure')}
                {!isFlat && (
                  <small className="export-modal__hint">
                    {t(
                      'dialogs:share.foldedFigureNeedsFlat',
                      'This preview folds flat only, and this pattern has creases that are not full folds'
                    )}
                  </small>
                )}
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
                <div className="share-link-modal__folded-row">
                  <span className="share-link-modal__folded-label">
                    {t('dialogs:share.side', 'Side')}
                  </span>
                  <SegmentedControl<FoldedFigureSide>
                    aria-label={t('dialogs:share.side', 'Side')}
                    value={side}
                    onChange={setSide}
                    options={[
                      { value: 'Front0', label: t('dialogs:share.sideFront', 'Front') },
                      { value: 'Back1', label: t('dialogs:share.sideBack', 'Back') },
                    ]}
                  />
                </div>
                {/* `inline`, not `row`: a dialog is not an options pane, and the ruled,
                    padded rows a `control-row` draws made three settings look like a table. */}
                <ColorField
                  layout="inline"
                  showValue
                  label={t('dialogs:share.frontColor', 'Front color')}
                  value={frontColor}
                  onChange={setFrontColor}
                />
                <ColorField
                  layout="inline"
                  showValue
                  label={t('dialogs:share.backColor', 'Back color')}
                  value={backColor}
                  onChange={setBackColor}
                />
              </div>
            )}
          </div>

          <div className="share-link-modal__preview-pane">
            <span className="share-link-modal__field-label">
              {t('dialogs:share.linkPreview', 'Link preview')}
            </span>

            <div className="share-embed">
                <div
                  className="share-embed__image"
                  style={{
                    aspectRatio: `${SHARE_CARD_WIDTH} / ${SHARE_CARD_HEIGHT}`,
                    // `svgToPngCard` fills the whole canvas with this before drawing, so the
                    // preview must letterbox against it too — against the app background it
                    // would show a framing the published PNG never has.
                    background: card.background,
                  }}
                >
                  {previewSrc && (
                    <img
                      src={previewSrc}
                      alt={t('dialogs:share.previewAlt', 'Preview of the shared crease pattern')}
                    />
                  )}
                </div>
              <div className="share-embed__meta">
                <div className="share-embed__title">{shareCardTitle(cardText)}</div>
                <div className="share-embed__host">{shareHost}</div>
              </div>
            </div>
          </div>
        </div>

        {/* The link and its primary action live in the footer, so the one thing the dialog
            exists to produce is always in the same place. */}
        <footer className="simple-modal__footer share-link-modal__footer">
          {url ? (
            <>
              <input
                ref={inputRef}
                type="text"
                readOnly
                className="share-link-modal__url ph-no-capture"
                value={url}
                aria-label={t('dialogs:shareLink.url', 'Share link')}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button variant="primary" onClick={() => void copy()}>
                {justCopied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
                {justCopied
                  ? t('dialogs:shareLink.copied', 'Copied')
                  : t('dialogs:shareLink.copy', 'Copy link')}
              </Button>
            </>
          ) : (
            <>
              {/* Same shape as the published state, so the footer does not jump when the
                  link appears — and it answers the question the button raises before it is
                  pressed: nothing has left this machine yet. */}
              <span className="share-link-modal__status">
                {t('dialogs:share.notPublished', 'Nothing is published until you create the link.')}
              </span>
              <Button variant="primary" disabled={publishing} onClick={() => void onPublish()}>
                <Link2 size={14} aria-hidden="true" />
                {publishing
                  ? t('dialogs:share.creating', 'Creating link…')
                  : t('dialogs:share.create', 'Create link')}
              </Button>
            </>
          )}
        </footer>

        {/* The note says what is true *now*: before publishing, that the settings are
            about to be frozen; after, what the recipient actually gets. */}
        <p className="share-link-modal__note">
          {url
            ? t(
                'dialogs:share.scope',
                'Anyone with this link opens their own editable copy — they cannot change your original. Links cannot be deleted or changed once created, and carry the crease pattern only: not reference images, annotations, or saved simulations.'
              )
            : t(
                'dialogs:share.scopeDraft',
                'Set the title, author and figure first: a link is a permanent snapshot — it cannot be edited or deleted afterwards, so changes mean creating another one. Carries the crease pattern only — not reference images, annotations, or saved simulations.'
              )}
        </p>
      </div>
    </div>
  );
}
