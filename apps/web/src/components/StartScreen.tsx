import { DraftingCompass, FilePlus, FolderOpen, PenTool } from 'lucide-react';
import type { ReactNode } from 'react';
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
}

export function StartScreen({
  status,
  errorMessage,
  onCreateCreasePattern,
  onCreateDesign,
  onOpenFile,
}: StartScreenProps) {
  const preparing = status === 'loading_engine';
  const disabled = preparing || status === 'optimizing' || status === 'building_crease_pattern';
  const statusMessage = preparing
    ? 'Preparing the editor...'
    : status === 'error' && errorMessage
      ? errorMessage
      : 'Choose how you want to begin.';

  return (
    <main className="start-screen" aria-busy={preparing || undefined}>
      <section className="start-screen__content" aria-labelledby="start-screen-title">
        <div className="start-screen__hero">
          <div className="start-screen__copy">
            <span className="start-screen__eyebrow">Ori Studio</span>
            <h1 id="start-screen-title">Start a new origami workspace</h1>
            <p>
              Begin with a crease pattern, open an existing file, or sketch the tree
              structure for a new design.
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

        <div className="start-screen__actions" aria-label="Start options">
          <StartAction
            title="Create a CP"
            description="Open a blank editable crease-pattern document with CP drawing tools ready."
            icon={<PenTool size={20} />}
            disabled={disabled}
            onClick={onCreateCreasePattern}
          />
          <StartAction
            title="Open a file"
            description="Open .osf projects or import .cp, .fold, .ori, .orh, .tmd, .tmd4, and .tmd5 files through the shared file workflow."
            icon={<FolderOpen size={20} />}
            disabled={disabled}
            onClick={onOpenFile}
          />
          <StartAction
            title="Create a design"
            description="Start from a blank tree, then optimize it and build a crease pattern."
            icon={<DraftingCompass size={20} />}
            disabled={disabled}
            onClick={onCreateDesign}
          />
        </div>

        <div className="start-screen__status" data-error={status === 'error' || undefined}>
          <FilePlus size={14} />
          <span>{statusMessage}</span>
        </div>
      </section>
    </main>
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
