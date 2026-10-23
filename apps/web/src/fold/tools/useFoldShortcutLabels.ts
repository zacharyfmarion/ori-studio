import { useCallback, useMemo } from 'react';
import { shortcutLabelForAction, type ShortcutResolutionInput } from '../../keyboard/shortcuts';
import { useShortcutStore } from '../../store/shortcutStore';
import type { FoldKeyLabel } from './foldToolCatalog';

/**
 * The user's key layout as the Fold surfaces name keys by it: the resolution
 * input the transport labels its keys with, and the label of a Fold key — the
 * rail's tooltips, the tool window's rows and the root chooser's note. One
 * hook, so the rail beside the panel and the canvas under the header read the
 * same overrides.
 */
export function useFoldShortcutLabels(): { shortcuts: ShortcutResolutionInput; keyLabel: FoldKeyLabel } {
  const overrides = useShortcutStore((state) => state.overrides);
  const defaultsSource = useShortcutStore((state) => state.defaultsSource);
  const shortcuts = useMemo(() => ({ overrides, defaultsSource }), [overrides, defaultsSource]);
  const keyLabel = useCallback<FoldKeyLabel>((id) => shortcutLabelForAction(id, shortcuts), [shortcuts]);
  return { shortcuts, keyLabel };
}
