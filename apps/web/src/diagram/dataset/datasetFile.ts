/**
 * A corpus file opened as the app opens it, and the file check. Test-only.
 *
 * Opening mirrors `loadNativeProject` and the project-documents registry:
 * `parseNativeProjectFile` (which migrates older shapes and recomputes the
 * reader version), the first diagram read with `readDiagram`, Fold's
 * sequences read, and the store slice a save reads assembled as
 * `installDiagram` leaves it. Ids the reader would mint at random are fixed,
 * so two runs agree.
 *
 * The check is of the diagram side only, which is exact headless:
 * `projectDocumentFileValues` is what a save writes for it. The rest of a
 * saved file — the crease pattern from the kernel, the design payloads from
 * their engines — is the store's, and only approximable here.
 */
import { isRecord } from '../../lib/documentFile';
import { NATIVE_PROJECT_READER_VERSION, parseNativeProjectFile, type NativeProjectFile } from '../../lib/nativeProjectFile';
import { readFoldReaderState } from '../../fold/document/foldReaderState';
import { readFoldSequences, type HeldFoldSequence } from '../../fold/document/foldSequenceFile';
import { discardDiagramState } from '../../store/workspaceStore/diagramState';
import { discardFoldState, settledFoldReader } from '../../store/workspaceStore/foldState';
import { projectDocumentFileValues } from '../../store/workspaceStore/projectDocuments';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import { isKnownAsset, isLockedStep, isLockedTurn, isTurn, type DiagramDocument } from '../document/diagramDocument';
import { readDiagram, storedSceneJson, type ReadDiagram } from '../document/diagramFile';
import { digest } from '../pictures/pictureKey';
import { sha256, type CorpusCase } from './datasetCorpus';
import type { FileRecord } from './datasetResults';

/** The same ids on every run, for a diagram or sequence the file gives none. */
const newId = (prefix: string) => `${prefix}-corpus`;

export interface OpenedProject {
  project: NativeProjectFile;
  /** The file's own reader stamp: parsing recomputes it from the content. */
  stamp: unknown;
  /** The first diagram as the file holds it. */
  shown: Record<string, unknown> | null;
  read: ReadDiagram | null;
  diagram: DiagramDocument | null;
  foldSequences: HeldFoldSequence[];
  /** The crease-pattern document, for the kernel; null for a project without one. */
  creasePattern: unknown;
  /** The store slice a save reads, as an untouched open leaves it. */
  state: WorkspaceState;
}

function openParsed(project: NativeProjectFile): Omit<OpenedProject, 'stamp'> {
  const [shown, ...others] = project.workspace.diagrams ?? [];
  // No sanitizeEnv: the app's own default, which the suite's jsdom provides.
  const read = readDiagram(shown, { newId });
  const foldSequences = readFoldSequences(project.workspace.foldSequences, { newId });
  const reader = readFoldReaderState((project.workspace.viewState as Record<string, unknown> | undefined)?.fold);
  const state = {
    ...discardDiagramState(),
    ...discardFoldState(),
    diagram: read?.document ?? null,
    diagramReadOnly: read?.readOnly ?? false,
    diagramRaw: read?.readOnly ? read.raw : null,
    diagramOthers: others,
    foldSequences,
    foldReader: settledFoldReader(reader, foldSequences),
  } as unknown as WorkspaceState;
  return {
    project,
    shown: isRecord(shown) ? shown : null,
    read,
    diagram: read?.document ?? null,
    foldSequences,
    creasePattern: project.workspace.creasePattern?.creasePattern.document ?? null,
    state,
  };
}

export function openCorpusProject(text: string): OpenedProject {
  const stamp = (JSON.parse(text) as { minimumReaderSchemaVersion?: unknown }).minimumReaderSchemaVersion;
  return { ...openParsed(parseNativeProjectFile(text)), stamp };
}

/** What a save writes for the project's documents, as one string: key order counts. */
function savedDocuments(state: WorkspaceState): { text: string; diagrams: unknown[]; foldSequences: unknown } {
  const values = projectDocumentFileValues(state);
  const diagrams = (values.diagrams ?? []) as unknown[];
  const foldSequences = values.foldSequences ?? null;
  return { text: JSON.stringify({ diagrams, foldSequences }), diagrams, foldSequences };
}

export function checkFile(
  text: string,
  opened: OpenedProject,
  kase: CorpusCase,
  write: (name: string, contents: string) => string
): FileRecord {
  const problems: string[] = [];
  const { read, diagram, shown } = opened;
  const readOnly = read?.readOnly ?? false;
  if (!read) problems.push('the file holds no diagram this build reads');
  if (readOnly) problems.push('the diagram opens read-only: a newer build wrote it');

  // Locked steps, against the manifest.
  const locked = diagram ? diagram.steps.filter((entry) => (isTurn(entry) ? isLockedTurn(entry) : isLockedStep(entry))).map((entry) => entry.id) : [];
  const unexpected = locked.filter((id) => !kase.expectedLocked.includes(id));
  const unlocked = kase.expectedLocked.filter((id) => !locked.includes(id));
  if (unexpected.length > 0) problems.push(`steps open locked that the manifest does not expect: ${unexpected.join(', ')}`);
  if (unlocked.length > 0) problems.push(`steps the manifest expects locked open editable: ${unlocked.join(', ')}`);

  // Steps the reader dropped, or kept with their source or picture refused.
  const rawSteps = shown && Array.isArray(shown.steps) ? shown.steps.filter(isRecord) : [];
  if (diagram) {
    const readIds = new Set(diagram.steps.map((entry) => entry.id));
    const seen = new Map<unknown, number>();
    for (const raw of rawSteps) seen.set(raw.id, (seen.get(raw.id) ?? 0) + 1);
    const dropped = [...seen].filter(([id, count]) => typeof id !== 'string' || count > 1 || !readIds.has(id)).map(([id]) => String(id));
    if (dropped.length > 0) problems.push(`steps dropped on read: ${dropped.join(', ')}`);
    const rawById = new Map(rawSteps.map((raw) => [raw.id, raw] as const));
    const emptied = diagram.steps
      .filter((entry) => !isTurn(entry) && !entry.unknown)
      .filter((step) => {
        const raw = rawById.get(step.id);
        return (isRecord(raw?.source) && !isTurn(step) && step.source === null) || (isRecord(raw?.picture) && !isTurn(step) && step.picture === null);
      })
      .map((step) => step.id);
    if (emptied.length > 0) problems.push(`steps whose source or picture the reader refused: ${emptied.join(', ')}`);
  }

  // Assets: kept, carried unread, changed or dropped on read; and whether a save keeps them.
  const saved = savedDocuments(opened.state);
  const savedAssets = isRecord((saved.diagrams[0] as Record<string, unknown> | undefined)?.assets)
    ? ((saved.diagrams[0] as Record<string, unknown>).assets as Record<string, unknown>)
    : {};
  const rawAssets = shown && isRecord(shown.assets) ? shown.assets : {};
  const assets: FileRecord['assets'] = Object.entries(rawAssets).map(([id, entry]) => {
    const raw = isRecord(entry) ? entry : {};
    const got = diagram?.assets[id];
    let fate: 'kept' | 'carried' | 'changed' | 'dropped';
    if (!got) fate = 'dropped';
    else if (!isKnownAsset(got)) fate = JSON.stringify(got.unknown) === JSON.stringify(entry) ? 'carried' : 'changed';
    else {
      const same =
        got.kind === raw.kind &&
        (got.kind === 'svg' ? got.svg === raw.svg : got.src === raw.src) &&
        got.widthPx === raw.widthPx &&
        got.heightPx === raw.heightPx &&
        got.bytes === raw.bytes;
      fate = same ? 'kept' : 'changed';
    }
    const content = got && isKnownAsset(got) ? (got.kind === 'svg' ? got.svg : got.src) : JSON.stringify(entry);
    return {
      id,
      kind: typeof raw.kind === 'string' ? raw.kind : 'unknown',
      fate,
      saved: Object.hasOwn(savedAssets, id),
      bytes: got && isKnownAsset(got) ? got.bytes : 0,
      sha256: sha256(content),
    };
  });
  const droppedAssets = assets.filter((asset) => asset.fate === 'dropped').map((asset) => asset.id);
  if (droppedAssets.length > 0) problems.push(`assets dropped on read: ${droppedAssets.join(', ')}`);

  // Stored scenes: each key the digest of its scene, and each scene in the form a read keeps.
  const scenes: FileRecord['scenes'] = { checked: 0, badKeys: [], unreadable: [], notCanonical: [], changedOnRead: [] };
  for (const raw of rawSteps) {
    const picture = raw.picture;
    if (!isRecord(picture) || picture.kind !== 'scene' || typeof picture.sceneJson !== 'string') continue;
    scenes.checked += 1;
    const id = String(raw.id);
    if (picture.key !== `scene-${digest(picture.sceneJson)}`) scenes.badKeys.push(id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(picture.sceneJson);
    } catch {
      scenes.unreadable.push(id);
      continue;
    }
    if (storedSceneJson(parsed) !== picture.sceneJson) scenes.notCanonical.push(id);
    const step = diagram?.steps.find((entry) => entry.id === id);
    if (step && !isTurn(step) && !step.unknown && step.picture?.kind === 'scene' && step.picture.sceneJson !== picture.sceneJson) {
      scenes.changedOnRead.push(id);
    }
  }
  if (scenes.badKeys.length > 0) problems.push(`picture keys that are not the digest of their scene: ${scenes.badKeys.join(', ')}`);
  if (scenes.unreadable.length > 0) problems.push(`scenes that do not parse: ${scenes.unreadable.join(', ')}`);
  if (scenes.notCanonical.length > 0) {
    problems.push(`scenes not in the form a read keeps, so a read rewrites them under their old key: ${scenes.notCanonical.join(', ')}`);
  }

  // The first save, saved again: a fixed point.
  const resaved = JSON.parse(text) as { workspace: Record<string, unknown> };
  delete resaved.workspace.diagram;
  resaved.workspace.diagrams = saved.diagrams;
  if (saved.foldSequences === null) delete resaved.workspace.foldSequences;
  else resaved.workspace.foldSequences = saved.foldSequences;
  const reopened = openParsed(parseNativeProjectFile(JSON.stringify(resaved)));
  const again = savedDocuments(reopened.state);
  const fixedPoint = again.text === saved.text;
  if (!fixedPoint) problems.push('a second save changes the diagram again');

  // The reader version a save writes, against what the content needs.
  const workspace = reopened.project.workspace;
  const needed = Math.max(
    workspace.designs.length > 1 || workspace.unknownDesigns.length > 0 ? 8 : 1,
    (workspace.diagrams?.length ?? 0) > 0 ? 10 : 1,
    (workspace.foldSequences?.length ?? 0) > 0 ? 11 : 1
  );
  const written = reopened.project.minimumReaderSchemaVersion;
  if (written < needed) problems.push(`a save writes reader version ${written}; an older build would open it and drop documents (needs ${needed})`);
  if (written > NATIVE_PROJECT_READER_VERSION) problems.push(`a save writes reader version ${written}, which this build refuses`);

  return {
    readOnly,
    locked,
    assets,
    scenes,
    firstSave: { sha256: sha256(saved.text), bytes: saved.text.length, file: write('first-save.json', saved.text) },
    fixedPoint,
    reader: { written, needed },
    problems,
  };
}
