use oristudio_cp::geometry::{
    Intersection, LineSegment, determine_line_segment_intersection,
    determine_line_segment_intersection_sweet, determine_line_segment_intersection_with_precision,
};
use std::path::{Path, PathBuf};
use std::process::Command;

struct OracleCase {
    name: &'static str,
    s1: LineSegment,
    s2: LineSegment,
    sweet: bool,
    precision: Option<f64>,
}

fn oracle_cases() -> Vec<OracleCase> {
    vec![
        OracleCase {
            name: "cross",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(5.0, -5.0, 5.0, 5.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "l_shape",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(0.0, 0.0, 0.0, 10.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "t_shape",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(10.0, 0.0, 10.0, 10.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "point_on_segment",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(5.0, 0.0, 5.0, 0.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "parallel_equal",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(10.0, 0.0, 0.0, 0.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "parallel_contains",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(3.0, 0.0, 7.0, 0.0),
            sweet: false,
            precision: None,
        },
        OracleCase {
            name: "sweet_endpoint_overshoot",
            s1: LineSegment::from_coordinates(0.0, 0.0, 1.0, 0.0),
            s2: LineSegment::from_coordinates(1.0 + 0.0000000000005, -1.0, 1.0, 1.0),
            sweet: true,
            precision: None,
        },
        OracleCase {
            name: "strict_near_parallel",
            s1: LineSegment::from_coordinates(0.0, 0.0, 10.0, 0.0),
            s2: LineSegment::from_coordinates(0.0, 0.000000001, 10.0, 0.000000001),
            sweet: false,
            precision: Some(0.0),
        },
    ]
}

#[test]
fn line_segment_intersections_match_oriedita_geometry_oracle() {
    let Ok(oracle) = std::env::var("ORIEDITA_GEOMETRY_ORACLE") else {
        eprintln!("skipping Oriedita geometry oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };
    let oracle = resolve_oracle_path(&oracle);

    for case in oracle_cases() {
        let rust = rust_intersection(&case);
        let oracle_state = run_oracle(&oracle, &case);

        assert_eq!(
            rust.state(),
            oracle_state,
            "oracle mismatch for {}: Rust {:?} versus Oriedita state {}",
            case.name,
            rust,
            oracle_state
        );
    }
}

#[test]
fn jvm_performance_diagnostics_do_not_pollute_oracle_stdout() {
    let Ok(oracle) = std::env::var("ORIEDITA_GEOMETRY_ORACLE") else {
        eprintln!("skipping Oriedita geometry oracle test: ORIEDITA_GEOMETRY_ORACLE is not set");
        return;
    };
    // Exercise HotSpot's same stdout logging channel as the intermittent
    // hsperfdata lock warning, without relying on an actual process-ID race.
    let output = Command::new(resolve_oracle_path(&oracle))
        .env("JAVA_TOOL_OPTIONS", "-Xlog:perf+memops=debug")
        .args([
            "intersection",
            "strict",
            "default",
            "0",
            "0",
            "10",
            "0",
            "5",
            "-5",
            "5",
            "5",
        ])
        .output()
        .expect("run Oriedita geometry oracle with performance diagnostics");
    assert!(
        output.status.success(),
        "oracle failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let expected = rust_intersection(&oracle_cases()[0]).state().to_string();
    assert_eq!(
        String::from_utf8(output.stdout)
            .expect("oracle stdout is UTF-8")
            .trim(),
        expected,
        "stdout must contain only the oracle result, even with JVM diagnostics enabled"
    );
}

fn rust_intersection(case: &OracleCase) -> Intersection {
    if case.sweet {
        determine_line_segment_intersection_sweet(&case.s1, &case.s2)
    } else if let Some(precision) = case.precision {
        determine_line_segment_intersection_with_precision(&case.s1, &case.s2, precision)
    } else {
        determine_line_segment_intersection(&case.s1, &case.s2)
    }
}

fn resolve_oracle_path(oracle: &str) -> PathBuf {
    let path = PathBuf::from(oracle);
    if path.is_absolute() || path.exists() {
        return path;
    }

    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path)
}

fn run_oracle(oracle: &Path, case: &OracleCase) -> i32 {
    let output = Command::new(oracle)
        .arg("intersection")
        .arg(if case.sweet { "sweet" } else { "strict" })
        .arg(
            case.precision
                .map_or_else(|| "default".to_owned(), |precision| precision.to_string()),
        )
        .arg(case.s1.a.x.to_string())
        .arg(case.s1.a.y.to_string())
        .arg(case.s1.b.x.to_string())
        .arg(case.s1.b.y.to_string())
        .arg(case.s2.a.x.to_string())
        .arg(case.s2.a.y.to_string())
        .arg(case.s2.b.x.to_string())
        .arg(case.s2.b.y.to_string())
        .output()
        .unwrap_or_else(|err| panic!("failed to run Oriedita geometry oracle {oracle:?}: {err}"));

    assert!(
        output.status.success(),
        "Oriedita oracle failed for {} with status {:?}: {}",
        case.name,
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8(output.stdout)
        .expect("oracle stdout should be valid UTF-8")
        .trim()
        .parse::<i32>()
        .expect("oracle stdout should be an intersection state integer")
}
