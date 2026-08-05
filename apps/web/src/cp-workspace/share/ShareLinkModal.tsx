import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, Link2, X } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { copyToClipboard } from '../../lib/shareLink';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';

/**
 * The share-link modal for one crease pattern.
 *
 * Reads the link from the store rather than from the selection: every selection
 * toolbar action clears the selection as it runs, which unmounts the toolbar, so
 * anything owned by the toolbar would vanish the moment it opened.
 *
 * Nothing is copied or focused on open. Writing to someone's clipboard as a
 * side effect of opening a dialog is a surprise — it silently replaces whatever
 * they had — so copying stays an explicit act: click Copy, or select the text.
 */
export function ShareLinkModal() {
  const { t } = useTranslation();
  const link = useWorkspaceStore((state) => state.oristudioCpShareLink);
  const dismiss = useWorkspaceStore((state) => state.dismissOristudioCpShareLink);
  const [justCopied, setJustCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!link) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismiss, link]);

  if (!link) return null;

  const copy = async () => {
    if (await copyToClipboard(link.url)) {
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
          <div className="share-link-modal__row">
            <input
              ref={inputRef}
              type="text"
              readOnly
              className="share-link-modal__url ph-no-capture"
              value={link.url}
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

          <p className="share-link-modal__meta">
            {t('dialogs:shareLink.summary', '{{creases}} creases · {{chars}} characters', {
              creases: link.creaseCount,
              chars: link.url.length,
            })}
          </p>

          {link.long ? (
            <div className="share-link-modal__warning" role="status">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>
                {t(
                  'dialogs:shareLink.longWarning',
                  'This link works in a browser address bar, but some chat apps and email clients cut off links this long. Sending an exported file is more reliable.'
                )}
              </span>
            </div>
          ) : null}

          <p className="share-link-modal__note">
            {t(
              'dialogs:shareLink.scope',
              'Carries the crease pattern only — not reference images, annotations, or saved simulations.'
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
