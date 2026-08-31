import type { TFunction } from 'i18next';
import type { ShortcutDefinition, ShortcutScope } from '../keyboard/shortcuts';
import { cpActionLabelById } from './cpVocab';

/**
 * Translations for the Settings → Shortcuts list. Action labels reuse the already-translated
 * menu keys (menu shortcuts), the cpVocab tool labels (crease-pattern shortcuts), or literal
 * keys (viewport). Categories and scopes get their own literal keys.
 */

export function shortcutActionLabel(t: TFunction, definition: ShortcutDefinition): string {
  if (definition.target === 'cp-action') {
    return cpActionLabelById(t, definition.id);
  }
  if (definition.target === 'menu') {
    // Menu shortcut ids match the menu action ids, whose translations already exist.
    return t(`menu:${definition.id}`, definition.label);
  }
  switch (definition.id) {
    case 'viewport.zoomIn':
      return t('tools:viewport.zoomIn', 'Zoom In');
    case 'viewport.zoomOut':
      return t('tools:viewport.zoomOut', 'Zoom Out');
    case 'viewport.fit':
      return t('dialogs:settings.shortcuts.viewportFit', 'Fit To View');
    case 'viewport.actualSize':
      return t('dialogs:settings.shortcuts.viewportActualSize', 'Actual Size');
    case 'viewport.contextMenu':
      return t('tools:viewport.contextMenu', 'Open Context Menu');
    // The simulator verbs, which until now fell through to the English label
    // below because the shortcut list was their only reader. The simulator's
    // context menu is built from these same definitions, so they are now the
    // wording on a menu row rather than a line in a settings table.
    case 'simulator.playPause':
      return t('tools:simulator.playPause', 'Play / Pause Fold');
    case 'simulator.foldForward':
      return t('tools:simulator.foldForward', 'Fold Forward');
    case 'simulator.foldBackward':
      return t('tools:simulator.foldBackward', 'Fold Backward');
    case 'simulator.foldEnd':
      return t('tools:simulator.foldEnd', 'Jump To Folded');
    case 'simulator.foldStart':
      return t('tools:simulator.foldStart', 'Jump To Flat');
    case 'simulator.replay':
      return t('tools:simulator.replay', 'Replay From Flat');
    case 'simulator.resetView':
      return t('tools:simulator.resetView', 'Reset Simulator View');
    case 'simulator.toggleFaces':
      return t('tools:simulator.toggleFaces', 'Faces');
    case 'simulator.toggleCreases':
      return t('tools:simulator.toggleCreases', 'Crease lines');
    case 'simulator.toggleHiddenLines':
      return t('tools:simulator.toggleHiddenLines', 'Hidden lines');
    case 'simulator.toggleLighting':
      return t('tools:simulator.toggleLighting', 'Lighting');
    default:
      return definition.label;
  }
}

export function shortcutScopeLabel(t: TFunction, scope: ShortcutScope): string {
  switch (scope) {
    case 'global':
      return t('dialogs:settings.shortcuts.scopeGlobal', 'global');
    case 'crease-pattern':
      return t('dialogs:settings.shortcuts.scopeCreasePattern', 'crease-pattern');
    case 'viewport':
      return t('dialogs:settings.shortcuts.scopeViewport', 'viewport');
    default:
      return scope;
  }
}

/** Category headings used by the shortcut list (menu, viewport, and CP tool groups). */
export function shortcutCategoryLabel(t: TFunction, category: string): string {
  switch (category) {
    case 'File':
      return t('dialogs:settings.shortcuts.categoryFile', 'File');
    case 'Edit':
      return t('dialogs:settings.shortcuts.categoryEdit', 'Edit');
    case 'Design':
      return t('dialogs:settings.shortcuts.categoryDesign', 'Design');
    case 'Crease Pattern':
      return t('dialogs:settings.shortcuts.categoryCreasePattern', 'Crease Pattern');
    case 'Help':
      return t('dialogs:settings.shortcuts.categoryHelp', 'Help');
    case 'Viewport':
      return t('dialogs:settings.shortcuts.categoryViewport', 'Viewport');
    case 'Line Type':
      return t('dialogs:settings.shortcuts.categoryLineType', 'Line Type');
    case 'Select And Edit':
      return t('dialogs:settings.shortcuts.categorySelectAndEdit', 'Select And Edit');
    case 'Draw':
      return t('dialogs:settings.shortcuts.categoryDraw', 'Draw');
    case 'Construct':
      return t('dialogs:settings.shortcuts.categoryConstruct', 'Construct');
    case 'Transform':
      return t('dialogs:settings.shortcuts.categoryTransform', 'Transform');
    case 'Color':
      return t('dialogs:settings.shortcuts.categoryColor', 'Color');
    case 'Annotations':
      return t('dialogs:settings.shortcuts.categoryAnnotations', 'Annotations');
    case 'Generators':
      return t('dialogs:settings.shortcuts.categoryGenerators', 'Generators');
    case 'Measure':
      return t('dialogs:settings.shortcuts.categoryMeasure', 'Measure');
    case 'Check And Fix':
      return t('dialogs:settings.shortcuts.categoryCheckAndFix', 'Check And Fix');
    case 'Fold':
      return t('dialogs:settings.shortcuts.categoryFold', 'Fold');
    default:
      return category;
  }
}
