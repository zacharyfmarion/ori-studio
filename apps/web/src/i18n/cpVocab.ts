import type { TFunction } from 'i18next';
import {
  ORISTUDIO_CP_ACTIONS,
  ORISTUDIO_CP_ACTION_GROUPS,
  type OristudioCpActionDefinition,
  type OristudioCpActionGroupDefinition,
} from '../lib/oristudioCpActions';

/**
 * Localization for the crease-pattern tool vocabulary (tool names, tooltips, tool-step
 * instructions, group headings). The English source of truth is the data module
 * `lib/oristudioCpActions.ts`; this module both (a) generates the `cpVocab` English catalog
 * from that data (see {@link buildCpVocabCatalog}, kept in sync by `cpVocab.gen.test.ts`)
 * and (b) provides render-time helpers that translate each string with the data value as
 * the inline English fallback. Translating here — rather than baking English into the data
 * module's consumers — keeps a single English source and lets the ~289 strings be
 * translated per locale like everything else.
 */

export const CP_VOCAB_NAMESPACE = 'cpVocab';

/** Action/group ids contain dots and hyphens; flatten them to a single safe key segment. */
function segment(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, '_');
}

function actionKey(action: OristudioCpActionDefinition, field: string): string {
  return `${CP_VOCAB_NAMESPACE}:action.${segment(action.id)}.${field}`;
}

function groupKey(group: OristudioCpActionGroupDefinition, field: string): string {
  return `${CP_VOCAB_NAMESPACE}:group.${segment(group.id)}.${field}`;
}

export function cpActionLabel(t: TFunction, action: OristudioCpActionDefinition): string {
  return t(actionKey(action, 'label'), action.label);
}

export function cpActionRailLabel(t: TFunction, action: OristudioCpActionDefinition): string {
  return action.railLabel ? t(actionKey(action, 'railLabel'), action.railLabel) : '';
}

export function cpActionTooltip(t: TFunction, action: OristudioCpActionDefinition): string {
  return action.tooltip ? t(actionKey(action, 'tooltip'), action.tooltip) : '';
}

export function cpActionDisabledReason(t: TFunction, action: OristudioCpActionDefinition): string {
  return action.disabledReason
    ? t(actionKey(action, 'disabledReason'), action.disabledReason)
    : '';
}

/** Localized tool-step instructions for a command action (empty when it has none). */
export function cpActionSteps(t: TFunction, action: OristudioCpActionDefinition): string[] {
  const steps = 'toolSteps' in action ? (action.toolSteps ?? []) : [];
  return steps.map((step, index) => t(actionKey(action, `steps.${index}`), step));
}

export function cpGroupLabel(t: TFunction, group: OristudioCpActionGroupDefinition): string {
  return t(groupKey(group, 'label'), group.label);
}

export function cpGroupRailLabel(t: TFunction, group: OristudioCpActionGroupDefinition): string {
  return t(groupKey(group, 'railLabel'), group.railLabel);
}

type CatalogNode = { [key: string]: string | CatalogNode };

function setDeep(root: CatalogNode, dottedKey: string, value: string): void {
  const parts = dottedKey.split('.');
  let node = root;
  for (let i = 0; i < parts.length - 1; i++) {
    node = (node[parts[i]] ??= {}) as CatalogNode;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * Build the English `cpVocab` catalog from the data module. Consumed by `i18n:extract`
 * (written to public/locales/en/cpVocab.json) and asserted in sync by cpVocab.gen.test.ts.
 */
export function buildCpVocabCatalog(): CatalogNode {
  const root: CatalogNode = {};
  const put = (key: string, value: string | undefined) => {
    if (value) setDeep(root, key.slice(CP_VOCAB_NAMESPACE.length + 1), value);
  };
  for (const group of ORISTUDIO_CP_ACTION_GROUPS) {
    put(groupKey(group, 'label'), group.label);
    put(groupKey(group, 'railLabel'), group.railLabel);
  }
  for (const action of ORISTUDIO_CP_ACTIONS) {
    put(actionKey(action, 'label'), action.label);
    put(actionKey(action, 'railLabel'), action.railLabel);
    put(actionKey(action, 'tooltip'), action.tooltip);
    put(actionKey(action, 'disabledReason'), action.disabledReason);
    const steps = 'toolSteps' in action ? (action.toolSteps ?? []) : [];
    steps.forEach((step, index) => put(actionKey(action, `steps.${index}`), step));
  }
  return root;
}
