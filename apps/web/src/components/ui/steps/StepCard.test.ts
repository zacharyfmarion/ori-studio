import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The rule a step card's size depends on in WebKit.
 *
 * The Steps grid lays a freshly mounted row out at one column, then sets its
 * measured columns on the same row, and a resize changes them the same way: a
 * card narrows in place. With an auto column, WebKit kept the column at the
 * one-column width (the square well's minimum width comes from its height), so
 * the card stayed as tall as the pane was wide. jsdom does no layout, so a
 * rendered card cannot catch that; what is checkable is the rule that prevents
 * it: **the card's one column may shrink to nothing.**
 */
const moduleCss = readFileSync(
  resolve(process.cwd(), 'src/components/ui/steps/StepCard.module.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declaration block of the top-level rule whose selector is exactly `selector`. */
function declarations(selector: string): string {
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(moduleCss)) !== null) {
    if (match[1].trim() === selector) return match[2];
  }
  throw new Error(`no rule for ${selector}`);
}

describe('a step card', () => {
  it('has one column that can shrink to the card, whatever its well asks for', () => {
    expect(declarations('.card')).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  });
});
