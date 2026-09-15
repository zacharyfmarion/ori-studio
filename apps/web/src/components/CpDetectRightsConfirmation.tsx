import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from './ui/Button';

interface CpDetectRightsConfirmationProps {
  /** The picked image by URL and size — never its pixels (see the modal's `cropSource`). */
  image: { url: string; width: number; height: number };
  /** Something the dialog cannot interrupt is running; Back waits for it. */
  busy: boolean;
  /** What that something is, for the footer, or `null`. */
  status: string | null;
  /** What went wrong under the gate — a rectification that failed, most likely. */
  error: string | null;
  onConfirm: () => void;
  onBack: () => void;
}

/**
 * The rights gate between an image loading and the crop step.
 *
 * A crease pattern is its designer's work, and this is where the person
 * detecting one says they are entitled to. It is asked about the image on
 * screen — the dialog resets the answer for every image it loads — and the
 * tick is the affirmative act: Continue does nothing until it is given.
 *
 * The first rectification runs underneath, and the footer says so. Back is
 * refused while it runs, on the same rule as the dialog's close button: a
 * discarded session must not receive a late result. Continue is not — the
 * crop step already draws itself around a rectification still in flight.
 */
export function CpDetectRightsConfirmation({
  image,
  busy,
  status,
  error,
  onConfirm,
  onBack,
}: CpDetectRightsConfirmationProps) {
  const { t } = useTranslation();
  const [attested, setAttested] = useState(false);
  return (
    <div className="cp-detect-modal__rights" data-testid="cp-detect-rights">
      <img
        className="cp-detect-modal__rights-image"
        src={image.url}
        width={image.width}
        height={image.height}
        alt=""
        draggable={false}
      />
      <p className="cp-detect-modal__rights-lead">
        {t(
          'dialogs:cpDetectImport.rights.lead',
          'Crease patterns are their designers’ work. Detect only a pattern you have the right to use: one you designed, one that was published for others to fold, or one whose designer gave you permission. The image is processed on this device and is never uploaded.'
        )}
      </p>
      <label className="settings-checkbox cp-detect-modal__rights-attest">
        <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} />
        {t(
          'dialogs:cpDetectImport.rights.attest',
          'I confirm that this crease pattern was obtained legally and that I have the right to use it.'
        )}
      </label>
      {error && <div className="cp-detect-modal__error">{error}</div>}
      <footer className="cp-detect-modal__rights-footer">
        {/* In the footer's own row, so its coming and going moves no button. */}
        <span className="cp-detect-modal__rights-status">
          {status && (
            <>
              <Loader2 size={14} className="cp-detect-modal__spinner" />
              {status}
            </>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={onBack} disabled={busy}>
          {t('dialogs:cpDetectImport.rights.back', 'Back')}
        </Button>
        <Button size="sm" variant="primary" onClick={onConfirm} disabled={!attested}>
          {t('dialogs:cpDetectImport.rights.continue', 'Continue')}
        </Button>
      </footer>
    </div>
  );
}
