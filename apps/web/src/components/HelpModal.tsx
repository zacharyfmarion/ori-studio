import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  BookOpen,
  CircleHelp,
  ExternalLink,
  FileText,
  Info,
  LayoutDashboard,
  Layers3,
  MousePointer2,
  ScanLine,
  Sparkles,
  Square,
  Waypoints,
  X,
} from 'lucide-react';
import { useHelpStore, type HelpModalKind } from '../store/helpStore';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';

interface HelpTopic {
  id: string;
  title: string;
  summary: string;
  icon: ReactElement;
  image: string;
  imageAlt: string;
  caption: string;
  steps: string[];
}

function helpTopics(t: TFunction): HelpTopic[] {
  return [
    {
      id: 'files',
      title: t('dialogs:help.topics.files.title', 'Start, Open, Save, Export'),
      summary: t(
        'dialogs:help.topics.files.summary',
        'Use the start screen or the File menu to manage Ori Studio projects and crease-pattern exports.'
      ),
      icon: <FileText size={15} />,
      image: 'files-workflow.png',
      imageAlt: t(
        'dialogs:help.topics.files.imageAlt',
        'File menu showing New, Open, Examples, Save, and export commands'
      ),
      caption: t(
        'dialogs:help.topics.files.caption',
        'The File menu keeps project actions, exports, and examples in one place.'
      ),
      steps: [
        t(
          'dialogs:help.topics.files.step1',
          'New returns to the start screen; Open accepts .osf, .tmd, .tmd4, .tmd5, .fold, .cp, .ori, and .orh files.'
        ),
        t('dialogs:help.topics.files.step2', 'File → Examples loads checked-in starter designs.'),
        t(
          'dialogs:help.topics.files.step3',
          'Save and Save As write Ori Studio project files; use Export for TreeMaker, CP, FOLD, SVG, and PNG formats.'
        ),
        t(
          'dialogs:help.topics.files.step4',
          'Exports become available when the current document has the data each format needs.'
        ),
      ],
    },
    {
      id: 'design',
      title: t('dialogs:help.topics.design.title', 'Draw And Edit The Tree'),
      summary: t(
        'dialogs:help.topics.design.summary',
        'The Design workspace is the main paper surface for selecting, drawing, connecting, dragging, and viewing tree structure.'
      ),
      icon: <MousePointer2 size={15} />,
      image: 'design-workspace.png',
      imageAlt: t(
        'dialogs:help.topics.design.imageAlt',
        'Design pane with tree nodes, edges, labels, leaf circles, zoom controls, and layer controls'
      ),
      caption: t(
        'dialogs:help.topics.design.caption',
        'Use the compact viewport controls for zoom, fit, symmetry authoring, and layer visibility.'
      ),
      steps: [
        t(
          'dialogs:help.topics.design.step1',
          'Select parts directly on the paper; use Shift, Cmd, or Ctrl clicks to build a multi-selection.'
        ),
        t(
          'dialogs:help.topics.design.step2',
          'Click empty paper to add nodes, or select a node and click empty paper to attach a new edge and node.'
        ),
        t(
          'dialogs:help.topics.design.step3',
          'Drag nodes to reshape the tree. Space-drag or the zoom controls help move around larger designs.'
        ),
        t(
          'dialogs:help.topics.design.step4',
          'Toggle paths, leaf circles, labels, and symmetry overlays from the layer menu when the view gets dense.'
        ),
      ],
    },
    {
      id: 'inspector',
      title: t('dialogs:help.topics.inspector.title', 'Inspect Selection Details'),
      summary: t(
        'dialogs:help.topics.inspector.summary',
        'The Design workspace Inspector edits selected nodes and edges and summarizes tree paths and conditions.'
      ),
      icon: <Square size={15} />,
      image: 'inspector-details.png',
      imageAlt: t(
        'dialogs:help.topics.inspector.imageAlt',
        'Inspector pane showing editable node label and coordinate fields beside the selected design'
      ),
      caption: t(
        'dialogs:help.topics.inspector.caption',
        'Selection drives the inspector; change labels, coordinates, edge lengths, and stiffness without leaving the workspace.'
      ),
      steps: [
        t('dialogs:help.topics.inspector.step1', 'Select a node to edit its label and paper coordinates.'),
        t(
          'dialogs:help.topics.inspector.step2',
          'Select an edge to edit its label, target length, and stiffness, while strain stays report-only.'
        ),
        t('dialogs:help.topics.inspector.step3', 'Select paths or conditions to review their design metadata.'),
        t(
          'dialogs:help.topics.inspector.step4',
          'When two nodes are selected, the Inspector can select the path between them for path conditions.'
        ),
      ],
    },
    {
      id: 'conditions',
      title: t('dialogs:help.topics.conditions.title', 'Set Paper, Symmetry, And Conditions'),
      summary: t(
        'dialogs:help.topics.conditions.summary',
        'The Conditions pane controls paper size, symmetry presets, and selection-based design constraints.'
      ),
      icon: <Waypoints size={15} />,
      image: 'conditions-symmetry.png',
      imageAlt: t(
        'dialogs:help.topics.conditions.imageAlt',
        'Conditions pane with paper size, symmetry type, advanced symmetry options, and add-from-selection actions'
      ),
      caption: t(
        'dialogs:help.topics.conditions.caption',
        'Conditions are built from the current selection, so select nodes, edges, or paths before adding constraints.'
      ),
      steps: [
        t('dialogs:help.topics.conditions.step1', 'Set paper width and height before tuning exact coordinates.'),
        t(
          'dialogs:help.topics.conditions.step2',
          'Choose book, diagonal, or custom symmetry, then use the Design pane mirror tools to author paired leaves.'
        ),
        t(
          'dialogs:help.topics.conditions.step3',
          'Add fixed node, node-on-edge, node-on-corner, paired-node, fixed-length, same-strain, and path conditions from selected parts.'
        ),
        t(
          'dialogs:help.topics.conditions.step4',
          'Use the condition list to inspect, select, or remove constraints as the model evolves.'
        ),
      ],
    },
    {
      id: 'optimize',
      title: t('dialogs:help.topics.optimize.title', 'Optimize And Build CP'),
      summary: t(
        'dialogs:help.topics.optimize.summary',
        'Optimization and crease-pattern generation run through the shared Design menu, toolbar buttons, and native desktop menu.'
      ),
      icon: <Sparkles size={15} />,
      image: 'optimize-build.png',
      imageAlt: t(
        'dialogs:help.topics.optimize.imageAlt',
        'Toolbar showing Optimize Scale and Build CP actions with diagnostics visible'
      ),
      caption: t(
        'dialogs:help.topics.optimize.caption',
        'Ori Studio enables each command only when the document is ready for that step.'
      ),
      steps: [
        t(
          'dialogs:help.topics.optimize.step1',
          'Optimize Scale fits the tree to the current paper while preserving the selected TreeMaker model semantics.'
        ),
        t(
          'dialogs:help.topics.optimize.step2',
          'Optimize Edges and Optimize Strain are available from the Design menu for deeper optimization workflows.'
        ),
        t(
          'dialogs:help.topics.optimize.step3',
          'Build CP turns an optimized tree into creases, facets, fold directions, and folded-base data.'
        ),
        t(
          'dialogs:help.topics.optimize.step4',
          'Diagnostics report engine readiness, optimization status, feasibility, and crease-pattern build results.'
        ),
      ],
    },
    {
      id: 'crease-pattern',
      title: t('dialogs:help.topics.creasePattern.title', 'Edit Crease Patterns'),
      summary: t(
        'dialogs:help.topics.creasePattern.summary',
        'The Edit workspace shows generated or imported crease patterns with role and mountain-valley coloring.'
      ),
      icon: <ScanLine size={15} />,
      image: 'crease-pattern-review.png',
      imageAlt: t(
        'dialogs:help.topics.creasePattern.imageAlt',
        'Crease Pattern pane showing a generated crease pattern with color mode controls'
      ),
      caption: t(
        'dialogs:help.topics.creasePattern.caption',
        'Switch between crease-role and mountain-valley color modes depending on what you need to inspect.'
      ),
      steps: [
        t(
          'dialogs:help.topics.creasePattern.step1',
          'Use Color by Crease roles to distinguish axial, gusset, ridge, hinge, and pseudohinge lines.'
        ),
        t(
          'dialogs:help.topics.creasePattern.step2',
          'Crease lines use M/V assignment coloring to show mountains, valleys, flats, and borders.'
        ),
        t(
          'dialogs:help.topics.creasePattern.step3',
          'Use the Edit workspace canvas tools and CP status HUD for crease-pattern selection and diagnostics.'
        ),
        t(
          'dialogs:help.topics.creasePattern.step4',
          'Export SVG or PNG after the crease pattern exists; export FOLD for simulator-ready geometry.'
        ),
      ],
    },
    {
      id: 'folding',
      title: t('dialogs:help.topics.folding.title', 'Simulate The Folded Model'),
      summary: t(
        'dialogs:help.topics.folding.summary',
        'The Simulate workspace uses the flat-fold artifacts produced from built or imported crease patterns.'
      ),
      icon: <Layers3 size={15} />,
      image: 'simulator-folded-base.png',
      imageAlt: t('dialogs:help.topics.folding.imageAlt', 'Simulator pane showing fold controls and folded geometry'),
      caption: t(
        'dialogs:help.topics.folding.caption',
        'Refresh controls regenerate flat-fold artifacts when a crease pattern changes.'
      ),
      steps: [
        t(
          'dialogs:help.topics.folding.step1',
          'Open Simulate after a crease pattern is built or imported, then drag the viewport to rotate the 3D folded model.'
        ),
        t(
          'dialogs:help.topics.folding.step2',
          'Use the fold slider, play, step, and view controls to inspect the fold motion.'
        ),
        t(
          'dialogs:help.topics.folding.step3',
          'Switch render settings between paper and x-ray views, and toggle faces, edges, and hidden lines.'
        ),
        t(
          'dialogs:help.topics.folding.step4',
          'Generate an Oriedita folded figure directly in the Crease Pattern grid to inspect the flat-folded form.'
        ),
      ],
    },
    {
      id: 'workspace',
      title: t('dialogs:help.topics.workspace.title', 'Menus, Layout, Settings'),
      summary: t(
        'dialogs:help.topics.workspace.summary',
        'The app surface is shared between browser and desktop, with web menus, native Tauri menus, workspace layouts, and settings.'
      ),
      icon: <LayoutDashboard size={15} />,
      image: 'workspace-settings.png',
      imageAlt: t('dialogs:help.topics.workspace.imageAlt', 'Settings modal and app menu showing theme and layout controls'),
      caption: t(
        'dialogs:help.topics.workspace.caption',
        'Reset the pane layout from View or Settings, and choose a theme from the Appearance settings.'
      ),
      steps: [
        t('dialogs:help.topics.workspace.step1', 'Use the left rail or View menu to activate Design, Edit, or Simulate.'),
        t(
          'dialogs:help.topics.workspace.step2',
          'Drag pane headers inside a workspace to reorganize it; Reset Layout restores the current workspace default.'
        ),
        t(
          'dialogs:help.topics.workspace.step3',
          'Settings contains Appearance themes, keyboard shortcuts, and Workspace layout controls.'
        ),
        t(
          'dialogs:help.topics.workspace.step4',
          'Use the Shortcuts settings tab to inspect or rebind file, edit, viewport, and crease-pattern tool commands.'
        ),
      ],
    },
  ];
}

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

function helpAsset(filename: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${base}help/${filename}`;
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

function GuideModal() {
  const { t } = useTranslation();
  const openAbout = useHelpStore((state) => state.openAbout);
  const topics = helpTopics(t);

  return (
    <ModalShell
      kind="guide"
      title={t('dialogs:help.guide.title', 'Ori Studio Help')}
      subtitle={t(
        'dialogs:help.guide.subtitle',
        'A practical map of the current shared browser and desktop app surface.'
      )}
      icon={<CircleHelp size={18} />}
      footer={
        <>
          <span>
            {t(
              'dialogs:help.guide.footer',
              'Ori Studio commands are available from the web menubar, native desktop menu, and compact toolbar.'
            )}
          </span>
          <Button size="sm" variant="secondary" onClick={openAbout}>
            <Info size={14} />
            {t('dialogs:help.guide.about', 'About')}
          </Button>
        </>
      }
    >
      <div className="help-guide">
        <nav className="help-guide__toc" aria-label={t('dialogs:help.guide.topicsNav', 'Help topics')}>
          {topics.map((topic) => (
            <a key={topic.id} href={`#help-${topic.id}`}>
              {topic.icon}
              <span>{topic.title}</span>
            </a>
          ))}
        </nav>
        <div className="help-guide__topics">
          {topics.map((topic) => (
            <section key={topic.id} id={`help-${topic.id}`} className="help-topic">
              <div className="help-topic__copy">
                <span className="help-topic__eyebrow">{topic.title}</span>
                <h3>{topic.summary}</h3>
                <ul>
                  {topic.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
              </div>
              <figure className="help-topic__figure">
                <img src={helpAsset(topic.image)} alt={topic.imageAlt} loading="lazy" />
                <figcaption>{topic.caption}</figcaption>
              </figure>
            </section>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}

function AboutModal() {
  const { t } = useTranslation();
  const openGuide = useHelpStore((state) => state.openGuide);
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
      footer={
        <Button size="sm" variant="secondary" onClick={openGuide}>
          <CircleHelp size={14} />
          {t('dialogs:help.about.help', 'Help')}
        </Button>
      }
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

  if (activeModal === 'guide') return <GuideModal />;
  if (activeModal === 'about') return <AboutModal />;
  return null;
}
