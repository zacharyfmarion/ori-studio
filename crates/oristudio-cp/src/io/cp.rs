use super::{IoError, Result};
use crate::geometry::{LineColor, LineSegment, Point};
use crate::model::CreasePatternModel;

/// Parse Oriedita `.cp` text into a crease-pattern model.
pub fn import_cp_str(input: &str) -> Result<CreasePatternModel> {
    let mut model = CreasePatternModel::default();

    for (line_index, raw_line) in input.lines().enumerate() {
        let line_number = line_index + 1;
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        let tokens = line.split_whitespace().collect::<Vec<_>>();
        if tokens.len() != 5 {
            return Err(IoError::InvalidLine {
                format: "cp",
                line: line_number,
                message: format!("expected 5 tokens, got {}", tokens.len()),
            });
        }

        let assignment = parse_i32(tokens[0], line_number)?;
        let ax = parse_f64(tokens[1], line_number)?;
        let ay = parse_f64(tokens[2], line_number)?;
        let bx = parse_f64(tokens[3], line_number)?;
        let by = parse_f64(tokens[4], line_number)?;

        model.add_line_segment(LineSegment::with_color(
            Point::new(ax, ay),
            Point::new(bx, by),
            cp_assignment_to_line_color(assignment)?,
        ));
    }

    Ok(model)
}

/// Export an Oriedita `.cp` text representation.
pub fn export_cp_string(model: &CreasePatternModel) -> String {
    let mut output = String::new();
    for segment in &model.line_segments {
        output.push_str(&format!(
            "{} {} {} {} {}\n",
            line_color_to_cp_assignment(segment.color),
            format_cp_number(segment.a.x),
            format_cp_number(segment.a.y),
            format_cp_number(segment.b.x),
            format_cp_number(segment.b.y)
        ));
    }
    output
}

/// ORIPA's line-type codes, as Oriedita reads them.
///
/// Oriedita does not spell this mapping out itself: `CpImporter` delegates to
/// the `io.github.oriedita:fold` library's `CreasePatternReader`, which turns
/// the leading token into a `FoldEdgeAssignment` (`1` border, `2` mountain, `3`
/// valley, anything else flat), and then hands it to `FoldImporter.getColor`,
/// which is where mountain becomes `RED_1` and valley becomes `BLUE_2`.
///
/// **2 is the mountain and 3 is the valley**, and getting that backwards is not
/// self-evident from a round trip: an inverted reader paired with an inverted
/// writer reproduces its own files exactly and disagrees only with the rest of
/// the ecosystem. `oriedita_io_oracle::cp_import_matches_oriedita_native_io_oracle`
/// pins it against the real importer for that reason.
pub fn cp_assignment_to_line_color(assignment: i32) -> Result<LineColor> {
    match assignment {
        1 => Ok(LineColor::Black0),
        2 => Ok(LineColor::Red1),
        3 => Ok(LineColor::Blue2),
        4 => Ok(LineColor::Cyan3),
        other => Err(IoError::InvalidField {
            field: "cp_assignment",
            message: format!("unknown assignment {other}"),
        }),
    }
}

/// Inverse of [`cp_assignment_to_line_color`]; every colour Oriedita cannot
/// spell in a `.cp` collapses to the auxiliary code, as `CpExporter` does.
pub fn line_color_to_cp_assignment(line_color: LineColor) -> i32 {
    match line_color {
        LineColor::Black0 => 1,
        LineColor::Red1 => 2,
        LineColor::Blue2 => 3,
        _ => 4,
    }
}

fn parse_i32(token: &str, line: usize) -> Result<i32> {
    token.parse::<i32>().map_err(|error| IoError::InvalidLine {
        format: "cp",
        line,
        message: error.to_string(),
    })
}

fn parse_f64(token: &str, line: usize) -> Result<f64> {
    token.parse::<f64>().map_err(|error| IoError::InvalidLine {
        format: "cp",
        line,
        message: error.to_string(),
    })
}

fn format_cp_number(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}
