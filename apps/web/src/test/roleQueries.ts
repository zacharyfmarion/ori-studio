/**
 * Finding elements as assistive tech does — by role and accessible name — for
 * tests that must not reach for a module class (`docs/styling.md`). A small
 * subset of the accessible-name rules: `aria-label`, then `aria-labelledby`,
 * then the content, leaving out what is `aria-hidden` and keeping elements
 * apart by a space; and the implicit roles the app's components rely on (a
 * `<button>` is a button, an `<aside>` complementary, a named `<section>` a
 * region).
 */

const IMPLICIT_ROLES: Readonly<Record<string, string>> = {
  button: 'button:not([role])',
  complementary: 'aside:not([role])',
  // A `<section>` is a region only when it has a name.
  region: 'section[aria-label]:not([role]), section[aria-labelledby]:not([role])',
  heading: 'h1:not([role]), h2:not([role]), h3:not([role]), h4:not([role]), h5:not([role]), h6:not([role])',
};

/** The text a node contributes to a name from its content. */
function contentText(node: Node): string {
  if (node.nodeType === node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof Element) || node.getAttribute('aria-hidden') === 'true') return '';
  const label = node.getAttribute('aria-label');
  const own = label ?? [...node.childNodes].map(contentText).join('');
  return ` ${own} `;
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** An element's accessible name, by the rules above, with its white space collapsed. */
export function accessibleName(element: Element): string {
  const label = element.getAttribute('aria-label');
  if (label) return label;
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    return collapse(
      labelledBy
        .split(/\s+/)
        .map((id) => {
          const named = element.ownerDocument.getElementById(id);
          return named ? contentText(named) : '';
        })
        .join(' ')
    );
  }
  return collapse([...element.childNodes].map(contentText).join(''));
}

/** Every element under `root` with the role, in document order. */
export function allByRole(root: ParentNode, role: string): HTMLElement[] {
  const implicit = IMPLICIT_ROLES[role];
  const selector = implicit ? `[role="${role}"], ${implicit}` : `[role="${role}"]`;
  return [...root.querySelectorAll<HTMLElement>(selector)];
}

/** The one element under `root` with the role and name; throws, listing the names there are, when not exactly one. */
export function byRole(root: ParentNode, role: string, name: string | RegExp): HTMLElement {
  const all = allByRole(root, role);
  const matches = all.filter((element) => {
    const accessible = accessibleName(element);
    return typeof name === 'string' ? accessible === name : name.test(accessible);
  });
  const [only] = matches;
  if (matches.length !== 1 || !only) {
    throw new Error(
      `Expected one ${role} named ${String(name)}, found ${matches.length}. There are: ${all
        .map((element) => JSON.stringify(accessibleName(element)))
        .join(', ')}`
    );
  }
  return only;
}

/** The element under `root` with the role and name, or null when there is none. */
export function queryByRole(root: ParentNode, role: string, name: string | RegExp): HTMLElement | null {
  return (
    allByRole(root, role).find((element) => {
      const accessible = accessibleName(element);
      return typeof name === 'string' ? accessible === name : name.test(accessible);
    }) ?? null
  );
}
