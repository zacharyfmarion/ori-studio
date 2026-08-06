import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A design-tab read or write that runs *after* an `await` must name its design.
 *
 * With N designs open, every engine call is a worker round trip, so there is a
 * window between "the user asked" and "the answer came back" in which the active
 * tab can change. A selector or writer that resolves the active design inside
 * that window answers for whichever design is in front at settle time — not the
 * one the operation started on. The result is one design's document, history or
 * symmetry written over another's.
 *
 * Six of these shipped into this branch before anything caught them, including
 * one on the path every box-pleat edit takes. The compiler cannot see it: the
 * `designId` parameter is optional by design, because a *synchronous* write to
 * the active design is correct and is the common case.
 *
 * Nor is a captured id evidence on its own. `runBpTreeMutation` captured
 * `activeDesignId` before its first await and carried a comment saying the
 * gesture belonged to the design it started on — then passed it to nothing but a
 * `Map` key, while every real read and write went unaddressed. What matters is
 * where the id is *used*, which is what this scans for.
 */

/**
 * Reads and writes that take a design, and how many arguments precede it.
 *
 * **Box-pleat only, deliberately.** The TreeMaker equivalents
 * (`patchTreemakerDesign`, `syncTreemakerProject`, `selectProject`) have the
 * same shape and three live violations, but they cannot be fixed by pinning the
 * store write alone: `ensureTreeHandle()` resolves the *active* design's engine
 * handle, so a write pinned to the captured design would stamp one design's tree
 * onto another — worse than the wrong-design write it replaced. Correcting them
 * means threading a design through the engine runtime, which is its own change.
 * Adding them here before that lands would only mean disabling this test.
 *
 * The box-pleat mutation path has the same runtime gap, but its store write is
 * independent of it: the document handed to an operation is read synchronously
 * before the first await, so pinning the write is a strict improvement there.
 */
const ADDRESSED = [
  { name: 'patchBoxPleatDesign', designIdArg: 2 },
  { name: 'installBoxPleatDesign', designIdArg: 2 },
  { name: 'selectOristudioBpDocument', designIdArg: 1 },
  { name: 'selectOristudioBpSymmetry', designIdArg: 1 },
  { name: 'selectOristudioBpSelection', designIdArg: 1 },
  { name: 'selectOristudioBpHistoryPast', designIdArg: 1 },
  { name: 'selectOristudioBpHistoryFuture', designIdArg: 1 },
  { name: 'selectOristudioBpViewportFitRequestId', designIdArg: 1 },
];

const STORE_DIR = join(import.meta.dirname, '.');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.includes('.test.')) return [];
    return [path];
  });
}

/**
 * Blank out comments and string bodies, preserving offsets and newlines.
 *
 * Without this a `{@link patchBoxPleatDesign}` in a doc comment reads as a call
 * site, which is one of the two false positives an earlier ad-hoc version of
 * this scan produced.
 */
function blankNonCode(source: string): string {
  const out = source.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  while (i < source.length) {
    const pair = source.slice(i, i + 2);
    if (pair === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (pair === '/*') {
      const end = source.indexOf('*/', i);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    const char = source[i];
    if (char === "'" || char === '"' || char === '`') {
      let scan = i + 1;
      while (scan < source.length && source[scan] !== char) {
        if (source[scan] === '\\') scan += 1;
        scan += 1;
      }
      blank(i + 1, scan);
      i = scan + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/** The `{ … }` body of every `async` function, as [start, end) offsets. */
function asyncBodies(code: string): { start: number; end: number }[] {
  const bodies: { start: number; end: number }[] = [];
  for (const match of code.matchAll(/\basync\b/g)) {
    // The body opens at the first `{` that is not inside the parameter list.
    let i = match.index ?? 0;
    let parens = 0;
    // Braces are tracked too: a parameter's inline type literal
    // (`options: { dragging?: boolean } = {}`) contains both `{` and `;`, and an
    // earlier version of this walk mistook that `;` for the end of a bodiless
    // declaration — silently skipping the enclosing function, which is the one
    // every box-pleat mutation lives in. The scan then reported nothing and
    // looked like a pass.
    let braces = 0;
    let open = -1;
    while (i < code.length) {
      const char = code[i];
      if (char === '(') parens += 1;
      else if (char === ')') parens -= 1;
      else if (char === '{') {
        if (parens === 0 && braces === 0) {
          open = i;
          break;
        }
        braces += 1;
      } else if (char === '}') braces -= 1;
      else if (char === ';' && parens === 0 && braces === 0) break;
      i += 1;
    }
    if (open === -1) continue;
    let depth = 0;
    let j = open;
    while (j < code.length) {
      if (code[j] === '{') depth += 1;
      else if (code[j] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      j += 1;
    }
    bodies.push({ start: open, end: j });
  }
  return bodies;
}

/** Argument count of the call whose `(` sits at `open`, counting top level only. */
function argumentCount(code: string, open: number): number {
  let depth = 0;
  let args = 0;
  let seenContent = false;
  for (let i = open; i < code.length; i += 1) {
    const char = code[i];
    if (char === '(' || char === '[' || char === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (char === ')' || char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return seenContent ? args + 1 : 0;
    } else if (char === ',' && depth === 1) {
      args += 1;
      continue;
    }
    if (depth >= 1 && !/\s/.test(char)) seenContent = true;
  }
  return seenContent ? args + 1 : 0;
}

/**
 * Innermost enclosing body, so a synchronous callback nested inside an async
 * function is judged on its own. `selectAll: () => set(patchTreemakerDesign(…))`
 * sitting after an unrelated `await` in a sibling action was the other false
 * positive of the ad-hoc scan.
 */
function innermostBody(
  bodies: { start: number; end: number }[],
  at: number
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const body of bodies) {
    if (at <= body.start || at >= body.end) continue;
    if (!best || body.start > best.start) best = body;
  }
  return best;
}

describe('a design-tab access after an await names its design', () => {
  const files = sourceFiles(STORE_DIR);

  it('scans a meaningful number of store files', () => {
    // Guards every assertion below from passing because the walk found nothing.
    expect(files.length).toBeGreaterThan(10);
  });

  it('has no unaddressed read or write following an await', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = blankNonCode(readFileSync(file, 'utf8'));
      const bodies = asyncBodies(code);
      if (bodies.length === 0) continue;
      for (const { name, designIdArg } of ADDRESSED) {
        for (const match of code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))) {
          const at = match.index ?? 0;
          const open = at + name.length;
          if (argumentCount(code, open) > designIdArg) continue;
          const body = innermostBody(bodies, at);
          if (!body) continue;
          // Only an await *this* function performs before reaching the call.
          const preceding = code.slice(body.start, at);
          if (!/\bawait\b/.test(preceding)) continue;
          const line = code.slice(0, at).split('\n').length;
          offenders.push(`${file.replace(STORE_DIR, '.')}:${line} → ${name}`);
        }
      }
    }
    expect(
      offenders,
      'These resolve the active design after an await, so a tab switch during the ' +
        'round trip lands the result on the wrong design. Capture `activeDesignId` ' +
        'before the first await and pass it as the trailing argument.'
    ).toEqual([]);
  });
});
