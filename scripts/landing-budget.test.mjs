import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkLandingBudget, landingFiles } from './landing-budget.mjs';

function dist(files, html) {
  const root = mkdtempSync(join(tmpdir(), 'ori-landing-'));
  mkdirSync(join(root, 'assets'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'assets', name), text);
  writeFileSync(join(root, 'index.html'), html);
  return root;
}

const HTML = `<!doctype html><html><head>
  <script type="module" crossorigin src="/assets/index-a.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-a.css">
</head><body><div id="root"></div></body></html>`;

test('follows the entry’s static imports, and stops at dynamic ones', () => {
  const root = dist(
    {
      'index-a.js': 'import{a as b}from"./shared-b.js";import"./side-c.js";const w=()=>import("./workspace-d.js");',
      'shared-b.js': 'export{x}from"./leaf-e.js";',
      'side-c.js': '',
      'leaf-e.js': '',
      'workspace-d.js': 'a very large workspace',
      'index-a.css': 'body{}',
    },
    HTML
  );
  assert.deepEqual(landingFiles(root), {
    js: ['/assets/index-a.js', '/assets/shared-b.js', '/assets/leaf-e.js', '/assets/side-c.js'],
    css: ['/assets/index-a.css'],
  });
});

test('passes under budget, and names the files when over it', () => {
  const root = dist({ 'index-a.js': 'console.log(1)', 'index-a.css': 'body{}' }, HTML);
  assert.deepEqual(checkLandingBudget(root), []);

  const problems = checkLandingBudget(root, { js: 1, css: 1_000_000 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /landing JS is .* over its .* budget \(\/assets\/index-a\.js\)/);
});

test('says so when there is no build to measure', () => {
  const root = mkdtempSync(join(tmpdir(), 'ori-landing-'));
  assert.match(checkLandingBudget(root)[0], /was the web app built/);
});
