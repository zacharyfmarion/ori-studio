import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The workspace canvas places its three rows explicitly, which only works if each
 * rule targets an element that is really a **direct child** of the grid.
 *
 * This is the shape of a bug that shipped. `grid-row: 2` sat on
 * `.workspace-shell__dockview` — the class handed to `DockviewReact` as a prop.
 * Dockview puts that class on an element *inside* an unnamed wrapper of its own,
 * so the wrapper is what the grid places; it took `grid-row: auto`, and with no
 * tab strip above it (Edit and Simulate) auto-placed into row 1, an `auto` row.
 * The dock collapsed to 0px and both workspaces rendered blank. Design hid it:
 * its strip occupies row 1 explicitly, so the wrapper was pushed to row 2.
 *
 * jsdom does no layout, so rendering cannot catch this. What is checkable is the
 * rule the layout depends on: **a class handed to a layout library as a prop is
 * never a class we may place.**
 */

const here = dirname(new URL(import.meta.url).pathname);
const appCss = readFileSync(join(here, 'App.css'), 'utf8');
const shell = readFileSync(join(here, 'components/WorkspaceShell.tsx'), 'utf8');

/** Class names given an explicit `grid-row` anywhere in the app stylesheet. */
function placedClasses(): Set<string> {
  const placed = new Set<string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(appCss)) !== null) {
    if (!/\bgrid-row\s*:/.test(match[2])) continue;
    // The last class in the selector names the element being placed.
    const classes = match[1].match(/\.[\w-]+/g);
    if (classes) placed.add(classes[classes.length - 1].slice(1));
  }
  return placed;
}

/** Every class the shell hands to a dockview/gridview component as a prop. */
function classesGivenToLayoutLibrary(): Set<string> {
  const given = new Set<string>();
  const element = /<(Dockview|Gridview)\w*\b[^>]*?className="([^"]+)"/gs;
  let match: RegExpExecArray | null;
  while ((match = element.exec(shell)) !== null) {
    for (const name of match[2].split(/\s+/)) if (name) given.add(name);
  }
  return given;
}

describe('the workspace canvas grid', () => {
  it('never places a class the layout library receives as a prop', () => {
    const given = classesGivenToLayoutLibrary();
    // Guard the guard: if the shell stops passing a className, this test would
    // pass vacuously and stop protecting anything.
    expect(given.size).toBeGreaterThan(0);
    expect(given).toContain('workspace-shell__dockview');

    for (const className of given) {
      expect(
        placedClasses().has(className),
        `\`${className}\` is handed to a layout component, which may wrap it — ` +
          `place a wrapper this file renders instead`
      ).toBe(false);
    }
  });

  it('places a dock wrapper the shell owns', () => {
    expect(placedClasses()).toContain('workspace-shell__dock');
    expect(shell).toMatch(/className="workspace-shell__dock"/);
  });

  it('opens that wrapper before the dockview it contains', () => {
    // Outside the error boundary and the library element both — otherwise it is
    // not the element the canvas grid places.
    expect(shell.indexOf('workspace-shell__dock"')).toBeLessThan(shell.indexOf('<DockviewReact'));
  });
});
