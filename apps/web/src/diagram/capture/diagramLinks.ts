/**
 * What a linked step points back at, one descriptor per kind of link
 * (fold-workspace plan D17): how the link stands (`statusOf`), the way back
 * to what it was made from (`openSource`), and where that is, in a word
 * (`originLabel`, `origin`). Every surface that follows a link asks its
 * descriptor, so a new kind of source is a row here rather than a branch in
 * each of them.
 *
 * - `cp`: a region of Edit's crease pattern, found by its rim; Open in Edit
 *   frames it.
 * - `references-step`: a References card, its sheet a region of the same
 *   pattern; Open in References opens on it.
 * - `fold-step`: a step of a Fold sequence, found by its ids; Open in Fold
 *   puts the sequence's cursor on it.
 *
 * Store-bound through the openers; each `statusOf` is pure.
 */

import type { TFunction } from 'i18next';
import type { DiagramSourceWorkspace } from '../../analytics';
import { foldStepLinkStatus } from '../fold/foldStepLink';
import { openDiagramStepInFold } from '../fold/foldStepActions';
import { linkStatus, type DiagramLinkContext, type DiagramLinkedSource, type DiagramLinkStatus } from './linkStatus';
import { openDiagramStepInReferences } from './referencesStepActions';
import { openDiagramStepInEdit } from './stepCaptureActions';

export interface DiagramLinkDescriptor<S extends DiagramLinkedSource> {
  /** Where the step was made from, as the analytics name it. */
  readonly origin: DiagramSourceWorkspace;
  /** How the link stands now. */
  statusOf(source: S, context: DiagramLinkContext): DiagramLinkStatus;
  /** Go back to what the step was made from, on the step's own link as the store has it. */
  openSource(stepId: string): void;
  /** Where the step was made from, in a word: what the card's badge and the Step pane say. */
  originLabel(t: TFunction): string;
}

type Descriptors = {
  readonly [K in DiagramLinkedSource['kind']]: DiagramLinkDescriptor<Extract<DiagramLinkedSource, { kind: K }>>;
};

export const DIAGRAM_LINKS: Descriptors = {
  cp: {
    origin: 'edit',
    statusOf: (source, { cp }) => linkStatus(source, cp.document, cp.sheets),
    openSource: openDiagramStepInEdit,
    originLabel: (t) => t('panels:diagram.link.originEdit', 'Edit'),
  },
  'references-step': {
    origin: 'references',
    statusOf: (source, { cp }) => linkStatus(source, cp.document, cp.sheets),
    openSource: openDiagramStepInReferences,
    originLabel: (t) => t('panels:diagram.link.originReferences', 'References'),
  },
  'fold-step': {
    origin: 'fold',
    statusOf: (source, { fold }) => foldStepLinkStatus(source, fold),
    openSource: openDiagramStepInFold,
    originLabel: (t) => t('panels:diagram.link.originFold', 'Fold'),
  },
};

/** The descriptor of a link's kind. */
export function linkDescriptorOf<S extends DiagramLinkedSource>(source: S): DiagramLinkDescriptor<S> {
  return DIAGRAM_LINKS[source.kind] as unknown as DiagramLinkDescriptor<S>;
}

/** How a link stands, by its kind's descriptor. */
export function diagramLinkStatus(source: DiagramLinkedSource, context: DiagramLinkContext): DiagramLinkStatus {
  return linkDescriptorOf(source).statusOf(source, context);
}
