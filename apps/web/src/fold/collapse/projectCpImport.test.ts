import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { sequenceOf, step } from '../document/foldSequence.fixtures';
import { projectCpImport } from './projectCpImport';
import { projectCpRevision } from './projectCpRevision';
import type { FoldCpJumpOp } from '../document/foldSequenceDocument';
import type { FoldImportFingerprinted } from '../engine/foldEngineIoWire';

const { exportCp, exportRegion, sheetIndex } = vi.hoisted(() => ({ exportCp: vi.fn(async () => '{}'), exportRegion: vi.fn(async () => '{"region":true}'), sheetIndex: vi.fn() }));
vi.mock('../../store/workspaceStore/oristudioCpRuntime', () => ({ exportOristudioCpDocumentAsFold: exportCp, exportOristudioCpCreasesAsFold: exportRegion }));
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { cpLinesByIds } from '../../cp-workspace/folded/foldedFigureStaleness';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { cpDocument, LEFT_LINE_IDS, movedLines, TWO_SQUARES, twoSquaresIndex } from '../../diagram/capture/capture.fixtures';
// The sheet index a link is found in, as the kernel would build it.
vi.mock('../../cp-workspace/sheets/cpSheetIndex', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetIndex')>()),
  ensureCpSheetIndex: sheetIndex,
}));
const initial = useWorkspaceStore.getState();
afterEach(() => { useWorkspaceStore.setState(initial, true); vi.clearAllMocks(); });
function source() {
  return { loadSerial: 1, document: { crease_pattern: {
    line_segments: [{ a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, color: 'Red1', selected: 0 }],
    aux_line_segments: [],
  } } } as unknown as OristudioCpDocumentState;
}
describe('project CP snapshots', () => {
  it('ignores selection and line order, but notices geometry, assignment and guide edits', () => {
    const cp = source().document;
    const revision = projectCpRevision(cp);
    const selected = structuredClone(cp);
    selected.crease_pattern.line_segments[0]!.selected = 2;
    expect(projectCpRevision(selected)).toBe(revision);
    selected.crease_pattern.line_segments[0]!.color = 'Blue2';
    expect(projectCpRevision(selected)).not.toBe(revision);
    selected.crease_pattern.line_segments[0]!.color = 'Red1';
    selected.crease_pattern.line_segments[0]!.a.x = .1;
    expect(projectCpRevision(selected)).not.toBe(revision);
    selected.crease_pattern.aux_line_segments.push(selected.crease_pattern.line_segments[0]!);
    expect(projectCpRevision(selected)).not.toBe(projectCpRevision(cp));
  });
  it('accepts an unchanged update without an undo edit, and rejects an outlived capture', async () => {
    const cp = source();
    const op: FoldCpJumpOp = { kind: 'cp-jump', origin: 'project_cp', cpJson: '{}', orderJson: '[]',
      source: { documentId: 'crease-pattern', revision: projectCpRevision(cp.document) } };
    const document = sequenceOf([step('collapse', null, op, { expect: 'fs1:1111111111111111' })]);
    useWorkspaceStore.setState({ oristudioCpDocument: cp, foldSequences: [{ document, readOnlyRaw: null }] });
    const capture = await projectCpImport('collapse');
    expect(capture?.source).toEqual({ format: 'fold', text: '{}' });
    const landed = { op, fingerprint: 'fs1:1111111111111111' } as unknown as FoldImportFingerprinted;
    expect(capture?.replace?.(landed)).toBe(true);
    expect(useWorkspaceStore.getState().foldSequences[0]!.document).toBe(document);
    useWorkspaceStore.setState({ projectLoadId: initial.projectLoadId + 1 });
    expect(capture?.replace?.(landed)).toBe(false);
  });
  it('refuses a CP that changed while its snapshot was being exported', async () => {
    const cp = source();
    useWorkspaceStore.setState({ oristudioCpDocument: cp });
    exportCp.mockImplementationOnce(async () => {
      const changed = structuredClone(cp);
      changed.document.crease_pattern.line_segments[0]!.color = 'Blue2';
      useWorkspaceStore.setState({ oristudioCpDocument: changed });
      return '{}';
    });
    expect(await projectCpImport()).toBeNull();
  });
});

function regionSource() {
  const cp = { loadSerial: 1, document: cpDocument() } as OristudioCpDocumentState;
  sheetIndex.mockResolvedValue(twoSquaresIndex());
  useWorkspaceStore.setState({ oristudioCpDocument: cp });
  return { cp, region: regionReferenceFor(sheetRegions(twoSquaresIndex())[0]!) };
}

describe('one linked Edit pattern', () => {
  it('exports the selected region including auxiliary precreases and remembers it for later updates', async () => {
    const { cp, region } = regionSource();
    const capture = await projectCpImport(undefined, region);
    expect(exportRegion).toHaveBeenCalledExactlyOnceWith(cp.document.crease_pattern, cpLinesByIds(cp.document, LEFT_LINE_IDS));
    expect(exportCp).not.toHaveBeenCalled();
    expect(capture?.link.region).toEqual(region);
    expect(capture?.link.revision).toMatch(/^rc1:/);
    expect(capture?.source).toEqual({ format: 'fold', text: '{"region":true}' });
  });

  it('updates the same sheet after it moves and never substitutes the whole document for a missing sheet', async () => {
    const { region } = regionSource();
    const capture = (await projectCpImport(undefined, region))!;
    const op: FoldCpJumpOp = { kind: 'cp-jump', origin: 'project_cp', cpJson: '{}', orderJson: '[]', source: capture.link };
    useWorkspaceStore.setState({ foldSequences: [{ document: sequenceOf([step('collapse', null, op)]), readOnlyRaw: null }] });
    const moved = { loadSerial: 1, document: cpDocument(movedLines(TWO_SQUARES, 300, 40)) } as OristudioCpDocumentState;
    useWorkspaceStore.setState({ oristudioCpDocument: moved });
    sheetIndex.mockResolvedValue(twoSquaresIndex({ dx: 300, dy: 40 }));
    const updated = (await projectCpImport('collapse'))!;
    expect(updated.link.revision).toBe(capture.link.revision);
    expect(updated.link.region?.bounds.minX).toBe(region.bounds.minX + 300);
    expect(updated.replace).toBeTypeOf('function');
    // The left square no longer closed by its border: its sheet is gone.
    sheetIndex.mockResolvedValue(twoSquaresIndex({ left: false }));
    expect(await projectCpImport('collapse')).toBeNull();
    expect(exportCp).not.toHaveBeenCalled();
  });

  it('cancels when the document changes during region export', async () => {
    const { cp, region } = regionSource();
    exportRegion.mockImplementationOnce(async () => {
      const changed = structuredClone(cp);
      changed.document.crease_pattern.line_segments[7]!.color = 'Blue2';
      useWorkspaceStore.setState({ oristudioCpDocument: changed });
      return '{}';
    });
    expect(await projectCpImport(undefined, region)).toBeNull();
  });
});
