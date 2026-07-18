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
