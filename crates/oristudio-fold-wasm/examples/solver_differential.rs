//! Differential harness for the Fold workspace's layer-order solver
//! (`implementation-plans/fold-solver-performance.md`).
//!
//! It drives the solver only through APIs that exist both before and after
//! the performance work, so the same file builds against an older checkout
//! (copied into its `crates/oristudio-fold-wasm/examples/`) and the two
//! outputs can be diffed byte for byte.
//!
//! ```sh
//! solver_differential dump <out_dir> <file>...      # one <case>.json each
//! solver_differential questions <out_dir> <n> <file>...
//! ```
//!
//! Every file goes through Import CP's own path: the kernel's loader for its
//! format, the stored `cpJson` read back, then `ImportedPattern::new` after
//! the flat sheet the pattern adopts (`io::imports::import`).
//!
//! `dump` writes, per case, the import's sizes and two completions with fixed
//! node budgets: the open (`per_component = 1`) and the background count
//! (`per_component = 1000`). Forced pairs, components, orders, counts, node
//! counts and refusals are all written; large lists are written as a length
//! and a hash. Timings go to a separate `<case>.timing.json` so the
//! canonical file is deterministic.
//!
//! `questions` draws `n` random checks per case from a seed that depends only
//! on the case ("on top here", "A above B", combinations, some against forced
//! pairs) and answers each with `complete_with` from scratch, writing
//! `<case>.questions.json`. The session harness (`solver_session_check`)
//! answers the same questions and compares.
//!
//! Environment: `OPEN_NODES` (default 200000), `COUNT_NODES` (200000),
//! `CHECK_NODES` (200000), `QUESTION_SEED` (1).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::Instant;

use oristudio_fold::complete::{CompletionLimits, Completions, FixedKind, FixedPair};
use oristudio_fold::{
    FaceId, ImportRefusal, ImportTarget, ImportedPattern, Sheet, StartSide, State,
};
use oristudio_fold_wasm::io::kernel::{cp_json, input_of_cp_json, load};
use oristudio_fold_wasm::io::wire::CpFormat;
use serde_json::{Value, json};

/// Lists longer than this are written as a length and a hash.
const INLINE_LIMIT: usize = 4096;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let usage =
        "usage: solver_differential dump <out_dir> <file>... | questions <out_dir> <n> <file>...";
    let mode = args
        .get(1)
        .map(String::as_str)
        .unwrap_or_else(|| panic!("{usage}"));
    let out = PathBuf::from(args.get(2).unwrap_or_else(|| panic!("{usage}")));
    std::fs::create_dir_all(&out).unwrap_or_else(|e| panic!("{}: {e}", out.display()));
    match mode {
        "dump" => {
            for file in &args[3..] {
                dump(&out, Path::new(file));
            }
        }
        "questions" => {
            let n: usize = args
                .get(3)
                .and_then(|n| n.parse().ok())
                .unwrap_or_else(|| panic!("{usage}"));
            for file in &args[4..] {
                questions(&out, Path::new(file), n);
            }
        }
        _ => panic!("{usage}"),
    }
}

fn env_u64(key: &str, default: u64) -> u64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// `truth.fold` cases are named by their directory, anything else by its stem.
pub fn case_name(path: &Path) -> String {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("case");
    if (stem == "truth" || stem == "topology")
        && let Some(dir) = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str())
    {
        return dir.to_string();
    }
    stem.to_string()
}

fn format_of(path: &Path) -> CpFormat {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "cp" => CpFormat::Cp,
        "ori" => CpFormat::Ori,
        "orh" => CpFormat::Orh,
        _ => CpFormat::Fold,
    }
}

/// Import CP's path into an empty sequence, front up.
pub fn import(path: &Path) -> Result<ImportedPattern, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
    let model = load(format_of(path), &bytes).map_err(|e| format!("load: {e:?}"))?;
    let text = cp_json(&model).map_err(|e| format!("cp_json: {e:?}"))?;
    let input = input_of_cp_json(&text).map_err(|e| format!("input: {e:?}"))?;
    let start = StartSide::Front;
    let found = ImportedPattern::new(&input, ImportTarget::Empty { start })
        .map_err(|e| e.code().to_string())?;
    let flat = Sheet::new(&found.summary().shape)
        .and_then(|sheet| State::flat(sheet, start))
        .map_err(|e| format!("flat: {e}"))?;
    ImportedPattern::new(&input, ImportTarget::After(&flat)).map_err(|e| e.code().to_string())
}

/// FNV-1a over a canonical byte stream.
#[derive(Clone, Copy)]
pub struct Fnv(u64);

impl Default for Fnv {
    fn default() -> Fnv {
        Fnv::new()
    }
}

impl Fnv {
    pub fn new() -> Fnv {
        Fnv(0xcbf2_9ce4_8422_2325)
    }

    pub fn u64(&mut self, value: u64) {
        for byte in value.to_le_bytes() {
            self.0 ^= u64::from(byte);
            self.0 = self.0.wrapping_mul(0x0100_0000_01b3);
        }
    }

    pub fn hex(self) -> String {
        format!("{:016x}", self.0)
    }
}

fn hashed_pairs(pairs: &[[FaceId; 2]]) -> Value {
    let mut h = Fnv::new();
    for [a, b] in pairs {
        h.u64(u64::from(a.0));
        h.u64(u64::from(b.0));
    }
    if pairs.len() <= INLINE_LIMIT {
        json!({
            "len": pairs.len(),
            "hash": h.hex(),
            "pairs": pairs.iter().map(|[a, b]| [a.0, b.0]).collect::<Vec<_>>(),
        })
    } else {
        json!({ "len": pairs.len(), "hash": h.hex() })
    }
}

fn completions_json(completions: &Completions) -> Value {
    let forced = completions.forced_pairs();
    let components: Vec<Value> = completions
        .components()
        .iter()
        .map(|c| {
            let pairs: Vec<[FaceId; 2]> = c.pairs.iter().map(|p| [p.lo(), p.hi()]).collect();
            let mut h = Fnv::new();
            for order in &c.orders {
                h.u64(order.len() as u64);
                for &lo_above in order {
                    h.u64(u64::from(lo_above));
                }
            }
            let cells = c.pairs.len() * c.orders.len();
            let mut value = json!({
                "pairs": hashed_pairs(&pairs),
                "orders_len": c.orders.len(),
                "orders_hash": h.hex(),
                "truncated": c.truncated,
            });
            if cells <= INLINE_LIMIT {
                value["orders"] = json!(
                    c.orders
                        .iter()
                        .map(|o| o.iter().map(|&b| u8::from(b)).collect::<Vec<_>>())
                        .collect::<Vec<_>>()
                );
            }
            value
        })
        .collect();
    let count = completions.count();
    json!({
        "status": "ok",
        "nodes": completions.nodes(),
        "count": { "orders": count.orders, "exact": count.exact },
        "forced": hashed_pairs(&forced),
        "components": components,
    })
}

fn refusal_json(refusal: &ImportRefusal) -> Value {
    json!({
        "status": refusal.code(),
        "refusal": serde_json::to_value(refusal).unwrap_or(Value::Null),
    })
}

fn completion_json(result: &Result<Completions, ImportRefusal>) -> Value {
    match result {
        Ok(completions) => completions_json(completions),
        Err(refusal) => refusal_json(refusal),
    }
}

fn limits(per_component: usize, max_nodes: u64) -> CompletionLimits {
    CompletionLimits {
        per_component,
        max_nodes: Some(max_nodes),
        deadline: None,
    }
}

fn ms(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1e3
}

fn write(path: &Path, value: &Value) {
    let text = serde_json::to_string_pretty(value).unwrap_or_default();
    let partial = path.with_extension("partial");
    std::fs::write(&partial, text + "\n").unwrap_or_else(|e| panic!("{}: {e}", partial.display()));
    std::fs::rename(&partial, path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
}

fn dump(out: &Path, path: &Path) {
    let name = case_name(path);
    let target = out.join(format!("{name}.json"));
    if target.exists() {
        return;
    }
    let open_nodes = env_u64("OPEN_NODES", 200_000);
    let count_nodes = env_u64("COUNT_NODES", 200_000);
    let started = Instant::now();
    let imported = import(path);
    let import_ms = ms(started);
    let mut canonical = json!({
        "case": name,
        "open_nodes": open_nodes,
        "count_nodes": count_nodes,
    });
    let mut timing = json!({ "case": name, "import_ms": import_ms });
    match imported {
        Err(code) => canonical["import"] = json!(code),
        Ok(imported) => {
            let unordered = imported.unordered();
            let problem = unordered.problem();
            canonical["import"] = json!("ok");
            canonical["faces"] = json!(unordered.view().faces().len());
            canonical["variables"] = json!(problem.variables().len());
            canonical["cells"] = json!(problem.overlay().cells().len());
            canonical["max_ply"] = json!(
                problem
                    .overlay()
                    .cells()
                    .iter()
                    .map(|c| c.faces.len())
                    .max()
                    .unwrap_or(0)
            );
            canonical["letters"] = json!(unordered.letter_seeds().len());
            let t = Instant::now();
            let open = imported.complete(&limits(1, open_nodes));
            timing["open_ms"] = json!(ms(t));
            canonical["open"] = completion_json(&open);
            let t = Instant::now();
            let count = imported.complete(&limits(1000, count_nodes));
            timing["count_ms"] = json!(ms(t));
            canonical["count"] = completion_json(&count);
        }
    }
    write(&out.join(format!("{name}.timing.json")), &timing);
    write(&target, &canonical);
    eprintln!("{name}: {:.0} ms", ms(started));
}

/// xorshift64*.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed.max(1))
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next_u64() % n as u64) as usize
        }
    }
}

fn seed(kind: FixedKind) -> impl Fn([FaceId; 2]) -> FixedPair {
    move |[upper, lower]| FixedPair { upper, lower, kind }
}

/// One random question: the seeds as `[upper, lower]`, and its kind.
fn draw(
    rng: &mut Rng,
    imported: &ImportedPattern,
    forced: &BTreeSet<(FaceId, FaceId)>,
    first: &oristudio_fold::complete::Completions,
) -> (&'static str, Vec<[FaceId; 2]>) {
    let problem = imported.unordered().problem();
    let cells: Vec<&Vec<FaceId>> = problem
        .overlay()
        .cells()
        .iter()
        .map(|c| &c.faces)
        .filter(|f| f.len() >= 2)
        .collect();
    let order = first.order(&vec![0; first.components().len()]);
    let variables = problem.variables();
    let is_forced = |a: FaceId, b: FaceId| forced.contains(&(a, b)) || forced.contains(&(b, a));
    let top = |rng: &mut Rng| -> Vec<[FaceId; 2]> {
        let cell = cells[rng.below(cells.len())];
        let choosable: Vec<FaceId> = cell
            .iter()
            .copied()
            .filter(|&x| !cell.iter().any(|&y| y != x && forced.contains(&(y, x))))
            .collect();
        let x = if !choosable.is_empty() && rng.below(10) < 7 {
            choosable[rng.below(choosable.len())]
        } else {
            cell[rng.below(cell.len())]
        };
        cell.iter().filter(|&&y| y != x).map(|&y| [x, y]).collect()
    };
    let pair = |rng: &mut Rng| -> Vec<[FaceId; 2]> {
        let mut pick = variables[rng.below(variables.len())];
        if is_forced(pick.lo(), pick.hi()) && rng.below(2) == 0 {
            for _ in 0..20 {
                let again = variables[rng.below(variables.len())];
                if !is_forced(again.lo(), again.hi()) {
                    pick = again;
                    break;
                }
            }
        }
        let (lo, hi) = (pick.lo(), pick.hi());
        let lo_above = order.as_ref().and_then(|o| o.above(lo, hi)).unwrap_or(true);
        let flip = rng.below(10) < 7;
        if lo_above != flip {
            vec![[lo, hi]]
        } else {
            vec![[hi, lo]]
        }
    };
    let one = |rng: &mut Rng| {
        if !cells.is_empty() && rng.below(2) == 0 {
            top(rng)
        } else {
            pair(rng)
        }
    };
    let roll = rng.below(100);
    if roll < 45 && !cells.is_empty() {
        ("top", top(rng))
    } else if roll < 80 {
        ("pair", pair(rng))
    } else {
        let parts = 2 + rng.below(2);
        let mut all = Vec::new();
        for _ in 0..parts {
            all.extend(one(rng));
        }
        ("combo", all)
    }
}

/// The verdict of a `complete_with` answer.
pub fn verdict(result: &Result<Completions, ImportRefusal>) -> &'static str {
    use oristudio_fold::complete::CompletionRefusal as R;
    match result {
        Ok(_) => "feasible",
        Err(ImportRefusal::NoOrder { refusal, .. }) => match refusal {
            R::Conflict { .. } => "conflict",
            R::NoOrder { .. } => "no_order",
            R::FixedContradictory { .. } => "fixed_contradictory",
            _ => "other",
        },
        Err(ImportRefusal::BudgetExceeded { .. }) => "budget",
        Err(_) => "other",
    }
}

fn questions(out: &Path, path: &Path, n: usize) {
    let name = case_name(path);
    let target = out.join(format!("{name}.questions.json"));
    if target.exists() {
        return;
    }
    let open_nodes = env_u64("OPEN_NODES", 200_000);
    let check_nodes = env_u64("CHECK_NODES", 200_000);
    let started = Instant::now();
    let imported = match import(path) {
        Ok(imported) => imported,
        Err(code) => {
            write(
                &target,
                &json!({ "case": name, "import": code, "questions": [] }),
            );
            return;
        }
    };
    let open = match imported.complete(&limits(1, open_nodes)) {
        Ok(open) => open,
        Err(refusal) => {
            write(
                &target,
                &json!({ "case": name, "import": "ok", "open": refusal.code(), "questions": [] }),
            );
            return;
        }
    };
    if imported.unordered().problem().variables().is_empty() {
        write(
            &target,
            &json!({ "case": name, "import": "ok", "open": "ok", "questions": [] }),
        );
        return;
    }
    let forced: BTreeSet<(FaceId, FaceId)> = open
        .forced_pairs()
        .into_iter()
        .map(|[u, l]| (u, l))
        .collect();
    let mut h = Fnv::new();
    for byte in name.bytes() {
        h.u64(u64::from(byte));
    }
    let mut rng = Rng::new(h.0 ^ env_u64("QUESTION_SEED", 1));
    let mut answers = Vec::with_capacity(n);
    for id in 0..n {
        let (kind, pairs) = draw(&mut rng, &imported, &forced, &open);
        let fixed: Vec<FixedPair> = pairs.iter().copied().map(seed(FixedKind::Seed)).collect();
        let t = Instant::now();
        let answer = imported.complete_with(&fixed, &limits(1, check_nodes));
        let elapsed = ms(t);
        let nodes = match &answer {
            Ok(c) => c.nodes(),
            Err(ImportRefusal::BudgetExceeded { nodes, .. }) => *nodes,
            Err(_) => 0,
        };
        answers.push(json!({
            "id": id,
            "kind": kind,
            "pairs": pairs.iter().map(|[u, l]| [u.0, l.0]).collect::<Vec<_>>(),
            "verdict": verdict(&answer),
            "nodes": nodes,
            "ms": elapsed,
            "refusal": answer.as_ref().err().map(|r| serde_json::to_value(r).unwrap_or(Value::Null)),
        }));
    }
    write(
        &target,
        &json!({
            "case": name,
            "import": "ok",
            "open": "ok",
            "check_nodes": check_nodes,
            "questions": answers,
        }),
    );
    eprintln!("{name}: {n} questions in {:.0} ms", ms(started));
}
