import { cpLinesByIds } from '../../cp-workspace/folded/foldedFigureStaleness';
import { regionReferenceFor, type RegionReference } from '../../cp-workspace/regions/regionReference';
import { chooseRegionCreases } from '../../cp-workspace/regions/regionCreases';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { CREASE_PATTERN_DOCUMENT_ID } from '../../lib/nativeProjectDesigns';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { exportOristudioCpDocumentAsFold, exportOristudioCpCreasesAsFold } from '../../store/workspaceStore/oristudioCpRuntime';
import type { FoldProjectCpImport } from '../io/foldImportFlow';
import { canonicalJson } from '../document/foldDigest';
import { projectCpRevision } from './projectCpRevision';

/** Capture once. An editor change after capture leaves the saved revision
 * alone; a different project, sequence edit or cursor move cancels the transaction. */
export async function projectCpImport(stepId?: string, region?: RegionReference): Promise<FoldProjectCpImport | null> {
  const before = useWorkspaceStore.getState();
  const cp = before.oristudioCpDocument;
  const sequence = before.foldSequences[0]?.document;
  const node = stepId ? sequence?.steps.find((step) => step.id === stepId) : undefined;
  if (!cp || (stepId && (node?.op?.kind !== 'cp-jump' ||
      node.op.source?.documentId !== CREASE_PATTERN_DOCUMENT_ID))) return null;
  const revision = projectCpRevision(cp.document);
  const saved = node?.op?.kind === 'cp-jump' ? node.op.source : undefined;
  const selected = saved?.region ?? region;
  // The sheet the link names, found in the sheet index every link is made in, as a Diagram step's is.
  const index = selected ? await ensureCpSheetIndex(cp.document) : null;
  const choice = selected ? chooseRegionCreases(cp.document, { kind: 'segment', region: selected }, index,
    saved?.region ? { fingerprint: saved.revision, drawn: true } : null) : null;
  if (choice && choice.status !== 'found') return null;
  const creases = choice?.status === 'found' ? choice.creases : null;
  const text = creases
    ? await exportOristudioCpCreasesAsFold(cp.document.crease_pattern, cpLinesByIds(cp.document, creases.scopedLineIds))
    : await exportOristudioCpDocumentAsFold();
  const after = useWorkspaceStore.getState();
  if (after.projectLoadId !== before.projectLoadId || after.oristudioCpDocument?.loadSerial !== cp.loadSerial ||
      !after.oristudioCpDocument || projectCpRevision(after.oristudioCpDocument.document) !== revision) return null;
  const expected = node?.op?.kind === 'cp-jump' ? node.op : null;
  const current = () => {
    const now = useWorkspaceStore.getState();
    return now.projectLoadId === before.projectLoadId && now.foldLoadId === before.foldLoadId &&
      now.foldSequences === before.foldSequences && now.foldReader === before.foldReader;
  };
  return {
    source: { format: 'fold', text },
    link: { documentId: CREASE_PATTERN_DOCUMENT_ID,
      revision: creases?.drawnFingerprint ?? revision,
      ...(creases ? { region: regionReferenceFor(creases.sheet) } : {}),
    },
    current,
    ...(node && expected ? {
      at: node.parent,
      replace: (landed) => {
        if (!current()) return false;
        // A fresh resolution can land the exact saved revision and order.
        // That is successful without manufacturing an undo entry.
        if (canonicalJson(expected) === canonicalJson(landed.op) && 'expect' in node && node.expect === landed.fingerprint) return true;
        return useWorkspaceStore.getState().updateFoldCollapse(
          node.id, expected, landed.op, landed.fingerprint, before.foldLoadId);
      },
    } : {}),
  };
}
