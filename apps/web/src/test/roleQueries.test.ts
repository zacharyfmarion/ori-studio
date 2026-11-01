// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { accessibleName, allByRole, byRole, queryByRole } from './roleQueries';

let host: HTMLDivElement | null = null;

afterEach(() => {
  host?.remove();
  host = null;
});

function html(markup: string): HTMLDivElement {
  host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
}

describe('roleQueries', () => {
  it('names an element by its label, its labelling element, or its content without what is hidden', () => {
    const root = html(`
      <button aria-label="Close">x</button>
      <span id="title">Fold <b>tools</b></span>
      <div role="dialog" aria-labelledby="title"></div>
      <button><span aria-hidden="true">V</span><span>Valley fold</span><span>Fold it toward you.</span></button>
    `);
    const [close, valley] = allByRole(root, 'button');
    expect(close && accessibleName(close)).toBe('Close');
    expect(valley && accessibleName(valley)).toBe('Valley fold Fold it toward you.');
    expect(accessibleName(byRole(root, 'dialog', 'Fold tools'))).toBe('Fold tools');
  });

  it('finds the implicit roles, and throws listing the names when not exactly one matches', () => {
    const root = html(
      '<aside aria-label="Tools"></aside><section aria-label="Pane"></section><section></section><button>One</button><button>One</button>'
    );
    expect(byRole(root, 'complementary', 'Tools').tagName).toBe('ASIDE');
    // A section is a region only with a name.
    expect(allByRole(root, 'region').map((element) => accessibleName(element))).toEqual(['Pane']);
    expect(() => byRole(root, 'button', 'One')).toThrow(/found 2\. There are: "One", "One"/);
    expect(queryByRole(root, 'button', /^Two/)).toBeNull();
  });
});
