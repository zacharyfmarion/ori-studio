import type { TFunction } from 'i18next';

/**
 * A translator that answers with the inline English default.
 *
 * For a pure module — `lib/`, `engine/`, `platform/` — that names something a
 * user will read but has no i18n instance in reach, and for the tests that call
 * it. Such a module takes `t: TFunction = identityTranslate` and its caller in
 * the store or a component threads the live one through; a caller that passes
 * nothing gets exactly the English the catalog would fall back to before it
 * loads. The same shape `lib/workspaceCapabilities.ts` established.
 */
export const identityTranslate = ((_key: string, defaultValue?: string) =>
  defaultValue ?? _key) as unknown as TFunction;
