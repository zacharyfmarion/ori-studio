import { useEffect, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BookOpen, ExternalLink, X } from 'lucide-react';
import { useHelpStore, type HelpModalKind } from '../store/helpStore';
import { IconButton } from './ui/IconButton';

function acknowledgements(t: TFunction): Array<{ title: string; href: string; detail: string }> {
  return [
    {
      title: t('dialogs:help.acknowledgements.treemaker.title', 'Robert J. Lang and TreeMaker 5.0.1'),
      href: 'https://langorigami.com/article/treemaker/',
      detail: t(
        'dialogs:help.acknowledgements.treemaker.detail',
        "TreeMaker's original model code and behavior are the canonical reference for this Rust, WebAssembly, and desktop port."
      ),
    },
    {
      title: t('dialogs:help.acknowledgements.boxPleatingStudio.title', 'Mu-Tsun Tsai and Box Pleating Studio'),
      href: 'https://github.com/bp-studio/box-pleating-studio',
      detail: t(
        'dialogs:help.acknowledgements.boxPleatingStudio.detail',
        "The box-pleated authoring method is a Rust and WebAssembly port of Mu-Tsun Tsai's Box Pleating Studio."
      ),
    },
    {
      title: t('dialogs:help.acknowledgements.oriedita.title', 'Oriedita'),
      href: 'https://github.com/oriedita/oriedita',
      detail: t(
        'dialogs:help.acknowledgements.oriedita.detail',
        'The crease-pattern editor is a Rust and WebAssembly port of the Oriedita editor (itself a fork of Orihime), including its foldability diagnostics, repairs, and file formats.'
      ),
    },
    {
      title: t('dialogs:help.acknowledgements.origamiSimulator.title', 'Amanda Ghassaei and Origami Simulator'),
      href: 'https://github.com/amandaghassaei/OrigamiSimulator',
      detail: t(
        'dialogs:help.acknowledgements.origamiSimulator.detail',
        "The Simulate workspace folds bases into an interactive 3D model using a TypeScript port of Amanda Ghassaei's Origami Simulator."
      ),
    },
  ];
}

function useCloseOnEscape(closeHelp: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeHelp();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [closeHelp]);
}

function ModalShell({
  kind,
  title,
  subtitle,
  icon,
  children,
  footer,
}: {
  kind: HelpModalKind;
  title: string;
  subtitle: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  const closeHelp = useHelpStore((state) => state.closeHelp);
  useCloseOnEscape(closeHelp);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="help-modal"
      onMouseDown={closeHelp}
    >
      <div
        role="document"
        className={`help-modal__document help-modal__document--${kind}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="help-modal__header">
          <div className="help-modal__heading">
            <span className="help-modal__icon" aria-hidden="true">
              {icon}
            </span>
            <div>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>
          <IconButton size="sm" aria-label={t('dialogs:help.closeLabel', 'Close {{title}}', { title })} onClick={closeHelp}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="help-modal__body">{children}</div>
        {footer && <footer className="help-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

function AboutModal() {
  const { t } = useTranslation();
  const ackList = acknowledgements(t);

  return (
    <ModalShell
      kind="about"
      title={t('dialogs:help.about.title', 'About Ori Studio')}
      subtitle={t(
        'dialogs:help.about.subtitle',
        'A modern shared workspace for designing, editing, and folding origami crease patterns.'
      )}
      icon={<BookOpen size={18} />}
    >
      <div className="about-modal__intro">
        <img src="/favicon.png" alt="" aria-hidden="true" />
        <div>
          <p>
            <Trans i18nKey="dialogs:help.about.intro">
              Ori Studio aims to be the ultimate workspace for origami design and analysis. It
              leans heavily on ports of existing origami tools created by the community — the
              Edit workspace, for instance, is a port of Oriedita to Rust, focused on usability
              and performance. If you have any suggestions, feel free to{' '}
              <a
                href="https://github.com/zacharyfmarion/ori-studio/issues"
                target="_blank"
                rel="noreferrer noopener"
              >
                open an issue on GitHub
              </a>
              .
            </Trans>
          </p>
        </div>
      </div>
      <section className="about-modal__section">
        <h3>{t('dialogs:help.about.acknowledgements', 'Acknowledgements')}</h3>
        <div className="about-modal__ack-list">
          {ackList.map((item) => (
            <a
              key={item.title}
              className="about-modal__ack"
              href={item.href}
              target="_blank"
              rel="noreferrer noopener"
            >
              <strong>
                {item.title}
                <ExternalLink size={13} aria-hidden="true" />
              </strong>
              <p>{item.detail}</p>
            </a>
          ))}
        </div>
      </section>
    </ModalShell>
  );
}

export function HelpModal() {
  const activeModal = useHelpStore((state) => state.activeModal);

  if (activeModal === 'about') return <AboutModal />;
  return null;
}
