import type { FoldDocument } from '../engine/types';

export type OristudioCpLineageKind = 'generated-from-tree' | 'imported' | 'blank' | 'detached';

export interface OristudioCpLineage {
  kind: OristudioCpLineageKind;
  treeDocumentId?: string;
  sourceTreeDigest?: string;
  generatedAt?: string;
  manualEditCount: number;
  stale: boolean;
  sourceGeneratedFold?: FoldDocument | null;
}

export function blankCpLineage(): OristudioCpLineage {
  return {
    kind: 'blank',
    manualEditCount: 0,
    stale: false,
  };
}

export function importedCpLineage(): OristudioCpLineage {
  return {
    kind: 'imported',
    manualEditCount: 0,
    stale: false,
  };
}

export function generatedCpLineage(input: {
  sourceTreeDigest: string;
  sourceGeneratedFold: FoldDocument | null;
  generatedAt?: string;
}): OristudioCpLineage {
  return {
    kind: 'generated-from-tree',
    treeDocumentId: 'tree',
    sourceTreeDigest: input.sourceTreeDigest,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    manualEditCount: 0,
    stale: false,
    sourceGeneratedFold: input.sourceGeneratedFold,
  };
}

export function normalizeCpLineage(value: unknown): OristudioCpLineage {
  if (!isRecord(value)) return importedCpLineage();
  const kind = value.kind;
  const normalizedKind: OristudioCpLineageKind =
    kind === 'generated-from-tree' || kind === 'imported' || kind === 'blank' || kind === 'detached'
      ? kind
      : 'imported';
  return {
    kind: normalizedKind,
    treeDocumentId: typeof value.treeDocumentId === 'string' ? value.treeDocumentId : undefined,
    sourceTreeDigest:
      typeof value.sourceTreeDigest === 'string' ? value.sourceTreeDigest : undefined,
    generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : undefined,
    manualEditCount:
      typeof value.manualEditCount === 'number' && Number.isFinite(value.manualEditCount)
        ? Math.max(0, Math.trunc(value.manualEditCount))
        : 0,
    stale: value.stale === true,
    sourceGeneratedFold: isRecord(value.sourceGeneratedFold)
      ? (value.sourceGeneratedFold as unknown as FoldDocument)
      : null,
  };
}

export function markCpLineageEdited(lineage: OristudioCpLineage | null): OristudioCpLineage | null {
  if (!lineage) return lineage;
  return {
    ...lineage,
    manualEditCount: lineage.manualEditCount + 1,
  };
}

export function markGeneratedCpLineageStale(
  lineage: OristudioCpLineage | null,
): OristudioCpLineage | null {
  if (!lineage || lineage.kind !== 'generated-from-tree') return lineage;
  return {
    ...lineage,
    stale: true,
  };
}

export function cpLineageStatusLabel(lineage: OristudioCpLineage | null): string | null {
  if (!lineage) return null;
  if (lineage.kind === 'generated-from-tree') {
    if (lineage.stale) return 'Design changed';
    if (lineage.manualEditCount > 0) return 'Customized CP';
    return 'Generated from design';
  }
  if (lineage.kind === 'detached') return 'Detached CP';
  if (lineage.kind === 'blank') return 'Blank CP';
  return 'Imported CP';
}

export function stableTextDigest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
