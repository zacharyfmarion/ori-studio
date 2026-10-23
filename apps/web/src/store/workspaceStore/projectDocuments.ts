import { withReferencedAssets } from '../../diagram/document/diagramDocument';
import { readDiagram, writeDiagram } from '../../diagram/document/diagramFile';
import { readFoldReaderState, writeFoldReaderState } from '../../fold/document/foldReaderState';
import { readFoldSequences, writeFoldSequences } from '../../fold/document/foldSequenceFile';
import type {
  NativeProjectDocumentKey,
  NativeProjectDocumentValues,
  NativeProjectFile,
} from '../../lib/nativeProjectFile';
import type { WorkspaceId } from '../../workspaces/workspaces';
import { diagramDataBytes, discardDiagramState, onlyPackedSince, pickDiagramState } from './diagramState';
import { discardFoldState, foldSequenceDataBytes, pickFoldState } from './foldState';
import type { WorkspaceState } from './types';

/**
 * The store fields that say whether the project holds each project document:
 * all the landing and "is there anything here" questions read.
 */
export type ProjectDocumentPresence = Pick<WorkspaceState, 'diagram' | 'foldSequences'>;

/** A project document read from a file, to install once nothing else in the open can reset it. */
export interface ReadProjectDocument {
  /** Whether the file holds one. */
  present: boolean;
  install: (get: () => WorkspaceState) => void;
}

/**
 * A project-level document — the Diagram's, and Fold's sequences — as the
 * project's save and open handle it.
 *
 * Such a document belongs to the project rather than to a design or to the
 * crease pattern, so it survives everything that replaces either, and goes
 * only with the project. Every project-level decision that used to name the
 * diagram asks this registry instead: what each replacement of the project
 * discards, what a failed open puts back, what a save writes and whether it
 * left the project clean, whether a crease pattern can still be saved to an
 * Oriedita file (which has nowhere to put one), whether a project with no
 * crease pattern and no design is still a project, and where it opens.
 */
export interface ProjectDocument<K extends NativeProjectDocumentKey> {
  /** Its key in the file's `workspace` (`nativeProjectFile`'s slot names its reader version). */
  key: K;
  /** Where a project that holds nothing else opens. */
  landing: WorkspaceId;
  /**
   * Read what the file carries, leniently: the value under its key, and the
   * file's `workspace.viewState`, where it keeps how it was being read.
   */
  read: (value: unknown, viewState: Readonly<Record<string, unknown>>) => ReadProjectDocument;
  /** What the file stores, or none. */
  write: (state: WorkspaceState) => NativeProjectDocumentValues[K];
  /**
   * How it was being read, for the file's `workspace.viewState`: entries under
   * keys of its own, none when there is nothing to say. Never history, never
   * a reason to save.
   */
  writeViewState?: (state: WorkspaceState) => Record<string, unknown>;
  isPresent: (state: ProjectDocumentPresence) => boolean;
  /**
   * Whether it changed between two states of the store — an edit made while a
   * save's dialog was up is not in the file, so the save must not report the
   * project clean.
   */
  changedSince: (written: WorkspaceState, now: WorkspaceState) => boolean;
  /** Everything scoped to it, as a replacement of the project leaves it. */
  discard: () => Partial<WorkspaceState>;
  /** Everything scoped to it as it stands, for an open that fails before it replaces the project. */
  pick: (state: WorkspaceState) => Partial<WorkspaceState>;
  /** About how many bytes of pictures and assets the file embeds for it, for the save notice. */
  dataBytes: (state: WorkspaceState) => number;
}

/**
 * The Diagram's documents: a list in the file (`workspace.diagrams`), of which
 * the first is shown and edited, and the rest are carried as they came
 * (`diagramOthers`), so a project holding several loses none of them here.
 */
const DIAGRAMS: ProjectDocument<'diagrams'> = {
  key: 'diagrams',
  landing: 'diagram',
  read: (value) => {
    const [shown, ...others] = Array.isArray(value) ? value : [];
    const read = readDiagram(shown);
    return { present: read !== null, install: (get) => get().installDiagram(read, others) };
  },
  // The one shown, then the project's others as they came; none for a project without one.
  write: ({ diagram, diagramReadOnly, diagramRaw, diagramOthers }) => [
    ...(diagram ? [writeDiagram(diagram, diagramReadOnly ? diagramRaw : null)] : []),
    ...diagramOthers,
  ],
  isPresent: (state) => state.diagram !== null,
  // A layout's packing adopted since is no edit: the file packs the same when it opens (`onlyPackedSince`).
  changedSince: (written, now) => !onlyPackedSince(now.diagram, written.diagram),
  discard: discardDiagramState,
  pick: pickDiagramState,
  dataBytes: ({ diagram, diagramOthers }) =>
    // What the file holds: an asset only undo still refers to is not written.
    diagramDataBytes(diagram && withReferencedAssets(diagram)) +
    // The project's other diagrams are written whole, as they came.
    diagramOthers.reduce((total, other) => total + JSON.stringify(other).length, 0),
};

/** Where Fold keeps its reader state in `workspace.viewState` (plan D6). */
const FOLD_VIEW_STATE_KEY = 'fold';

/**
 * Fold's sequences (implementation-plans/fold-workspace.md, D7): an array,
 * each sequence read on its own — a newer build's opens read-only and is
 * written back as it came. The reader's place rides in `workspace.viewState`,
 * outside the document, and only beside sequences: a project without them is
 * written byte for byte as before Fold existed.
 */
const FOLD_SEQUENCES: ProjectDocument<'foldSequences'> = {
  key: 'foldSequences',
  landing: 'fold',
  read: (value, viewState) => {
    const sequences = readFoldSequences(value);
    const reader = readFoldReaderState(viewState[FOLD_VIEW_STATE_KEY]);
    return { present: sequences.length > 0, install: (get) => get().installFoldSequences(sequences, reader) };
  },
  write: ({ foldSequences }) => writeFoldSequences(foldSequences),
  writeViewState: ({ foldSequences, foldReader }) =>
    foldSequences.length > 0 && foldReader ? { [FOLD_VIEW_STATE_KEY]: writeFoldReaderState(foldReader) } : {},
  isPresent: (state) => state.foldSequences.length > 0,
  // The reader moving is not a change: it is neither history nor a reason to save.
  changedSince: (written, now) => now.foldSequences !== written.foldSequences,
  discard: discardFoldState,
  pick: pickFoldState,
  dataBytes: ({ foldSequences }) => foldSequenceDataBytes(foldSequences),
};

/** Every project document, by its key in the file: a key the file carries with none here is a compile error. */
const PROJECT_DOCUMENTS: { [K in NativeProjectDocumentKey]: ProjectDocument<K> } = {
  diagrams: DIAGRAMS,
  foldSequences: FOLD_SEQUENCES,
};

const DOCUMENTS = Object.values(PROJECT_DOCUMENTS);

/** Let go of every project document, for a replacement of the project. Spread it into the replacing `set`. */
export function discardProjectDocuments(): Partial<WorkspaceState> {
  return DOCUMENTS.reduce<Partial<WorkspaceState>>((state, document) => ({ ...state, ...document.discard() }), {});
}

/** Every project document's scoped state as it stands, to put back with one `set`. */
export function pickProjectDocuments(state: WorkspaceState): Partial<WorkspaceState> {
  return DOCUMENTS.reduce<Partial<WorkspaceState>>((kept, document) => ({ ...kept, ...document.pick(state) }), {});
}

/**
 * Read every project document a file carries, before the open changes
 * anything: whether there is any, and the install that puts each in place.
 */
export function readProjectDocuments(workspace: NativeProjectFile['workspace']): ReadProjectDocument {
  const read = DOCUMENTS.map((document) => document.read(workspace[document.key], workspace.viewState));
  return {
    present: read.some((document) => document.present),
    install: (get) => {
      for (const document of read) document.install(get);
    },
  };
}

/** What a save writes for the project documents: each one's value, none for one the project lacks. */
export function projectDocumentFileValues(state: WorkspaceState): NativeProjectDocumentValues {
  // One entry per key: `PROJECT_DOCUMENTS` is keyed by them.
  return Object.fromEntries(
    DOCUMENTS.map((document) => [document.key, document.write(state)])
  ) as unknown as NativeProjectDocumentValues;
}

/** What a save writes for the file's `workspace.viewState`: how each project document was being read. */
export function projectDocumentViewState(state: WorkspaceState): Record<string, unknown> {
  return DOCUMENTS.reduce<Record<string, unknown>>(
    (viewState, document) => ({ ...viewState, ...document.writeViewState?.(state) }),
    {}
  );
}

/** Whether the project holds any project document. */
export function hasProjectDocument(state: ProjectDocumentPresence): boolean {
  return DOCUMENTS.some((document) => document.isPresent(state));
}

/** Whether any project document changed between `written` and `now`. */
export function projectDocumentsChangedSince(written: WorkspaceState, now: WorkspaceState): boolean {
  return DOCUMENTS.some((document) => document.changedSince(written, now));
}

/** About how many bytes of pictures and assets the file embeds for the project documents. */
export function projectDocumentDataBytes(state: WorkspaceState): number {
  return DOCUMENTS.reduce((total, document) => total + document.dataBytes(state), 0);
}

/**
 * Where a project that holds only project documents opens: the first one's
 * workspace — the Diagram before Fold, as they are listed — or null for none.
 */
export function projectDocumentLanding(state: ProjectDocumentPresence): WorkspaceId | null {
  return DOCUMENTS.find((document) => document.isPresent(state))?.landing ?? null;
}
