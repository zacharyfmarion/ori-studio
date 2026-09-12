//! Reading crease patterns from files, for tests, examples and tools — not
//! for the product path (the app hands the planner flat segment arrays).
//!
//! Three formats: a FOLD frame (`vertices_coords` / `edges_vertices` /
//! `edges_assignment`), an ORIPA/Oriedita `.cp` text file (one `code x1 y1
//! x2 y2` line per crease, ORIPA codes 1 border, 2 mountain, 3 valley, 4
//! unassigned — note these are **not** Oriedita's colour codes), and an Ori
//! Studio `.osf` project whose crease-pattern document carries a FOLD at
//! `workspace.documents[N].creasePattern.foldProjection`. Everything comes
//! back as the `segments` / `colors` pair `analyze` takes.

use std::path::Path;

use serde_json::Value;

/// A crease pattern as flat segments plus Oriedita colour codes.
#[derive(Debug, Clone, PartialEq)]
pub struct LoadedCp {
    pub segments: Vec<f64>,
    pub colors: Vec<i32>,
}

/// Oriedita colour code for a FOLD assignment letter.
pub fn color_of_assignment(assignment: Option<&str>) -> i32 {
    match assignment {
        Some("B") => 0,
        Some("M") => 1,
        Some("V") => 2,
        Some("U") => -1,
        _ => 3,
    }
}

/// Oriedita colour code for an ORIPA `.cp` line code.
pub fn color_of_cp_code(code: i64) -> i32 {
    match code {
        1 => 0,
        2 => 1,
        3 => 2,
        4 => -1,
        _ => 3,
    }
}

/// Flat segments and colours from a FOLD frame.
pub fn fold_to_segments(fold: &Value) -> Result<LoadedCp, String> {
    let vertices = fold["vertices_coords"]
        .as_array()
        .ok_or("FOLD: missing vertices_coords")?;
    let edges = fold["edges_vertices"]
        .as_array()
        .ok_or("FOLD: missing edges_vertices")?;
    let assignments = fold["edges_assignment"].as_array();
    let mut segments = Vec::with_capacity(edges.len() * 4);
    let mut colors = Vec::with_capacity(edges.len());
    for (i, e) in edges.iter().enumerate() {
        let a = e[0].as_u64().ok_or("FOLD: bad vertex index")? as usize;
        let b = e[1].as_u64().ok_or("FOLD: bad vertex index")? as usize;
        for v in [a, b] {
            let coords = vertices.get(v).ok_or("FOLD: vertex out of range")?;
            segments.push(coords[0].as_f64().ok_or("FOLD: bad coordinate")?);
            segments.push(coords[1].as_f64().ok_or("FOLD: bad coordinate")?);
        }
        colors.push(color_of_assignment(
            assignments.and_then(|a| a.get(i)).and_then(Value::as_str),
        ));
    }
    Ok(LoadedCp { segments, colors })
}

/// Segments and colours from ORIPA `.cp` text; malformed lines are skipped.
pub fn parse_cp(text: &str) -> LoadedCp {
    let mut segments = Vec::new();
    let mut colors = Vec::new();
    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        let Ok(code) = fields[0].parse::<i64>() else {
            continue;
        };
        let coords: Option<Vec<f64>> = fields[1..5].iter().map(|f| f.parse().ok()).collect();
        let Some(coords) = coords else {
            continue;
        };
        if coords.iter().any(|c| !c.is_finite()) {
            continue;
        }
        segments.extend_from_slice(&coords);
        colors.push(color_of_cp_code(code));
    }
    LoadedCp { segments, colors }
}

/// The FOLD document of an `.osf` project.
///
/// Two shapes, split by `schemaVersion`: v1–v7 keep a flat
/// `workspace.documents` array, of which `document` selects one (else the
/// first crease pattern); v8 keeps one crease pattern under
/// `workspace.creasePattern`. A reader that knows one shape does not fail on
/// the other — it reports "no crease-pattern document" and the file drops
/// out of whatever scan it was in — so both are read.
pub fn osf_fold_projection(osf: &Value, document: Option<usize>) -> Option<&Value> {
    // A `fn` item, not a closure: a closure's inferred signature gives the
    // argument and the return their own lifetimes, so the borrow cannot
    // escape. Elision on a `fn` ties them together.
    fn pick(d: &Value) -> Option<&Value> {
        let projection = &d["creasePattern"]["foldProjection"];
        projection.is_object().then_some(projection)
    }
    if let Some(documents) = osf["workspace"]["documents"].as_array() {
        if let Some(index) = document
            && let Some(p) = documents.get(index).and_then(pick)
        {
            return Some(p);
        }
        if let Some(p) = documents.iter().find_map(pick) {
            return Some(p);
        }
    }
    pick(&osf["workspace"]["creasePattern"])
}

/// Load a `.fold`, `.cp` or `.osf` file. `document` selects the `.osf`
/// document (default: the first crease pattern).
pub fn load_path(path: &Path, document: Option<usize>) -> Result<LoadedCp, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("fold") => {
            let fold: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            fold_to_segments(&fold)
        }
        Some("cp") => Ok(parse_cp(&text)),
        Some("osf") => {
            let osf: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
            let fold = osf_fold_projection(&osf, document)
                .ok_or_else(|| format!("{}: no crease-pattern document", path.display()))?;
            fold_to_segments(fold)
        }
        other => Err(format!("unsupported extension {other:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cp_codes_are_oripa_not_oriedita() {
        let cp =
            parse_cp("1 0 0 400 0\n2 0 0 400 400\n3 0 400 400 0\n4 1 1 2 2\n9 0 0 1 1\nbad line\n");
        assert_eq!(cp.colors, vec![0, 1, 2, -1, 3]);
        assert_eq!(cp.segments.len(), 20);
    }

    #[test]
    fn fold_assignments_map_to_colours() {
        let fold: Value = serde_json::json!({
            "vertices_coords": [[0, 0], [1, 0], [1, 1]],
            "edges_vertices": [[0, 1], [1, 2], [2, 0]],
            "edges_assignment": ["B", "M", "V"]
        });
        let cp = fold_to_segments(&fold).expect("fold");
        assert_eq!(cp.colors, vec![0, 1, 2]);
        assert_eq!(cp.segments[4..8], [1.0, 0.0, 1.0, 1.0]);
        let bad: Value = serde_json::json!({ "edges_vertices": [] });
        assert!(fold_to_segments(&bad).is_err());
    }

    #[test]
    fn osf_picks_the_crease_pattern_document() {
        let osf: Value = serde_json::json!({
            "workspace": { "documents": [
                { "kind": "tree" },
                { "kind": "crease-pattern", "creasePattern": { "foldProjection": {
                    "vertices_coords": [[0, 0], [1, 1]], "edges_vertices": [[0, 1]],
                    "edges_assignment": ["M"] } } }
            ] }
        });
        assert!(osf_fold_projection(&osf, None).is_some());
        assert!(osf_fold_projection(&osf, Some(1)).is_some());
        assert!(osf_fold_projection(&osf, Some(0)).is_some()); // falls back
        let empty: Value = serde_json::json!({ "workspace": { "documents": [] } });
        assert!(osf_fold_projection(&empty, None).is_none());
    }
}
