import { useEffect } from 'react';
import { useExploriTreeHost } from '../../explori/useExploriTreeHost';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TreeEditor } from '../../tree-editor/TreeEditor';
import { DesignAttributionFooter } from '../DesignAttributionFooter';
import { ExploriQueryBar } from './ExploriQueryBar';

/**
 * The ExplOri tree canvas: draw a tree, then search the archive for it.
 *
 * A composition site. The drawing, the gestures and the mirror are `TreeEditor`;
 * what makes this surface ExplOri rather than box-pleat is the host — continuous
 * lengths, no sheet, no engine — and the query bar underneath.
 */
export function ExploriTreePanel() {
  const host = useExploriTreeHost();
  const ensureDocument = useWorkspaceStore((state) => state.ensureExploriDocument);
  // Self-provisioning, as the box-pleat pane does: acquiring the handle is what
  // hydrates a design parked by a tab switch or read from a file, so a pane that
  // never asked would render the empty default forever.
  useEffect(() => {
    void ensureDocument();
  }, [ensureDocument]);
  return (
    <section className="panel-shell design-panel explori-tree-panel">
      <TreeEditor host={host} />
      <ExploriQueryBar />
      {/* Not analytics: the notice that a query leaves the machine must not be
          gated on the analytics opt-out. */}
      <DesignAttributionFooter method="explori" />
    </section>
  );
}
