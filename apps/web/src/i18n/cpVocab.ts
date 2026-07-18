import type { TFunction } from 'i18next';
import {
  ORISTUDIO_CP_ACTIONS,
  ORISTUDIO_CP_ACTION_GROUPS,
  type OristudioCpActionDefinition,
  type OristudioCpActionGroupDefinition,
} from '../lib/oristudioCpActions';
import type { OristudioCpCommandDefinition } from '../lib/oristudioCpCommands';
import {
  ORIEDITA_CP_TOOL_INSTRUCTIONS,
  resolvedOrieditaInstructionKey,
  type OristudioCpToolInstructions,
} from '../lib/oristudioCpToolInstructions';

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

const CP_ACTION_BY_ID = new Map(ORISTUDIO_CP_ACTIONS.map((action) => [action.id, action]));

/** Localized label for a CP action referenced by id (e.g. from a shortcut definition). */
export function cpActionLabelById(t: TFunction, id: string): string {
  const action = CP_ACTION_BY_ID.get(id as OristudioCpActionDefinition['id']);
  return action ? cpActionLabel(t, action) : id;
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

function instructionKey(upstreamAction: string, field: string, index: number): string {
  return `${CP_VOCAB_NAMESPACE}:instructions.${segment(upstreamAction)}.${field}.${index}`;
}

function translateLines(
  t: TFunction,
  upstreamAction: string,
  field: 'intro' | 'steps' | 'notes',
  lines: readonly string[] | undefined
): string[] | undefined {
  if (!lines || lines.length === 0) return undefined;
  return lines.map((line, index) => t(instructionKey(upstreamAction, field, index), line));
}

/**
 * Translated tool instructions for the context panel. When the tool matches the Oriedita
 * instruction dictionary, each line is translated by its stable key; otherwise it falls back
 * to action-derived instructions (tooltip / steps / disabled reason), all via cpVocab.
 */
export function cpToolInstructions(
  t: TFunction,
  action: OristudioCpActionDefinition | null | undefined,
  command: OristudioCpCommandDefinition | null | undefined
): OristudioCpToolInstructions | null {
  const key = resolvedOrieditaInstructionKey(action, command);
  if (key) {
    const raw = ORIEDITA_CP_TOOL_INSTRUCTIONS[key];
    return {
      intro: translateLines(t, key, 'intro', raw.intro),
      steps: translateLines(t, key, 'steps', raw.steps),
      notes: translateLines(t, key, 'notes', raw.notes),
    };
  }
  if (!action || action.kind !== 'command') return null;
  const intro =
    action.tooltip && action.tooltip !== action.label
      ? [cpActionTooltip(t, action)]
      : [t('cpVocab:instructions.useTool', 'Use {{label}}.', { label: cpActionLabel(t, action) })];
  const steps = cpActionSteps(t, action);
  const notes = action.uiStatus === 'ready' ? undefined : [cpActionDisabledReason(t, action)];
  return { intro, steps: steps.length > 0 ? steps : undefined, notes };
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
  // Tool instruction dictionary (intro / steps / notes) + the action-derived fallback.
  setDeep(root, 'instructions.useTool', 'Use {{label}}.');
  for (const [upstreamAction, entry] of Object.entries(ORIEDITA_CP_TOOL_INSTRUCTIONS)) {
    for (const field of ['intro', 'steps', 'notes'] as const) {
      entry[field]?.forEach((line, index) =>
        put(instructionKey(upstreamAction, field, index), line)
      );
    }
  }
  return root;
}
