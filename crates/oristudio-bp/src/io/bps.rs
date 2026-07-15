use crate::error::BpResult;
use crate::io::migrations;
use crate::model::Project;
use serde::Serialize;
use serde_json::{Number, Value};

pub fn load_project_str(text: &str) -> BpResult<Project> {
    let value: Value = serde_json::from_str(text)?;
    load_project_value(value)
}

pub fn load_project_value(value: Value) -> BpResult<Project> {
    let value = migrations::process_value(value)?;
    Ok(serde_json::from_value(value)?)
}

pub fn project_to_value(project: &Project) -> BpResult<Value> {
    let mut value = serde_json::to_value(project)?;
    normalize_numbers(&mut value);
    Ok(value)
}

pub fn save_project_string(project: &Project) -> BpResult<String> {
    let value = project_to_value(project)?;
    Ok(serde_json::to_string(&value)?)
}

pub fn to_json_string<T: Serialize>(value: &T) -> BpResult<String> {
    let mut value = serde_json::to_value(value)?;
    normalize_numbers(&mut value);
    Ok(serde_json::to_string(&value)?)
}

fn normalize_numbers(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_numbers(value);
            }
        }
        Value::Object(map) => {
            for value in map.values_mut() {
                normalize_numbers(value);
            }
        }
        Value::Number(number) => {
            if let Some(n) = number.as_f64()
                && n.is_finite()
                && n.fract() == 0.0
            {
                let min = i64::MIN as f64;
                let max = i64::MAX as f64;
                if n >= min && n <= max {
                    *number = Number::from(n as i64);
                }
            }
        }
        Value::Null | Value::Bool(_) | Value::String(_) => {}
    }
}
