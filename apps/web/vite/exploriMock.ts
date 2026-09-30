import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

/**
 * ExplOri search answered from local fixtures, for development that never
 * reaches `225.designorigami.net`.
 *
 * Upstream is one person's machine, and every dev search today lands on it. With
 * `EXPLORI_MOCK=1` the dev server answers `/api/explori/query` and
 * `/api/explori/tiling` itself from the bundles `scripts/explori/build-fixtures.py`
 * wrote — real tilings from the archive's own database files, serialized by its
 * own code, kept in an ignored directory because that data is private — and
 * `vite.config.ts` drops the upstream proxy at the same time, so nothing can
 * slip through.
 *
 * It is not a search engine and does not pretend to be. A query is answered
 * with the fixtures whose database matches, ranked by how alike the trees are
 * in size (leaf count first, node count second) and given a distance that
 * spreads them across upstream's quality buckets, so the results pane shows
 * every state it has. When no fixture matches the requested databases the
 * whole pool is used and the log says so, because an empty pane teaches
 * nothing about rendering.
 */

/**
 * Where the bundles live: an ignored directory, and only there. The archive's
 * tiling data is private and stays on the machine that holds its database
 * files; nothing of it is committed.
 */
const FIXTURE_DIRS = ['artifacts/explori/local-tilings'];
/** Long enough that the searching state is visible; short enough not to be a wait. */
const DELAY_MS = 300;
const MAX_BODY_BYTES = 256 * 1024;

interface TreeShape {
  nodes: { id: number | string }[];
  edges: { u: number | string; v: number | string }[];
}

export interface FixtureResult {
  N: number;
  symmetry: string;
  tiling_id: number;
  tree?: TreeShape | null;
  [key: string]: unknown;
}

export function exploriMockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EXPLORI_MOCK === '1';
}

export function loadFixturePool(repoRoot: string): { pool: FixtureResult[]; dirs: string[] } {
  const pool: FixtureResult[] = [];
  const dirs: string[] = [];
  for (const relative of FIXTURE_DIRS) {
    const dir = resolve(repoRoot, relative);
    if (!existsSync(dir)) continue;
    dirs.push(relative);
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.json')).sort()) {
      try {
        const bundle = JSON.parse(readFileSync(resolve(dir, name), 'utf8')) as { results?: unknown };
        if (!Array.isArray(bundle.results)) continue;
        for (const entry of bundle.results) {
          if (entry && typeof entry === 'object' && typeof (entry as FixtureResult).tiling_id === 'number') {
            pool.push(entry as FixtureResult);
          }
        }
      } catch {
        // A bundle that does not parse is left out; the client's own fixture
        // test is where that fails loudly.
      }
    }
  }
  return { pool, dirs };
}

/** Leaf and node counts of a tree, the two numbers the ranking compares. */
export function treeShape(tree: TreeShape | null | undefined): { leaves: number; nodes: number } {
  if (!tree) return { leaves: 0, nodes: 0 };
  const degree = new Map<string, number>();
  for (const node of tree.nodes) degree.set(String(node.id), 0);
  for (const edge of tree.edges) {
    degree.set(String(edge.u), (degree.get(String(edge.u)) ?? 0) + 1);
    degree.set(String(edge.v), (degree.get(String(edge.v)) ?? 0) + 1);
  }
  let leaves = 0;
  for (const count of degree.values()) if (count <= 1) leaves += 1;
  return { leaves, nodes: degree.size };
}

/**
 * Upstream's quality buckets sit at 0.75, 1.5, 3 and 4 thousandths; a size
 * difference of one lands in "good", two in "acceptable", and six is distant.
 */
function distanceFor(score: number): number {
  return (0.5 + 0.6 * score) / 1000;
}

export interface RankedQuery {
  tree: TreeShape;
  dbConfigs: { N: number; symmetry: string }[];
  n: number;
}

export function rankFixtures(
  pool: readonly FixtureResult[],
  query: RankedQuery
): { results: FixtureResult[]; fellBack: boolean } {
  const wanted = new Set(query.dbConfigs.map((config) => `${config.N}:${config.symmetry}`));
  let candidates = pool.filter((result) => wanted.has(`${result.N}:${result.symmetry}`));
  const fellBack = candidates.length === 0;
  if (fellBack) candidates = [...pool];
  const shape = treeShape(query.tree);
  const scored = candidates.map((result) => {
    const own = treeShape(result.tree);
    const score = Math.abs(own.leaves - shape.leaves) + 0.5 * Math.abs(own.nodes - shape.nodes);
    return { result, score };
  });
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      a.result.N - b.result.N ||
      a.result.symmetry.localeCompare(b.result.symmetry) ||
      a.result.tiling_id - b.result.tiling_id
  );
  return {
    results: scored.slice(0, Math.max(1, query.n)).map(({ result, score }, index) => ({
      ...result,
      rank: index + 1,
      distance: distanceFor(score),
    })),
    fellBack,
  };
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
      if (body.length > MAX_BODY_BYTES) req.destroy(new Error('body too large'));
    });
    req.on('end', () => resolveBody(body));
    req.on('error', reject);
  });
}

export function exploriMock(repoRoot: string): Plugin {
  return {
    name: 'ori-explori-mock',
    apply: 'serve',
    configureServer(server) {
      const { pool, dirs } = loadFixturePool(repoRoot);
      const log = server.config.logger;
      log.info(
        `  ➜  explori:  MOCK — ${pool.length} local tilings from ${dirs.join(', ') || 'no fixture directory'}; nothing reaches upstream`
      );

      server.middlewares.use('/api/explori/query', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { code: 'method_not_allowed', error: 'POST a query.' });
          return;
        }
        void readBody(req)
          .then((text) => {
            const payload = JSON.parse(text) as Partial<RankedQuery> & { db_configs?: RankedQuery['dbConfigs'] };
            const tree = payload.tree;
            if (!tree || !Array.isArray(tree.nodes) || !Array.isArray(tree.edges)) {
              sendJson(res, 400, { code: 'invalid_tree', error: 'The query needs a tree with nodes and edges.' });
              return;
            }
            const ranked = rankFixtures(pool, {
              tree,
              dbConfigs: Array.isArray(payload.db_configs) ? payload.db_configs : [],
              n: typeof payload.n === 'number' ? payload.n : 5,
            });
            if (ranked.fellBack) {
              log.info('  ➜  explori:  MOCK — no fixture for the requested databases; answering from the whole pool');
            }
            setTimeout(() => {
              sendJson(res, 200, {
                query_id: `mock:${Date.now()}`,
                db_configs: payload.db_configs ?? [],
                results: ranked.results,
              });
            }, DELAY_MS);
          })
          .catch(() => sendJson(res, 400, { code: 'invalid_body', error: 'Expected a JSON body.' }));
      });

      server.middlewares.use('/api/explori/tiling', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const id = Number.parseInt(url.searchParams.get('id') ?? '', 10);
        const N = Number.parseInt(url.searchParams.get('N') ?? '', 10);
        const symmetry = url.searchParams.get('sym') ?? '';
        const found = pool.find(
          (result) => result.tiling_id === id && result.N === N && result.symmetry === symmetry
        );
        if (!found) {
          sendJson(res, 404, { code: 'not_found', error: 'No such tiling in the local fixtures.' });
          return;
        }
        sendJson(res, 200, { query_id: `mock:${Date.now()}`, results: [{ ...found, rank: 1, distance: 0 }] });
      });
    },
  };
}
