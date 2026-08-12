import { DraftingCompass, FilePlus, FolderOpen, PenTool } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppStatus } from '../lib/sampleProject';

const publicAssetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;
const creasePatternPreviewSrc = `${publicAssetBase}start/crease-pattern-preview.png`;

interface StartScreenProps {
  status: AppStatus;
  errorMessage: string | null;
  onCreateCreasePattern: () => void;
  onCreateDesign: () => void;
  onOpenFile: () => void;
  showWelcomeOnStartup: boolean;
  onToggleShowWelcomeOnStartup: (value: boolean) => void;
}

export function StartScreen({
  status,
  errorMessage,
  onCreateCreasePattern,
  onCreateDesign,
  onOpenFile,
  showWelcomeOnStartup,
  onToggleShowWelcomeOnStartup,
}: StartScreenProps) {
  const { t } = useTranslation();
  const preparing = status === 'loading_engine';
  const disabled = preparing || status === 'optimizing' || status === 'building_crease_pattern';
  const statusMessage = preparing
    ? t('dialogs:startScreen.preparing', 'Preparing the editor...')
    : status === 'error' && errorMessage
      ? errorMessage
      : t('dialogs:startScreen.chooseBegin', 'Choose how you want to begin.');

  return (
    // A div, not the page's `main`: the start screen is the first screenful of
    // the welcome page, which owns the landmark and the landing below it. The
    // labelled region inside is still the section.
    <div className="start-screen" aria-busy={preparing || undefined}>
      <section className="start-screen__content" aria-labelledby="start-screen-title">
        <div className="start-screen__hero">
          <div className="start-screen__copy">
            {/* eslint-disable-next-line i18next/no-literal-string -- brand name, never translated */}
            <span className="start-screen__eyebrow">Ori Studio</span>
            <h1 id="start-screen-title">{t('dialogs:startScreen.title', 'Start a new origami workspace')}</h1>
            <p>
              {t(
                'dialogs:startScreen.description',
                'Begin with a crease pattern, open an existing file, or sketch the tree structure for a new design.'
              )}
            </p>
          </div>
          <div className="start-screen__preview" aria-hidden="true">
            <div className="start-screen__preview-frame">
              <img
                className="start-screen__preview-image"
                src={creasePatternPreviewSrc}
                alt=""
                decoding="async"
              />
            </div>
          </div>
        </div>

        <div className="start-screen__actions" aria-label={t('dialogs:startScreen.startOptions', 'Start options')}>
          <StartAction
            title={t('dialogs:startScreen.createCp.title', 'Create a CP')}
            description={t(
              'dialogs:startScreen.createCp.description',
              'Open a blank editable crease-pattern document with CP drawing tools ready.'
            )}
            icon={<PenTool size={20} />}
            disabled={disabled}
            onClick={onCreateCreasePattern}
          />
          <StartAction
            title={t('dialogs:startScreen.openFile.title', 'Open a file')}
            description={t(
              'dialogs:startScreen.openFile.description',
              'Open .osf projects or import .cp, .fold, .ori, .orh, .tmd, .tmd4, and .tmd5 files through the shared file workflow.'
            )}
            icon={<FolderOpen size={20} />}
            disabled={disabled}
            onClick={onOpenFile}
          />
          <StartAction
            title={t('dialogs:startScreen.createDesign.title', 'Create a design')}
            description={t(
              'dialogs:startScreen.createDesign.description',
              'Start from a blank tree, then optimize it and build a crease pattern.'
            )}
            icon={<DraftingCompass size={20} />}
            disabled={disabled}
            onClick={onCreateDesign}
          />
        </div>

        <div className="start-screen__footer">
          <div className="start-screen__status" data-error={status === 'error' || undefined}>
            <FilePlus size={14} />
            <span>{statusMessage}</span>
          </div>
          <label className="start-screen__startup-toggle">
            <input
              type="checkbox"
              checked={showWelcomeOnStartup}
              onChange={(event) => onToggleShowWelcomeOnStartup(event.target.checked)}
            />
            {t('dialogs:startScreen.showWelcomeOnStartup', 'Show welcome on startup')}
          </label>
        </div>
      </section>
    </div>
  );
}

interface StartActionProps {
  title: string;
  description: string;
  icon: ReactNode;
  disabled: boolean;
  onClick: () => void;
}

function StartAction({ title, description, icon, disabled, onClick }: StartActionProps) {
  return (
    <button
      type="button"
      className="start-action"
      disabled={disabled}
      onClick={onClick}
    >
      <span className="start-action__icon">{icon}</span>
      <span className="start-action__text">
        <span className="start-action__title">{title}</span>
        <span className="start-action__description">{description}</span>
      </span>
    </button>
  );
}
