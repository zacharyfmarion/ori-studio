import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { useBpTreeEditorHost } from '../../hooks/useBpTreeEditorHost';
import { TreeEditor } from '../../tree-editor/TreeEditor';

/**
 * The box-pleat tree canvas.
 *
 * A composition site, which is what a panel is meant to be: the drawing, the
 * gestures, the camera and the contextual editors are `TreeEditor`, and
 * everything box-pleat about them — the engine snapshot, the sheet, the store
 * actions, the selection linking, the inspector — is assembled by
 * `useBpTreeEditorHost`.
 */
export function BpTreePanel({ document }: { document: OristudioBpDocumentState }) {
  const host = useBpTreeEditorHost(document);
  return <TreeEditor host={host} />;
}
