import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Ruler, X } from 'lucide-react';
import {
  cancelCommandDialog,
  registerCommandDialogHost,
  resolveCommandDialog,
  useCommandDialogStore,
} from '../store/commandDialogStore';
import { CreaseExportDialog } from './CreaseExportDialog';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

export function CommandDialogModal() {
  const { t } = useTranslation();
  const dialog = useCommandDialogStore((state) => state.dialog);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [optionChecked, setOptionChecked] = useState(false);

  useEffect(() => registerCommandDialogHost(), []);

  useEffect(() => {
    if (dialog?.type !== 'confirm-option') return;
    setOptionChecked(false);
  }, [dialog]);

  useEffect(() => {
    if (dialog?.type !== 'number') return;
    setDraft(dialog.initialValue);
    setTouched(false);
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

  if (!dialog) return null;

  const cancelLabel = dialog.cancelLabel ?? t('dialogs:common.cancel', 'Cancel');

  if (dialog.type === 'crease-export') {
    return <CreaseExportDialog dialog={dialog} />;
  }

  if (dialog.type === 'confirm') {
    const confirmLabel = dialog.confirmLabel ?? t('dialogs:common.ok', 'OK');
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
          className="simple-modal__document"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="simple-modal__header">
            <span>
              <CircleAlert size={15} aria-hidden="true" />
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

  if (dialog.type === 'confirm-option') {
    const confirmLabel = dialog.confirmLabel ?? t('dialogs:common.ok', 'OK');
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
          className="simple-modal__document"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="simple-modal__header">
            <span>
              <CircleAlert size={15} aria-hidden="true" />
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
          <div className="simple-modal__body">
            <p className="simple-modal__message">{dialog.message}</p>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={optionChecked}
                onChange={(event) => setOptionChecked(event.target.checked)}
              />
              {dialog.optionLabel}
            </label>
            <footer className="simple-modal__footer">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => resolveCommandDialog(dialog.id, { confirmed: false, optionChecked })}
              >
                {cancelLabel}
              </Button>
              <Button
                size="sm"
                variant={dialog.tone === 'danger' ? 'danger' : 'primary'}
                onClick={() => resolveCommandDialog(dialog.id, { confirmed: true, optionChecked })}
              >
                {confirmLabel}
              </Button>
            </footer>
          </div>
        </div>
      </div>
    );
  }

  if (dialog.type === 'choice') {
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
          className="simple-modal__document"
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="simple-modal__header">
            <span>
              <CircleAlert size={15} aria-hidden="true" />
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
          <div className="simple-modal__body">
            <p className="simple-modal__message">{dialog.message}</p>
            <div className="choice-dialog__options">
              {dialog.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="choice-dialog__option"
                  data-tone={option.tone === 'danger' ? 'danger' : undefined}
                  onClick={() => resolveCommandDialog(dialog.id, option.id)}
                >
                  <span className="choice-dialog__option-label">{option.label}</span>
                  {option.description && (
                    <span className="choice-dialog__option-description">{option.description}</span>
                  )}
                </button>
              ))}
            </div>
            <footer className="simple-modal__footer">
              <Button size="sm" variant="ghost" onClick={() => cancelCommandDialog(dialog.id)}>
                {cancelLabel}
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
  const confirmLabel = dialog.confirmLabel ?? t('dialogs:common.ok', 'OK');

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
        className="simple-modal__document"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <Ruler size={15} aria-hidden="true" />
            {dialog.title}
          </span>
          <IconButton
            size="sm"
            aria-label={`Close ${dialog.title}`}
            onClick={() => cancelCommandDialog(dialog.id)}
          >
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
              {t('dialogs:number.tooSmall', 'Enter a number greater than {{minimum}}.', {
                minimum,
              })}
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
