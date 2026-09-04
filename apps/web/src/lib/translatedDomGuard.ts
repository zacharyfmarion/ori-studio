/**
 * Survive an in-page translator rewriting the DOM under React.
 *
 * Google Translate localizes a page by *replacing text nodes with `<font>` elements* that
 * wrap the translated words. React has no idea this happened: it still holds a reference to
 * the original text node and still believes it to be a child of the element it rendered it
 * into. The next time React removes that node — any conditional render, any unmount — it
 * calls `parent.removeChild(textNode)` on a node that now lives one level deeper, inside
 * the injected `<font>`, and the DOM throws `NotFoundError`.
 *
 * React 19 wraps those two calls in `try/catch` and routes the failure to the nearest error
 * boundary (`commitDeletionEffectsOnFiber`), so this does not white-screen — it replaces
 * whatever the boundary wraps with a fallback. Observed in production as ORI-STUDIO-7/-8: a
 * Vietnamese user with Google Translate on (`<html class="translated-ltr">`, `<font>` nodes
 * throughout the breadcrumbs) lost the box-pleat optimizer dialog every time they pressed
 * Run, because that swaps the option rows out for a progress bar and the options hold two
 * Radix selects. Radix portals the selected item's label straight into the trigger as a bare
 * text node, which is exactly the shape the translator rewraps.
 *
 * The upstream issue is nine years old and will not be fixed in React (facebook/react#11538);
 * a translator is free to mutate the document and React's model of the DOM cannot survive
 * it. So the two options are to block translation or to tolerate it.
 *
 * **We tolerate it.** `<meta name="google" content="notranslate">` would end this outright,
 * but the app ships nine locales and Vietnamese is not one of them — the users this breaks
 * are precisely the ones with no other way to read the UI, and taking translation away to
 * protect them from a lost dialog is the wrong trade.
 *
 * What the guard gives up: a blocked `insertBefore` means a node React expected to appear
 * did not, so a translated page can render subtly stale. That is strictly better than the
 * boundary it replaces, and it is confined to sessions that are already being rewritten by
 * someone else.
 *
 * Deliberately narrow. Both wrappers check the one precondition that would otherwise throw
 * and are otherwise a straight pass-through, so nothing changes for a page nobody is
 * translating.
 */

/** Marks a patched prototype, so a second install cannot wrap the first. */
const INSTALLED = Symbol.for('ori-studio.translatedDomGuard');

/**
 * Whether an argument is a node whose parent this guard can meaningfully compare.
 *
 * Both wrappers take arguments the DOM itself accepts loosely, and neither may invent an
 * error from them. `insertBefore(node, undefined)` is a legal *append* — the reference
 * argument is nullable and `undefined` converts to `null` — and dockview relies on it, so
 * reading `.parentNode` off it took out the whole workspace shell. `removeChild(garbage)`
 * has a `TypeError` of its own to raise, and it should be the one to raise it. Anything
 * that fails this test goes straight through to the native method.
 *
 * Duck-typed rather than `instanceof Node`, which is per-realm: a node belonging to another
 * document (a popped-out dockview window) is not an `instanceof` match here, and silently
 * skipping the guard for it would be the wrong answer rather than a safe one.
 */
function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && 'parentNode' in value;
}

export type GuardedDomMethod = 'removeChild' | 'insertBefore';

export interface TranslatedDomGuardOptions {
  /**
   * Called when a call was blocked rather than allowed to throw.
   *
   * The caller decides what to do with it. `main.tsx` reports the first one of a session and
   * then goes quiet: one event says a translator is in play and which method it broke, and
   * every event after that says the same thing again — the observed session produced fifteen.
   */
  onBlocked?: (method: GuardedDomMethod) => void;
}

/**
 * Patch `Node.prototype`, and return the function that puts it back.
 *
 * Must run before the first render: React only needs to lose one node to lose a subtree.
 */
export function installTranslatedDomGuard(options: TranslatedDomGuardOptions = {}): () => void {
  const proto = globalThis.Node?.prototype as
    | (Node & { [INSTALLED]?: boolean })
    | undefined;
  // No DOM (SSR, a worker, the prerender) has nothing to protect.
  if (!proto || proto[INSTALLED]) return () => {};

  const originalRemoveChild = proto.removeChild;
  const originalInsertBefore = proto.insertBefore;

  proto.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (isNode(child) && child.parentNode !== this) {
      options.onBlocked?.('removeChild');
      // What the call would have returned had it succeeded. React ignores it.
      return child;
    }
    return originalRemoveChild.call(this, child) as T;
  };

  proto.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    node: T,
    child: Node | null
  ): T {
    if (isNode(child) && child.parentNode !== this) {
      options.onBlocked?.('insertBefore');
      return node;
    }
    return originalInsertBefore.call(this, node, child) as T;
  };

  proto[INSTALLED] = true;

  return () => {
    proto.removeChild = originalRemoveChild;
    proto.insertBefore = originalInsertBefore;
    delete proto[INSTALLED];
  };
}
