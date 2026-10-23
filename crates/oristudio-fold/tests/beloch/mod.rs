//! Beloch's FOLD fixtures (`tests/fixtures/beloch/` at the repository root,
//! the oracle tests' copy; MIT, Christopher Mühl; reference only, plan
//! "Settled with the owner"), read for comparison: a frame's faces with
//! their paper-to-table matrices, its own crease pattern and its
//! `faceOrders`; a file's final frame through Import CP (plan D16) with the
//! frame's own `faceOrders` as the stored order; and a numbering-free match
//! of a frame against a state. The `beloch_replay` test checks every fixture
//! this way, `crane` and `reverse` match their steps against frames, and the
//! examples and `crates/oracle-tests`' `fold_compound_oracle` share it
//! (through `#[path]`).
//!
//! The crease pattern a final state is imported from is the final frame's
//! own, not the file's root. A frame's vertices sit on the table, and each
//! face's `beloch:faces_matrix` maps the paper onto it, so its inverse takes
//! the frame's vertices, edges and faces back to the paper. The root is not
//! the final state's pattern: Beloch 0.3.0-dev wrote a precreased crease
//! there with its letter, `V`, where the frame has it flat, `F`; and a root
//! can carry a crease no frame has (a construction line marking a point),
//! which splits faces the frame keeps whole, so the centroid of a frame face
//! can fall on it. [`pattern`] still reads the root, for a test that wants
//! the file's crease lines.

#![allow(dead_code)]

use std::path::PathBuf;

use oristudio_fold::{
    Broken, CompletionLimits, CreasePatternInput, ImportKind, ImportRefusal, ImportSegment,
    ImportSpace, ImportTarget, ImportedPattern, Isometry, Letter, StartSide, State, WitnessOrder,
};
use oristudio_geometry::convex;
use serde_json::Value;

type Point = [f64; 2];

/// A Beloch matrix `[a, b, c, d, tx, ty]`: `x' = a x + b y + tx`,
/// `y' = c x + d y + ty`, paper to table.
pub type Matrix = [f64; 6];

/// The fixtures' directory.
pub fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/beloch")
}

/// A fixture file, parsed.
pub fn document(name: &str) -> Value {
    let path = dir().join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name}: {e}"))
}

/// A fixture file: its name and its JSON.
pub struct Fixture {
    pub name: String,
    pub document: Value,
}

/// Every `.fold` fixture, by name.
pub fn fixtures() -> Vec<Fixture> {
    let dir = dir();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|x| x == "fold"))
        .collect();
    files.sort();
    files
        .into_iter()
        .map(|path| {
            let name = path
                .file_stem()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_default();
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let document =
                serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            Fixture { name, document }
        })
        .collect()
}

/// A face of a frame, on the paper.
pub struct FrameFace {
    /// Its ring on the paper, as the frame winds it.
    pub paper: Vec<Point>,
    /// Paper to table.
    pub matrix: Matrix,
}

impl FrameFace {
    /// Its matrix as an isometry.
    pub fn isometry(&self) -> Isometry {
        let [a, b, c, d, tx, ty] = self.matrix;
        Isometry([a, b, tx, c, d, ty])
    }
}

/// A frame, taken back to the paper.
pub struct Frame {
    /// The frame's own crease pattern on the paper: its edges with its
    /// letters.
    pub input: CreasePatternInput,
    pub faces: Vec<FrameFace>,
    /// FOLD `faceOrders` over `faces`.
    pub orders: Vec<(u32, u32, i8)>,
}

impl Frame {
    /// The frame's faces' paper centroids: their witnesses.
    pub fn witnesses(&self) -> Vec<Point> {
        self.faces
            .iter()
            .filter_map(|f| convex::centroid(&convex::normalize(&f.paper)))
            .collect()
    }

    /// Its order with each face named by its paper centroid.
    pub fn stored_order(&self) -> WitnessOrder {
        WitnessOrder {
            faces: self.witnesses(),
            orders: self.orders.clone(),
        }
    }
}

/// Why a fixture's final frame does not replay.
#[derive(Debug)]
pub enum Refusal {
    /// Import CP refused the frame's crease pattern.
    Import(ImportRefusal),
    /// The frame's order, stored by witnesses, does not replay onto it.
    Broken(Broken),
}

impl Refusal {
    pub fn code(&self) -> String {
        match self {
            Refusal::Import(r) => r.code().to_string(),
            Refusal::Broken(b) => serde_json::to_value(b)
                .ok()
                .and_then(|v| v.get("broken").and_then(Value::as_str).map(str::to_owned))
                .unwrap_or_else(|| "broken".to_string()),
        }
    }
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Refusal::Import(r) => write!(f, "{r}"),
            Refusal::Broken(b) => write!(f, "{b}"),
        }
    }
}

/// A frame replayed: the imported pattern, the state, and each frame face's
/// witness in sheet coordinates.
pub struct Replayed {
    pub imported: ImportedPattern,
    pub state: State,
    pub witnesses: Vec<Point>,
}

fn point(value: &Value) -> Option<Point> {
    Some([value.get(0)?.as_f64()?, value.get(1)?.as_f64()?])
}

fn points(value: &Value) -> Option<Vec<Point>> {
    value.as_array()?.iter().map(point).collect()
}

fn indices(value: &Value) -> Option<Vec<usize>> {
    value
        .as_array()?
        .iter()
        .map(|v| v.as_u64().map(|v| v as usize))
        .collect()
}

/// A table point taken back to the paper by a paper-to-table matrix.
pub fn to_paper(m: &Matrix, p: Point) -> Point {
    let det = m[0] * m[3] - m[1] * m[2];
    let (x, y) = (p[0] - m[4], p[1] - m[5]);
    [(m[3] * x - m[1] * y) / det, (m[0] * y - m[2] * x) / det]
}

/// A paper point on the table.
pub fn to_table(m: &Matrix, p: Point) -> Point {
    [
        m[0] * p[0] + m[1] * p[1] + m[4],
        m[2] * p[0] + m[3] * p[1] + m[5],
    ]
}

/// What a FOLD assignment is to Import CP. A flat crease remembers no letter
/// in FOLD; any will do. A join edge (`J`) is no crease: it only divides
/// faces, so it is a guide.
fn kind(assignment: &str) -> Result<ImportKind, String> {
    Ok(match assignment {
        "B" => ImportKind::Border,
        "M" => ImportKind::Mountain,
        "V" => ImportKind::Valley,
        "F" => ImportKind::Unassigned {
            hint: Some(Letter::Valley),
        },
        "U" => ImportKind::Unassigned { hint: None },
        "J" => ImportKind::Aux,
        other => return Err(format!("an edge assigned {other:?}")),
    })
}

/// A file's root crease pattern (its top level) as Import CP takes it. Not
/// the final state's pattern (see the module docs): what a test reads for
/// the file's crease lines.
pub fn pattern(document: &Value) -> Result<CreasePatternInput, String> {
    let coords = points(&document["vertices_coords"]).ok_or("no vertices")?;
    let edges = document["edges_vertices"]
        .as_array()
        .ok_or("no edges")?
        .iter()
        .map(indices)
        .collect::<Option<Vec<_>>>()
        .ok_or("an edge is not two vertices")?;
    let assignments = document["edges_assignment"]
        .as_array()
        .ok_or("no assignments")?;
    if assignments.len() != edges.len() {
        return Err("an edge has no assignment".into());
    }
    let mut segments = Vec::with_capacity(edges.len());
    for (edge, assignment) in edges.iter().zip(assignments) {
        let &[a, b] = edge.as_slice() else {
            return Err("an edge is not two vertices".into());
        };
        segments.push(ImportSegment {
            from: *coords.get(a).ok_or("a missing vertex")?,
            to: *coords.get(b).ok_or("a missing vertex")?,
            kind: kind(assignment.as_str().ok_or("an assignment is not a string")?)?,
        });
    }
    Ok(CreasePatternInput {
        space: ImportSpace::Sheet,
        segments,
    })
}

/// Frame `k` of a file, the last for `None`, on the paper (see the module
/// docs).
pub fn frame(document: &Value, k: Option<usize>) -> Result<Frame, String> {
    let frames = document["file_frames"].as_array().ok_or("no frames")?;
    let frame = match k {
        Some(k) => frames.get(k),
        None => frames.last(),
    }
    .ok_or("no such frame")?;
    let table = points(&frame["vertices_coords"]).ok_or("no frame vertices")?;
    let rings = frame["faces_vertices"]
        .as_array()
        .ok_or("no frame faces")?
        .iter()
        .map(indices)
        .collect::<Option<Vec<_>>>()
        .ok_or("a face is not a vertex list")?;
    let matrices = frame["beloch:faces_matrix"]
        .as_array()
        .ok_or("no face matrices")?
        .iter()
        .map(|m| {
            let m: Vec<f64> = m
                .as_array()?
                .iter()
                .map(Value::as_f64)
                .collect::<Option<_>>()?;
            <[f64; 6]>::try_from(m).ok()
        })
        .collect::<Option<Vec<Matrix>>>()
        .ok_or("a matrix is not six numbers")?;
    if matrices.len() != rings.len() {
        return Err("a face has no matrix".into());
    }

    // Each vertex on the paper, through the first face that has it.
    let mut paper: Vec<Option<Point>> = vec![None; table.len()];
    let mut faces = Vec::with_capacity(rings.len());
    for (ring, matrix) in rings.iter().zip(&matrices) {
        let mut polygon = Vec::with_capacity(ring.len());
        for &v in ring {
            let p = to_paper(
                matrix,
                *table.get(v).ok_or("a face names a missing vertex")?,
            );
            paper[v].get_or_insert(p);
            polygon.push(p);
        }
        faces.push(FrameFace {
            paper: polygon,
            matrix: *matrix,
        });
    }

    let edges = frame["edges_vertices"]
        .as_array()
        .ok_or("no frame edges")?
        .iter()
        .map(indices)
        .collect::<Option<Vec<_>>>()
        .ok_or("an edge is not two vertices")?;
    let assignments = frame["edges_assignment"]
        .as_array()
        .ok_or("no frame assignments")?;
    if assignments.len() != edges.len() {
        return Err("an edge has no assignment".into());
    }
    let mut segments = Vec::with_capacity(edges.len());
    for (edge, assignment) in edges.iter().zip(assignments) {
        let &[a, b] = edge.as_slice() else {
            return Err("an edge is not two vertices".into());
        };
        let end = |v: usize| -> Result<Point, String> {
            paper
                .get(v)
                .copied()
                .flatten()
                .ok_or_else(|| format!("vertex {v} is on no face"))
        };
        segments.push(ImportSegment {
            from: end(a)?,
            to: end(b)?,
            kind: kind(assignment.as_str().ok_or("an assignment is not a string")?)?,
        });
    }

    let orders = frame["faceOrders"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|t| {
            let [f, g, s] = [0, 1, 2].map(|k| t.get(k).and_then(Value::as_i64));
            Some((
                u32::try_from(f?).ok()?,
                u32::try_from(g?).ok()?,
                i8::try_from(s?).ok()?,
            ))
        })
        .collect::<Option<Vec<_>>>()
        .ok_or("a face order is not three integers")?;

    Ok(Frame {
        input: CreasePatternInput {
            space: ImportSpace::Sheet,
            segments,
        },
        faces,
        orders,
    })
}

/// The file's final frame on the paper.
pub fn final_frame(document: &Value) -> Result<Frame, String> {
    frame(document, None)
}

/// The frame through Import CP, its order stored by its faces' paper
/// centroids and replayed (plan D6, D16).
pub fn replay(frame: &Frame) -> Result<Replayed, Refusal> {
    let imported = ImportedPattern::new(
        &frame.input,
        ImportTarget::Empty {
            start: StartSide::Front,
        },
    )
    .map_err(Refusal::Import)?;
    let witnesses: Vec<Point> = frame
        .faces
        .iter()
        .map(|face| {
            let centroid =
                convex::centroid(&convex::normalize(&face.paper)).unwrap_or([f64::NAN, f64::NAN]);
            imported.to_sheet(centroid)
        })
        .collect();
    let stored = WitnessOrder {
        faces: witnesses.clone(),
        orders: frame.orders.clone(),
    };
    let state = imported
        .replay(&stored, &CompletionLimits::default())
        .map_err(Refusal::Broken)?;
    Ok(Replayed {
        imported,
        state,
        witnesses,
    })
}

/// A fixture's final frame as a state, or why it has none.
pub fn final_state(document: &Value) -> Result<State, String> {
    let frame = final_frame(document)?;
    replay(&frame)
        .map(|r| r.state)
        .map_err(|refusal| refusal.to_string())
}

/// Whether `state` is the frame's flat folded state, numbering-free: every
/// frame face's paper centroid lies in its own face of the state; the
/// state's face isometries are the frame's matrices after one isometry
/// (`table = Φ ∘ model`, the same for every face); and the frame's
/// `faceOrders`, read through the witnesses, are exactly the state's order.
/// Returns Φ.
pub fn matches(state: &State, frame: &Frame) -> Result<Isometry, String> {
    if state.faces().len() != frame.faces.len() {
        return Err(format!(
            "{} faces, the frame has {}",
            state.faces().len(),
            frame.faces.len()
        ));
    }
    let witnesses = frame.witnesses();
    let mut faces = Vec::with_capacity(witnesses.len());
    for (i, &w) in witnesses.iter().enumerate() {
        let face = state
            .face_at(w)
            .ok_or_else(|| format!("frame face {i}'s centroid {w:?} is in no face"))?;
        if faces.contains(&face) {
            return Err(format!("frame face {i} shares face {face}"));
        }
        faces.push(face);
    }
    let mut phi: Option<Isometry> = None;
    for (i, (face, frame_face)) in faces.iter().zip(&frame.faces).enumerate() {
        let t = state
            .isometry(*face)
            .ok_or_else(|| format!("no isometry for {face}"))?;
        let this = frame_face.isometry().after(&t.inverse());
        match phi {
            None => phi = Some(this),
            Some(p) if p.0.iter().zip(&this.0).all(|(a, b)| (a - b).abs() < 1e-9) => {}
            Some(p) => {
                return Err(format!(
                    "frame face {i} ({face}) sits elsewhere: {:?} against {:?}",
                    this.0, p.0
                ));
            }
        }
    }
    let pairs = frame
        .stored_order()
        .resolve(|p| state.face_at(p), |f| state.front_up(f))
        .map_err(|e| e.to_string())?;
    for [upper, lower] in &pairs {
        if state.above(*upper, *lower) != Some(true) {
            return Err(format!(
                "the frame puts {upper} above {lower}; the state has {:?}",
                state.above(*upper, *lower)
            ));
        }
    }
    if pairs.len() != state.order().len() {
        return Err(format!(
            "the frame orders {} pairs, the state {}",
            pairs.len(),
            state.order().len()
        ));
    }
    phi.ok_or_else(|| "no faces".to_string())
}
