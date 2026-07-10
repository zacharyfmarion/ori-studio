use crate::error::{BpError, BpResult};
use crate::model::CURRENT_VERSION;
use serde_json::{Map, Number, Value, json};

const VERSIONS: [&str; 7] = ["beta", "rc0", "rc1", "0", "0.4", "0.6", "0.7"];
const MAX_SHEET_SIZE: f64 = 8192.0;
const MAX_TREE_HEIGHT: f64 = 11586.0;
const CORNER_INTERSECTION: i64 = 3;
const CORNER_COINCIDE: i64 = 5;

pub fn process_str(text: &str) -> BpResult<Value> {
    process_value(serde_json::from_str(text)?)
}

pub fn process_value(mut project: Value) -> BpResult<Value> {
    let mut deprecated = false;
    let mut index = version_index(&project)?;
    while index < VERSIONS.len() {
        deprecated = apply_migration(&mut project, VERSIONS[index])? || deprecated;
        index += 1;
    }
    object_mut(&mut project, "project")?.insert(
        "version".to_string(),
        Value::String(CURRENT_VERSION.to_string()),
    );
    deprecated = hard_limit_check(&mut project)? || deprecated;
    if deprecated {
        object_mut(&mut project, "project")?.remove("history");
    }
    Ok(project)
}

pub fn sample_value() -> Value {
    json!({
        "version": CURRENT_VERSION,
        "design": {
            "title": "",
            "mode": "tree",
            "layout": {
                "sheet": { "type": "rect", "width": 16, "height": 16 },
                "flaps": [],
                "stretches": []
            },
            "tree": {
                "sheet": { "type": "rect", "width": 20, "height": 20 },
                "nodes": [],
                "edges": []
            }
        }
    })
}

pub fn version_index(project: &Value) -> BpResult<usize> {
    let Some(version) = project.get("version") else {
        return Ok(0);
    };
    let version = version
        .as_str()
        .ok_or_else(|| BpError::IncompatibleProject("version must be a string".to_string()))?;
    VERSIONS
        .iter()
        .position(|candidate| *candidate == version)
        .map(|index| index + 1)
        .ok_or_else(|| BpError::IncompatibleProject("Unrecognized version".to_string()))
}

fn apply_migration(project: &mut Value, version: &str) -> BpResult<bool> {
    match version {
        "beta" => beta_migration(project),
        "rc0" => rc0_migration(project),
        "rc1" => rc1_migration(project),
        "0" | "0.4" | "0.7" => Ok(false),
        "0.6" => project_migration(project),
        _ => Err(BpError::IncompatibleProject(format!(
            "unknown migration {version}"
        ))),
    }
}

fn beta_migration(project: &mut Value) -> BpResult<bool> {
    let obj = object_mut(project, "project")?;
    if obj.get("mode").and_then(Value::as_str) == Some("cp") {
        obj.insert("mode".to_string(), Value::String("layout".to_string()));
    }
    if let Some(mut layout) = obj.remove("cp") {
        if let Some(stretches) = layout.get_mut("stretches") {
            *stretches = Value::Array(Vec::new());
        }
        obj.insert("layout".to_string(), layout);
    }
    Ok(true)
}

fn rc0_migration(project: &mut Value) -> BpResult<bool> {
    let Some(stretches) = project
        .get_mut("layout")
        .and_then(|layout| layout.get_mut("stretches"))
        .and_then(Value::as_array_mut)
    else {
        return Ok(false);
    };
    if let Some(index) = stretches
        .iter()
        .position(stretch_has_invalid_rc0_configuration)
    {
        stretches.remove(index);
        return Ok(true);
    }
    Ok(false)
}

fn stretch_has_invalid_rc0_configuration(stretch: &Value) -> bool {
    let Some(configuration) = stretch.get("configuration") else {
        return false;
    };
    let Some(overlaps) = configuration.get("overlaps").and_then(Value::as_array) else {
        return true;
    };
    overlaps.iter().any(|overlap| {
        overlap
            .get("c")
            .and_then(Value::as_array)
            .is_some_and(|corners| {
                corners.iter().any(|corner| {
                    corner.get("type").and_then(Value::as_i64) == Some(CORNER_INTERSECTION)
                        && corner.get("e").is_none()
                })
            })
    })
}

fn rc1_migration(project: &mut Value) -> BpResult<bool> {
    let Some(stretches) = project
        .get_mut("layout")
        .and_then(|layout| layout.get_mut("stretches"))
        .and_then(Value::as_array_mut)
    else {
        return Ok(false);
    };
    for stretch in stretches {
        migrate_rc1_stretch(stretch)?;
    }
    Ok(false)
}

fn migrate_rc1_stretch(stretch: &mut Value) -> BpResult<()> {
    let Some(configuration) = stretch.get_mut("configuration") else {
        return Ok(());
    };
    let old_configuration = configuration.take();
    let overlaps = old_configuration
        .get("overlaps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let strategy = old_configuration.get("strategy").cloned();
    let partitions = partition_rc1(&overlaps, strategy.clone());
    let partition_count = partitions.len();
    *configuration = json!({ "partitions": partitions });

    let Some(pattern) = stretch.get_mut("pattern") else {
        return Ok(());
    };
    let old_pattern = pattern.take();
    let offsets = old_pattern.get("offsets").and_then(Value::as_array);
    let gadgets = old_pattern
        .get("gadgets")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let devices = if partition_count == 1 {
        vec![device_value(
            Value::Array(gadgets),
            offsets.and_then(|values| values.first()).cloned(),
        )]
    } else {
        gadgets
            .into_iter()
            .enumerate()
            .map(|(index, gadget)| {
                device_value(
                    Value::Array(vec![gadget]),
                    offsets.and_then(|values| values.get(index)).cloned(),
                )
            })
            .collect()
    };
    *pattern = json!({ "devices": devices });
    Ok(())
}

fn device_value(gadgets: Value, offset: Option<Value>) -> Value {
    let mut device = Map::new();
    device.insert("gadgets".to_string(), gadgets);
    if let Some(offset) = offset {
        device.insert("offset".to_string(), offset);
    }
    Value::Object(device)
}

fn partition_rc1(overlaps: &[Value], strategy: Option<Value>) -> Vec<Value> {
    let mut partitions: Vec<Vec<Value>> = Vec::new();
    let mut partition_map: Map<String, Value> = Map::new();

    for (index, overlap) in overlaps.iter().enumerate() {
        let key = index.to_string();
        if partition_map.contains_key(&key) {
            continue;
        }

        let coins = overlap
            .get("c")
            .and_then(Value::as_array)
            .map(|corners| {
                corners
                    .iter()
                    .filter(|corner| {
                        corner.get("type").and_then(Value::as_i64) == Some(CORNER_COINCIDE)
                    })
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if let Some(existing) = coins.iter().find_map(|corner| {
            let converted = convert_index(corner.get("e").and_then(Value::as_i64)?);
            partition_map
                .get(&converted.to_string())
                .and_then(Value::as_u64)
                .map(|value| value as usize)
        }) {
            partition_map.insert(key, Value::Number(Number::from(existing)));
            partitions[existing].push(overlap.clone());
        } else {
            let new_index = partitions.len();
            partition_map.insert(key, Value::Number(Number::from(new_index)));
            partitions.push(vec![overlap.clone()]);
        }

        let target_partition = partition_map
            .get(&index.to_string())
            .and_then(Value::as_u64)
            .map(|value| value as usize)
            .unwrap_or(partitions.len() - 1);

        for corner in coins {
            let Some(e) = corner.get("e").and_then(Value::as_i64) else {
                continue;
            };
            let converted = convert_index(e);
            let key = converted.to_string();
            if !partition_map.contains_key(&key) {
                partition_map.insert(key, Value::Number(Number::from(target_partition)));
                if let Some(overlap) = overlaps.get(converted) {
                    partitions[target_partition].push(overlap.clone());
                }
            }
        }
    }

    partitions
        .into_iter()
        .map(|overlaps| {
            let mut partition = Map::new();
            partition.insert("overlaps".to_string(), Value::Array(overlaps));
            if let Some(strategy) = &strategy {
                partition.insert("strategy".to_string(), strategy.clone());
            }
            Value::Object(partition)
        })
        .collect()
}

fn convert_index(code: i64) -> usize {
    (-code - 1) as usize
}

fn project_migration(project: &mut Value) -> BpResult<bool> {
    let obj = object_mut(project, "project")?;
    let mut design = Map::new();
    move_key(obj, &mut design, "title");
    move_key(obj, &mut design, "description");
    move_key(obj, &mut design, "mode");
    move_key(obj, &mut design, "layout");
    move_key(obj, &mut design, "tree");
    obj.insert("design".to_string(), Value::Object(design));

    move_state(project, "layout")?;
    move_state(project, "tree")?;
    Ok(false)
}

fn move_key(from: &mut Map<String, Value>, to: &mut Map<String, Value>, key: &str) {
    if let Some(value) = from.remove(key) {
        to.insert(key.to_string(), value);
    }
}

fn move_state(project: &mut Value, key: &str) -> BpResult<()> {
    let Some(sheet) = project
        .get_mut("design")
        .and_then(|design| design.get_mut(key))
        .and_then(|view| view.get_mut("sheet"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    if !sheet.contains_key("scroll") {
        return Ok(());
    }
    let scroll = sheet.remove("scroll").unwrap_or(Value::Null);
    let zoom = sheet.remove("zoom").unwrap_or(Value::Null);
    let state = ensure_object(project, "state")?;
    state.insert(key.to_string(), json!({ "scroll": scroll, "zoom": zoom }));
    Ok(())
}

fn hard_limit_check(project: &mut Value) -> BpResult<bool> {
    let mut deprecated = false;
    if let Some(edges) = project
        .get_mut("design")
        .and_then(|design| design.get_mut("tree"))
        .and_then(|tree| tree.get_mut("edges"))
        .and_then(Value::as_array_mut)
    {
        for edge in edges {
            if number(edge, "length").is_some_and(|length| length > MAX_TREE_HEIGHT) {
                set_number(edge, "length", 1.0)?;
                deprecated = true;
            }
        }
    }

    deprecated = check_tree_sheet(project)? || deprecated;
    deprecated = check_layout_sheet(project)? || deprecated;
    Ok(deprecated)
}

fn check_tree_sheet(project: &mut Value) -> BpResult<bool> {
    let Some(tree) = project
        .get_mut("design")
        .and_then(|design| design.get_mut("tree"))
    else {
        return Ok(false);
    };
    let sheet = {
        let Some(sheet) = tree.get_mut("sheet") else {
            return Ok(false);
        };
        if check_sheet(sheet)? {
            return Ok(false);
        }
        sheet.clone()
    };
    let Some(nodes) = tree.get_mut("nodes").and_then(Value::as_array_mut) else {
        return Ok(true);
    };
    for node in nodes {
        let p = point_from(node);
        let fixed = constrain_point(&sheet, p);
        set_number(node, "x", fixed.x)?;
        set_number(node, "y", fixed.y)?;
    }
    Ok(true)
}

fn check_layout_sheet(project: &mut Value) -> BpResult<bool> {
    let Some(layout) = project
        .get_mut("design")
        .and_then(|design| design.get_mut("layout"))
    else {
        return Ok(false);
    };
    let Some(sheet) = layout.get_mut("sheet") else {
        return Ok(false);
    };
    if check_sheet(sheet)? {
        return Ok(false);
    }
    let sheet = sheet.clone();
    let Some(flaps) = layout.get_mut("flaps").and_then(Value::as_array_mut) else {
        return Ok(true);
    };
    let sheet_width = number(&sheet, "width").unwrap_or(MAX_SHEET_SIZE);
    let sheet_height = number(&sheet, "height").unwrap_or(MAX_SHEET_SIZE);
    for flap in flaps {
        let width = number(flap, "width").unwrap_or(0.0).min(sheet_width);
        let height = number(flap, "height").unwrap_or(0.0).min(sheet_height);
        set_number(flap, "width", width)?;
        set_number(flap, "height", height)?;
        let location = point_from(flap);
        let delta = constrain_flap(&sheet, location, width, height, Point { x: 0.0, y: 0.0 });
        set_number(flap, "x", location.x + delta.x)?;
        set_number(flap, "y", location.y + delta.y)?;
    }
    Ok(true)
}

fn check_sheet(sheet: &mut Value) -> BpResult<bool> {
    let width = number(sheet, "width").unwrap_or(0.0);
    let height = number(sheet, "height").unwrap_or(0.0);
    if width > MAX_SHEET_SIZE || height > MAX_SHEET_SIZE {
        set_number(sheet, "width", width.min(MAX_SHEET_SIZE))?;
        set_number(sheet, "height", height.min(MAX_SHEET_SIZE))?;
        return Ok(false);
    }
    Ok(true)
}

#[derive(Debug, Clone, Copy)]
struct Point {
    x: f64,
    y: f64,
}

fn point_from(value: &Value) -> Point {
    Point {
        x: number(value, "x").unwrap_or(0.0),
        y: number(value, "y").unwrap_or(0.0),
    }
}

fn constrain_flap(sheet: &Value, location: Point, width: f64, height: f64, delta: Point) -> Point {
    let zero_width = width == 0.0;
    let zero_height = height == 0.0;
    if zero_width && zero_height {
        return fix_vector(sheet, location, delta);
    }
    if zero_width || zero_height {
        let delta = fix_vector(sheet, location, delta);
        let p = if zero_width {
            Point {
                x: location.x,
                y: location.y + height,
            }
        } else {
            Point {
                x: location.x + width,
                y: location.y,
            }
        };
        return fix_vector(sheet, p, delta);
    }
    let dots = [
        Point {
            x: location.x + width,
            y: location.y + height,
        },
        Point {
            x: location.x,
            y: location.y + height,
        },
        location,
        Point {
            x: location.x + width,
            y: location.y,
        },
    ];
    let mut data = dots
        .into_iter()
        .map(|p| {
            let fixed = fix_vector(sheet, p, delta);
            let dx = fixed.x - delta.x;
            let dy = fixed.y - delta.y;
            let dist = dx * dx + dy * dy;
            (p, dist, fixed)
        })
        .filter(|(_, dist, _)| *dist > 0.0)
        .collect::<Vec<_>>();
    data.sort_by(|a, b| b.1.total_cmp(&a.1));
    if data.len() <= 1 {
        return delta;
    }
    let mut result = data[1].2;
    if let Some((p, _, _)) = data.get(2) {
        result = fix_vector(sheet, *p, result);
    }
    if let Some((p, _, _)) = data.get(3) {
        result = fix_vector(sheet, *p, result);
    }
    result
}

fn fix_vector(sheet: &Value, point: Point, delta: Point) -> Point {
    let target = Point {
        x: point.x + delta.x,
        y: point.y + delta.y,
    };
    let fixed = constrain_point(sheet, target);
    Point {
        x: fixed.x - point.x,
        y: fixed.y - point.y,
    }
}

fn constrain_point(sheet: &Value, point: Point) -> Point {
    match sheet.get("type").and_then(Value::as_str) {
        Some("diag") => diagonal_constrain(number(sheet, "width").unwrap_or(0.0), point),
        _ => rectangular_constrain(
            number(sheet, "width").unwrap_or(0.0),
            number(sheet, "height").unwrap_or(0.0),
            point,
        ),
    }
}

fn rectangular_constrain(width: f64, height: f64, point: Point) -> Point {
    Point {
        x: point.x.clamp(0.0, width),
        y: point.y.clamp(0.0, height),
    }
}

fn diagonal_constrain(width: f64, point: Point) -> Point {
    let mut x = point.x;
    let mut y = point.y;
    let size = width;
    let h = size % 2.0;
    let f = (size - h) / 2.0;
    let c = (size + h) / 2.0;

    if x + y < f {
        let d = f - x - y;
        x += (d / 2.0).floor();
        y += (d / 2.0).ceil();
    }
    if y - x > c {
        let d = y - x - c;
        x += (d / 2.0).floor();
        y -= (d / 2.0).ceil();
    }
    if x - y > c {
        let d = x - y - c;
        x -= (d / 2.0).floor();
        y += (d / 2.0).ceil();
    }
    if x + y > c + size {
        let d = x + y - c - size;
        x -= (d / 2.0).floor();
        y -= (d / 2.0).ceil();
    }
    if x < 0.0 {
        x = 0.0;
    }
    if x > size {
        x = size;
    }
    Point { x, y }
}

fn number(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn set_number(value: &mut Value, key: &str, n: f64) -> BpResult<()> {
    object_mut(value, key)?.insert(key.to_string(), json_number(n)?);
    Ok(())
}

fn json_number(n: f64) -> BpResult<Value> {
    if n.is_finite() && n.fract() == 0.0 {
        return Ok(Value::Number(Number::from(n as i64)));
    }
    Number::from_f64(n)
        .map(Value::Number)
        .ok_or_else(|| BpError::InvalidInput(format!("invalid JSON number {n}")))
}

fn ensure_object<'a>(value: &'a mut Value, key: &str) -> BpResult<&'a mut Map<String, Value>> {
    let obj = object_mut(value, "project")?;
    let needs_insert = !matches!(obj.get(key), Some(Value::Object(_)));
    if needs_insert {
        obj.insert(key.to_string(), Value::Object(Map::new()));
    }
    obj.get_mut(key)
        .and_then(Value::as_object_mut)
        .ok_or_else(|| BpError::InvalidInput(format!("{key} must be an object")))
}

fn object_mut<'a>(value: &'a mut Value, label: &str) -> BpResult<&'a mut Map<String, Value>> {
    value
        .as_object_mut()
        .ok_or_else(|| BpError::InvalidInput(format!("{label} must be an object")))
}
