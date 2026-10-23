/**
 * Fold's code, as `foldGateway.ts` loads it: everything the workspace reaches only once Fold
 * is used, behind one `import()`. Nothing outside the gateway imports this module, but for
 * its types.
 *
 * Here rather than under `fold/` because it gathers the Diagram's side of the link too (its
 * From Fold… browser and its captures from Fold), and Fold itself never reaches into the
 * Diagram (`fold/foldDiagramBoundary.test.ts`).
 */

// The panes: the workspace's dock panel and its side panes (docked, or a phone's drawer).
export { FoldPanel } from '../components/panels/FoldPanel';
export { FoldPaperPanel } from '../components/panels/FoldPaperPanel';
export { FoldStepPanel } from '../components/panels/FoldStepPanel';
// The overlays the App root mounts: Import CP, and the Diagram's From Fold… browser.
export { FoldImportModal } from '../components/fold/import/FoldImportDialog';
export { DiagramFoldBrowser } from '../components/diagram/DiagramFoldBrowser';
// The session that replays the shown sequence on the fold engine, and what Diagram reads from it.
export { foldSession } from '../store/workspaceStore/foldSession';
export { captureFoldStep, readFoldStepCapture } from '../diagram/fold/foldStepCapture';
export { foldStepPicture } from '../diagram/fold/foldStepPicture';
export { pullFoldTargets } from '../diagram/fold/foldPull';
export { foldPrecreaseMerges } from '../diagram/fold/foldPrecreaseMirrors';
// The menu bar's verbs: the sequence's, and its imports and hand-offs.
export { runFoldMenuVerb } from '../fold/sequence/foldCommands';
export { runFoldIoCommand } from '../fold/io/foldIoCommands';
