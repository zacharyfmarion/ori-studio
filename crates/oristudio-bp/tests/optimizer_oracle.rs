use oristudio_bp::engine::BpSession;
use oristudio_bp::io::{bps, bpz, treemaker_import};
use oristudio_bp::model::{GridType, Point, Project};
use oristudio_bp::optimizer::{
    FlapRequest, LayoutMode, OptimizerCommand, OptimizerOptionsBase, OptimizerProblem,
    OptimizerRequest, OptimizerResult, create_optimizer_request, solve, validate_optimizer_packing,
};
use oristudio_bp::tree::Hierarchy;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[test]
#[ignore = "runs the vendored BP Studio optimizer oracle over deterministic batches"]
fn optimizer_batch_produces_valid_packings_against_bp_studio_oracle() {
    let repo = repo_root();
    let oracle = repo.join("tools/bp-studio-oracle/oracle.mjs");
    let cases = optimizer_cases();
    assert!(
        cases.len() >= 400,
        "expected hundreds of optimizer cases, got {}",
        cases.len()
    );

    let mut exact = 0;
    let mut valid_different = 0;
    let mut invalid = Vec::new();
    for case in &cases {
        let rust = solve(&case.request, Some(case.seed)).unwrap_or_else(|err| {
            panic!(
                "rust solve failed for case {} seed {}: {err}",
                case.name, case.seed
            )
        });
        if let Err(error) = validate_optimizer_packing(&case.request, &rust) {
            invalid.push(format!(
                "{} seed {}: rust invalid: {error}; result={rust:?}",
                case.name, case.seed
            ));
            continue;
        }
        let oracle_result = run_oracle(&oracle, &case.request, case.seed);
        if let Err(error) = validate_optimizer_packing(&case.request, &oracle_result) {
            invalid.push(format!(
                "{} seed {}: oracle invalid under Rust checker: {error}; result={oracle_result:?}",
                case.name, case.seed
            ));
            continue;
        }
        if rust == oracle_result {
            exact += 1;
        } else {
            valid_different += 1;
        }
    }

    eprintln!(
        "optimizer oracle batch: exact={exact} valid_different={valid_different} total={}",
        cases.len()
    );
    if !invalid.is_empty() {
        for entry in invalid.iter().take(20) {
            eprintln!("{entry}");
        }
        panic!(
            "{} invalid optimizer packings across {} cases",
            invalid.len(),
            cases.len()
        );
    }
}

#[test]
#[ignore = "requires BP_STUDIO_CORPUS to point at private .bps/.bpz/.tmd5 files"]
fn optimizer_external_corpus_produces_valid_packings_when_enabled() {
    let Some(root) = std::env::var_os("BP_STUDIO_CORPUS").map(PathBuf::from) else {
        eprintln!("skipping BP Studio corpus validation; set BP_STUDIO_CORPUS to enable");
        return;
    };
    let mut checked = 0;
    let mut skipped = 0;
    let mut invalid = Vec::new();
    for path in corpus_paths(&root) {
        let projects = match load_corpus_projects(&path) {
            Ok(projects) => projects,
            Err(error) => {
                skipped += 1;
                eprintln!("skipping {}: {error}", path.display());
                continue;
            }
        };
        for (index, project) in projects.into_iter().enumerate() {
            let label = format!("{}#{index}", path.display());
            let request = match project_optimizer_request(&project) {
                Ok(request) => request,
                Err(error) => {
                    skipped += 1;
                    eprintln!("skipping {label}: {error}");
                    continue;
                }
            };
            let result = match solve(&request, Some(0)) {
                Ok(result) => result,
                Err(error) => {
                    invalid.push(format!("{label}: solve failed: {error}"));
                    continue;
                }
            };
            if let Err(error) = validate_optimizer_packing(&request, &result) {
                invalid.push(format!(
                    "{label}: invalid packing: {error}; result={result:?}"
                ));
            }
            checked += 1;
        }
    }

    eprintln!(
        "BP Studio corpus optimizer validation: checked={checked} skipped={skipped} root={}",
        root.display()
    );
    assert!(
        checked > 0,
        "BP_STUDIO_CORPUS did not yield optimizer cases"
    );
    if !invalid.is_empty() {
        for entry in invalid.iter().take(20) {
            eprintln!("{entry}");
        }
        panic!("{} invalid BP Studio corpus packings", invalid.len());
    }
}

fn run_oracle(oracle: &std::path::Path, request: &OptimizerRequest, seed: u64) -> OptimizerResult {
    let mut child = Command::new("node")
        .arg(oracle)
        .arg("optimizer-solve")
        .arg("-")
        .arg("--seed")
        .arg(seed.to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn BP Studio optimizer oracle");
    {
        let mut stdin = child.stdin.take().expect("oracle stdin");
        serde_json::to_writer(&mut stdin, request).expect("write oracle request");
        stdin.write_all(b"\n").expect("flush oracle request");
    }
    let output = child.wait_with_output().expect("wait for oracle");
    assert!(
        output.status.success(),
        "oracle failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let value: Value = serde_json::from_slice(&output.stdout).expect("oracle json");
    serde_json::from_value(value["result"].clone()).expect("optimizer result")
}

fn optimizer_cases() -> Vec<OptimizerOracleCase> {
    let mut cases = Vec::new();
    for seed in 0..10 {
        for dist in [4.0, 7.0, 10.0, 13.0] {
            cases.push(OptimizerOracleCase {
                name: format!("rect-view-circle-{dist}"),
                seed,
                request: two_flap_request(GridType::Rectangular, LayoutMode::View, dist, 0.0),
            });
            cases.push(OptimizerOracleCase {
                name: format!("rect-view-dim-{dist}"),
                seed,
                request: two_flap_request(GridType::Rectangular, LayoutMode::View, dist, 2.0),
            });
            cases.push(OptimizerOracleCase {
                name: format!("diag-view-{dist}"),
                seed,
                request: two_flap_request(GridType::Diagonal, LayoutMode::View, dist, 0.0),
            });
            cases.push(OptimizerOracleCase {
                name: format!("rect-random-circle-{dist}"),
                seed,
                request: two_flap_request(GridType::Rectangular, LayoutMode::Random, dist, 0.0),
            });
            cases.push(OptimizerOracleCase {
                name: format!("rect-random-dim-{dist}"),
                seed,
                request: two_flap_request(GridType::Rectangular, LayoutMode::Random, dist, 2.0),
            });
        }
        cases.push(OptimizerOracleCase {
            name: "one-flap-random".to_string(),
            seed,
            request: one_flap_random_request(),
        });
    }
    cases.extend(random_tree_optimizer_cases());
    cases
}

fn random_tree_optimizer_cases() -> Vec<OptimizerOracleCase> {
    let mut cases = Vec::new();
    for seed in 0..50_u64 {
        for leaf_count in 3..=6 {
            cases.push(OptimizerOracleCase {
                name: format!("random-tree-{leaf_count}-{seed}"),
                seed,
                request: random_tree_request(seed, leaf_count),
            });
        }
    }
    cases
}

fn random_tree_request(seed: u64, leaf_count: usize) -> OptimizerRequest {
    let mut rng = DeterministicRng::new(seed ^ ((leaf_count as u64) << 32));
    let mut edges = Vec::new();
    for node in 1..leaf_count {
        let parent = rng.next_usize(node);
        let length = 2.0 + rng.next_usize(7) as f64;
        edges.push((parent, node, length));
    }
    let mut dist_map = Vec::new();
    for a in 0..leaf_count {
        for b in (a + 1)..leaf_count {
            dist_map.push(((a + 1) as u32, (b + 1) as u32, tree_distance(a, b, &edges)));
        }
    }
    OptimizerRequest {
        command: OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 8,
        problem: OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: (0..leaf_count)
                .map(|index| FlapRequest {
                    id: (index + 1) as u32,
                    width: 0.0,
                    height: 0.0,
                })
                .collect(),
            hierarchies: vec![Hierarchy {
                leaves: (1..=leaf_count as u32).collect(),
                dist_map,
                parents: Vec::new(),
            }],
        },
        vec: None,
    }
}

fn tree_distance(a: usize, b: usize, edges: &[(usize, usize, f64)]) -> f64 {
    let mut adjacency = vec![Vec::<(usize, f64)>::new(); edges.len() + 1];
    for &(from, to, length) in edges {
        adjacency[from].push((to, length));
        adjacency[to].push((from, length));
    }
    let mut stack = vec![(a, usize::MAX, 0.0)];
    while let Some((node, parent, distance)) = stack.pop() {
        if node == b {
            return distance;
        }
        for &(next, length) in &adjacency[node] {
            if next != parent {
                stack.push((next, node, distance + length));
            }
        }
    }
    unreachable!("generated tree is connected")
}

fn two_flap_request(
    grid_type: GridType,
    layout: LayoutMode,
    dist: f64,
    dimension: f64,
) -> OptimizerRequest {
    let vec = match (grid_type, layout) {
        (_, LayoutMode::Random) => None,
        (GridType::Rectangular, LayoutMode::View) => {
            Some(vec![Point { x: 0.0, y: 0.0 }, Point { x: 0.3, y: 0.4 }])
        }
        (GridType::Diagonal, LayoutMode::View) => {
            Some(vec![Point { x: 0.5, y: 0.5 }, Point { x: 0.7, y: 0.5 }])
        }
    };
    OptimizerRequest {
        command: OptimizerCommand::Start,
        use_bh: false,
        layout,
        random: 1,
        problem: OptimizerProblem {
            grid_type,
            flaps: vec![
                FlapRequest {
                    id: 1,
                    width: dimension,
                    height: dimension,
                },
                FlapRequest {
                    id: 2,
                    width: dimension,
                    height: dimension,
                },
            ],
            hierarchies: vec![Hierarchy {
                leaves: vec![1, 2],
                dist_map: vec![(1, 2, dist)],
                parents: Vec::new(),
            }],
        },
        vec,
    }
}

fn one_flap_random_request() -> OptimizerRequest {
    OptimizerRequest {
        command: OptimizerCommand::Start,
        use_bh: false,
        layout: LayoutMode::Random,
        random: 1,
        problem: OptimizerProblem {
            grid_type: GridType::Rectangular,
            flaps: vec![FlapRequest {
                id: 1,
                width: 0.0,
                height: 0.0,
            }],
            hierarchies: vec![Hierarchy {
                leaves: vec![1],
                dist_map: Vec::new(),
                parents: Vec::new(),
            }],
        },
        vec: None,
    }
}

fn repo_root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("repo root")
}

fn corpus_paths(root: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    collect_corpus_paths(root, &mut paths);
    paths.sort();
    paths
}

fn collect_corpus_paths(path: &Path, paths: &mut Vec<PathBuf>) {
    let Ok(metadata) = fs::metadata(path) else {
        return;
    };
    if metadata.is_file() {
        if is_corpus_file(path) {
            paths.push(path.to_path_buf());
        }
        return;
    }
    if !metadata.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        collect_corpus_paths(&entry.path(), paths);
    }
}

fn is_corpus_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some("bps" | "bpz" | "tmd" | "tmd4" | "tmd5")
    )
}

fn load_corpus_projects(path: &Path) -> oristudio_bp::BpResult<Vec<Project>> {
    match path.extension().and_then(|extension| extension.to_str()) {
        Some("bps") => {
            let text = fs::read_to_string(path)?;
            Ok(vec![bps::load_project_str(&text)?])
        }
        Some("bpz") => {
            let bytes = fs::read(path)?;
            bpz::read_workspace_projects(&bytes)
        }
        Some("tmd" | "tmd4" | "tmd5") => {
            let text = fs::read_to_string(path)?;
            Ok(vec![treemaker_import::tree_maker(
                path.file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or("TreeMaker"),
                &text,
            )?])
        }
        _ => Ok(Vec::new()),
    }
}

fn project_optimizer_request(project: &Project) -> oristudio_bp::BpResult<OptimizerRequest> {
    let (session, _) = BpSession::from_design(&project.design)?;
    let hierarchies = session.get_hierarchy(true, true)?;
    create_optimizer_request(
        project,
        hierarchies,
        OptimizerOptionsBase {
            layout: LayoutMode::Random,
            use_bh: false,
            random: 8,
        },
        true,
        0,
    )
}

#[derive(Debug, Clone)]
struct DeterministicRng {
    state: u64,
}

impl DeterministicRng {
    fn new(seed: u64) -> Self {
        Self {
            state: seed ^ 0x9e37_79b9_7f4a_7c15,
        }
    }

    fn next_u32(&mut self) -> u32 {
        self.state = self
            .state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1);
        (self.state >> 32) as u32
    }

    fn next_usize(&mut self, upper: usize) -> usize {
        if upper == 0 {
            0
        } else {
            self.next_u32() as usize % upper
        }
    }
}

struct OptimizerOracleCase {
    name: String,
    seed: u64,
    request: OptimizerRequest,
}
