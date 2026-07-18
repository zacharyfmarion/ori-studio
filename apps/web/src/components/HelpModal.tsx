import { useEffect, type ReactElement, type ReactNode } from 'react';
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

const HELP_TOPICS: HelpTopic[] = [
  {
    id: 'files',
    title: 'Start, Open, Save, Export',
    summary: 'Use the start screen or the File menu to manage Ori Studio projects and crease-pattern exports.',
    icon: <FileText size={15} />,
    image: 'files-workflow.png',
    imageAlt: 'File menu showing New, Open, Examples, Save, and export commands',
    caption: 'The File menu keeps project actions, exports, and examples in one place.',
    steps: [
      'New returns to the start screen; Open accepts .osf, .tmd, .tmd4, .tmd5, .fold, .cp, .ori, and .orh files.',
      'File → Examples loads checked-in starter designs.',
      'Save and Save As write Ori Studio project files; use Export for TreeMaker, CP, FOLD, SVG, and PNG formats.',
      'Exports become available when the current document has the data each format needs.',
    ],
  },
  {
    id: 'design',
    title: 'Draw And Edit The Tree',
    summary: 'The Design workspace is the main paper surface for selecting, drawing, connecting, dragging, and viewing tree structure.',
    icon: <MousePointer2 size={15} />,
    image: 'design-workspace.png',
    imageAlt: 'Design pane with tree nodes, edges, labels, leaf circles, zoom controls, and layer controls',
    caption: 'Use the compact viewport controls for zoom, fit, symmetry authoring, and layer visibility.',
    steps: [
      'Select parts directly on the paper; use Shift, Cmd, or Ctrl clicks to build a multi-selection.',
      'Click empty paper to add nodes, or select a node and click empty paper to attach a new edge and node.',
      'Drag nodes to reshape the tree. Space-drag or the zoom controls help move around larger designs.',
      'Toggle paths, leaf circles, labels, and symmetry overlays from the layer menu when the view gets dense.',
    ],
  },
  {
    id: 'inspector',
    title: 'Inspect Selection Details',
    summary: 'The Design workspace Inspector edits selected nodes and edges and summarizes tree paths and conditions.',
    icon: <Square size={15} />,
    image: 'inspector-details.png',
    imageAlt: 'Inspector pane showing editable node label and coordinate fields beside the selected design',
    caption: 'Selection drives the inspector; change labels, coordinates, edge lengths, and stiffness without leaving the workspace.',
    steps: [
      'Select a node to edit its label and paper coordinates.',
      'Select an edge to edit its label, target length, and stiffness, while strain stays report-only.',
      'Select paths or conditions to review their design metadata.',
      'When two nodes are selected, the Inspector can select the path between them for path conditions.',
    ],
  },
  {
    id: 'conditions',
    title: 'Set Paper, Symmetry, And Conditions',
    summary: 'The Conditions pane controls paper size, symmetry presets, and selection-based design constraints.',
    icon: <Waypoints size={15} />,
    image: 'conditions-symmetry.png',
    imageAlt: 'Conditions pane with paper size, symmetry type, advanced symmetry options, and add-from-selection actions',
    caption: 'Conditions are built from the current selection, so select nodes, edges, or paths before adding constraints.',
    steps: [
      'Set paper width and height before tuning exact coordinates.',
      'Choose book, diagonal, or custom symmetry, then use the Design pane mirror tools to author paired leaves.',
      'Add fixed node, node-on-edge, node-on-corner, paired-node, fixed-length, same-strain, and path conditions from selected parts.',
      'Use the condition list to inspect, select, or remove constraints as the model evolves.',
    ],
  },
  {
    id: 'optimize',
    title: 'Optimize And Build CP',
    summary: 'Optimization and crease-pattern generation run through the shared Design menu, toolbar buttons, and native desktop menu.',
    icon: <Sparkles size={15} />,
    image: 'optimize-build.png',
    imageAlt: 'Toolbar showing Optimize Scale and Build CP actions with diagnostics visible',
    caption: 'Ori Studio enables each command only when the document is ready for that step.',
    steps: [
      'Optimize Scale fits the tree to the current paper while preserving the selected TreeMaker model semantics.',
      'Optimize Edges and Optimize Strain are available from the Design menu for deeper optimization workflows.',
      'Build CP turns an optimized tree into creases, facets, fold directions, and folded-base data.',
      'Diagnostics report engine readiness, optimization status, feasibility, and crease-pattern build results.',
    ],
  },
  {
    id: 'crease-pattern',
    title: 'Edit Crease Patterns',
    summary: 'The Edit workspace shows generated or imported crease patterns with role and mountain-valley coloring.',
    icon: <ScanLine size={15} />,
    image: 'crease-pattern-review.png',
    imageAlt: 'Crease Pattern pane showing a generated crease pattern with color mode controls',
    caption: 'Switch between crease-role and mountain-valley color modes depending on what you need to inspect.',
    steps: [
      'Use Color by Crease roles to distinguish axial, gusset, ridge, hinge, and pseudohinge lines.',
      'Crease lines use M/V assignment coloring to show mountains, valleys, flats, and borders.',
      'Use the Edit workspace canvas tools and CP status HUD for crease-pattern selection and diagnostics.',
      'Export SVG or PNG after the crease pattern exists; export FOLD for simulator-ready geometry.',
    ],
  },
  {
    id: 'folding',
    title: 'Simulate The Folded Model',
    summary: 'The Simulate workspace uses the flat-fold artifacts produced from built or imported crease patterns.',
    icon: <Layers3 size={15} />,
    image: 'simulator-folded-base.png',
    imageAlt: 'Simulator pane showing fold controls and folded geometry',
    caption: 'Refresh controls regenerate flat-fold artifacts when a crease pattern changes.',
    steps: [
      'Open Simulate after a crease pattern is built or imported, then drag the viewport to rotate the 3D folded model.',
      'Use the fold slider, play, step, and view controls to inspect the fold motion.',
      'Switch render settings between paper and x-ray views, and toggle faces, edges, and hidden lines.',
      'Generate an Oriedita folded figure directly in the Crease Pattern grid to inspect the flat-folded form.',
    ],
  },
  {
    id: 'workspace',
    title: 'Menus, Layout, Settings',
    summary: 'The app surface is shared between browser and desktop, with web menus, native Tauri menus, workspace layouts, and settings.',
    icon: <LayoutDashboard size={15} />,
    image: 'workspace-settings.png',
    imageAlt: 'Settings modal and app menu showing theme and layout controls',
    caption: 'Reset the pane layout from View or Settings, and choose a theme from the Appearance settings.',
    steps: [
      'Use the left rail or View menu to activate Design, Edit, or Simulate.',
      'Drag pane headers inside a workspace to reorganize it; Reset Layout restores the current workspace default.',
      'Settings contains Appearance themes, keyboard shortcuts, and Workspace layout controls.',
      'Use the Shortcuts settings tab to inspect or rebind file, edit, viewport, and crease-pattern tool commands.',
    ],
  },
];

const ACKNOWLEDGEMENTS = [
  {
    title: 'Robert J. Lang and TreeMaker 5.0.1',
    href: 'https://langorigami.com/article/treemaker/',
    detail:
      "TreeMaker's original model code and behavior are the canonical reference for this Rust, WebAssembly, and desktop port.",
  },
  {
    title: 'Mu-Tsun Tsai and Box Pleating Studio',
    href: 'https://github.com/bp-studio/box-pleating-studio',
    detail:
      "The box-pleated authoring method is a Rust and WebAssembly port of Mu-Tsun Tsai's Box Pleating Studio.",
  },
  {
    title: 'Oriedita',
    href: 'https://github.com/oriedita/oriedita',
    detail:
      'The crease-pattern editor is a Rust and WebAssembly port of the Oriedita editor (itself a fork of Orihime), including its foldability diagnostics, repairs, and file formats.',
  },
  {
    title: 'Amanda Ghassaei and Origami Simulator',
    href: 'https://github.com/amandaghassaei/OrigamiSimulator',
    detail:
      "The Simulate workspace folds bases into an interactive 3D model using a TypeScript port of Amanda Ghassaei's Origami Simulator.",
  },
];

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
          <IconButton size="sm" aria-label={`Close ${title}`} onClick={closeHelp}>
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
  const openAbout = useHelpStore((state) => state.openAbout);

  return (
    <ModalShell
      kind="guide"
      title="Ori Studio Help"
      subtitle="A practical map of the current shared browser and desktop app surface."
      icon={<CircleHelp size={18} />}
      footer={
        <>
          <span>Ori Studio commands are available from the web menubar, native desktop menu, and compact toolbar.</span>
          <Button size="sm" variant="secondary" onClick={openAbout}>
            <Info size={14} />
            About
          </Button>
        </>
      }
    >
      <div className="help-guide">
        <nav className="help-guide__toc" aria-label="Help topics">
          {HELP_TOPICS.map((topic) => (
            <a key={topic.id} href={`#help-${topic.id}`}>
              {topic.icon}
              <span>{topic.title}</span>
            </a>
          ))}
        </nav>
        <div className="help-guide__topics">
          {HELP_TOPICS.map((topic) => (
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
  const openGuide = useHelpStore((state) => state.openGuide);

  return (
    <ModalShell
      kind="about"
      title="About Ori Studio"
      subtitle="A modern shared workspace for designing, editing, and folding origami crease patterns."
      icon={<BookOpen size={18} />}
      footer={
        <Button size="sm" variant="secondary" onClick={openGuide}>
          <CircleHelp size={14} />
          Help
        </Button>
      }
    >
      <div className="about-modal__intro">
        <img src="/favicon.png" alt="" aria-hidden="true" />
        <div>
          <p>
            Ori Studio aims to be the ultimate workspace for origami design and analysis.
            It leans heavily on ports of existing origami tools created by the community
            &mdash; the Edit workspace, for instance, is a port of Oriedita to Rust,
            focused on usability and performance. If you have any suggestions, feel free
            to{' '}
            <a
              href="https://github.com/zacharyfmarion/ori-studio/issues"
              target="_blank"
              rel="noreferrer noopener"
            >
              open an issue on GitHub
            </a>
            .
          </p>
        </div>
      </div>
      <section className="about-modal__section">
        <h3>Acknowledgements</h3>
        <div className="about-modal__ack-list">
          {ACKNOWLEDGEMENTS.map((item) => (
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
