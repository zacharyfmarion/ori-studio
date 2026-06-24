use super::{IoError, Result};
use crate::CreasePatternDocument;
use crate::geometry::{ActiveState, Circle, LineColor, LineSegment, Point, RgbColor};
use crate::model::CreasePatternModel;
use encoding_rs::{EUC_JP, Encoding, GBK, SHIFT_JIS, UTF_8};
use serde_json::{Value, json};

const ORH_CHARSETS: &[&Encoding] = &[UTF_8, EUC_JP, GBK, SHIFT_JIS];
const ORH_FOLDED_FRONT_COLOR: &str = "oriedita:orh:oriagarizu_front_color";
const ORH_FOLDED_BACK_COLOR: &str = "oriedita:orh:oriagarizu_back_color";
const ORH_FOLDED_LINE_COLOR: &str = "oriedita:orh:oriagarizu_line_color";

/// Import an Oriedita/Orihime `.orh` file from bytes, trying Oriedita's
/// charset order.
pub fn import_orh_bytes(bytes: &[u8]) -> Result<CreasePatternDocument> {
    for encoding in ORH_CHARSETS {
        let (decoded, had_errors) = encoding.decode_without_bom_handling(bytes);
        if !had_errors {
            return import_orh_str(&decoded);
        }
    }

    Err(IoError::InvalidField {
        field: "orh",
        message: "encoding was not detected".to_string(),
    })
}

/// Import an already-decoded Oriedita/Orihime `.orh` file.
pub fn import_orh_str(input: &str) -> Result<CreasePatternDocument> {
    let lines = input.lines().collect::<Vec<_>>();
    let mut document = CreasePatternDocument {
        title: Some("_".to_string()),
        crease_pattern: CreasePatternModel::default(),
        metadata: Default::default(),
        ..CreasePatternDocument::default()
    };

    let num_lines = count_orh_lines(&lines)?;
    document.crease_pattern.line_segments = vec![LineSegment::default(); num_lines + 1];
    document.crease_pattern.circles = vec![Circle::default(); num_lines + 1];

    let mut reading_flag = 0;
    let mut number = 0usize;
    let mut color = RgbColor::new(0, 0, 0);
    let mut circle_template = Circle::default();
    let mut folded_colors = OrhFoldedFigureColors::default();

    for (line_index, line) in lines.iter().enumerate() {
        let tokens = csv_tokens(line);
        let Some(token) = tokens.first() else {
            continue;
        };

        match *token {
            "<タイトル>" => reading_flag = 2,
            "<線分集合>" => reading_flag = 1,
            "<円集合>" => reading_flag = 3,
            _ => {}
        }

        if reading_flag == 2
            && *token == "タイトル"
            && let Some(title) = tokens.get(1)
        {
            document.title = Some((*title).to_string());
        }

        if reading_flag == 1 && *token == "番号" {
            number = parse_one_based_index(tokens.get(1), line_index + 1)?;
        }

        if reading_flag == 1 {
            let mut segment = document
                .crease_pattern
                .line_segments
                .get(number)
                .cloned()
                .ok_or_else(|| IoError::InvalidLine {
                    format: "orh",
                    line: line_index + 1,
                    message: format!("line number {number} is out of range"),
                })?;

            match *token {
                "色" => {
                    segment.color = parse_line_color(tokens.get(1), line_index + 1)?;
                }
                "iactive" => {
                    segment.active = parse_active_state(tokens.get(1), line_index + 1)?;
                }
                "選択" => {
                    segment.selected = parse_i32(tokens.get(1), line_index + 1)?;
                }
                "座標" => {
                    let coords = parse_four_f64(&tokens, line_index + 1)?;
                    segment = segment.with_coordinates(
                        Point::new(coords[0], coords[1]),
                        Point::new(coords[2], coords[3]),
                    );
                }
                _ => {
                    if let Some((tag, value)) = tag_value(line) {
                        match tag {
                            "tpp" => {
                                // Oriedita's ORH line importer parses this but never assigns it.
                            }
                            "tpp_color_R" => {
                                color.red = parse_u8(value, line_index + 1)?;
                                segment = segment.with_customized_color(color);
                            }
                            "tpp_color_G" => {
                                color.green = parse_u8(value, line_index + 1)?;
                                segment = segment.with_customized_color(color);
                            }
                            "tpp_color_B" => {
                                color.blue = parse_u8(value, line_index + 1)?;
                                segment = segment.with_customized_color(color);
                            }
                            _ => {}
                        }
                    }
                }
            }

            document.crease_pattern.line_segments[number] = segment;
        }

        if reading_flag == 3 && *token == "番号" {
            number = parse_one_based_index(tokens.get(1), line_index + 1)?;
            if let Some(circle) = document.crease_pattern.circles.get_mut(number) {
                *circle = circle_template;
            }
        }

        if reading_flag == 3 && *token == "中心と半径と色" {
            let circle = document
                .crease_pattern
                .circles
                .get_mut(number)
                .ok_or_else(|| IoError::InvalidLine {
                    format: "orh",
                    line: line_index + 1,
                    message: format!("circle number {number} is out of range"),
                })?;
            circle.x = parse_f64(tokens.get(1), line_index + 1)?;
            circle.y = parse_f64(tokens.get(2), line_index + 1)?;
            circle.r = parse_f64(tokens.get(3), line_index + 1)?;
            circle.color = parse_line_color(tokens.get(4), line_index + 1)?;
        }

        if reading_flag == 3
            && let Some((tag, value)) = tag_value(line)
        {
            let circle = document
                .crease_pattern
                .circles
                .get_mut(number)
                .ok_or_else(|| IoError::InvalidLine {
                    format: "orh",
                    line: line_index + 1,
                    message: format!("circle number {number} is out of range"),
                })?;
            match tag {
                "tpp" => {
                    circle.customized = parse_i32_value(value, line_index + 1)?;
                }
                "tpp_color_R" => {
                    color.red = parse_u8(value, line_index + 1)?;
                    circle.customized_color = color;
                }
                "tpp_color_G" => {
                    color.green = parse_u8(value, line_index + 1)?;
                    circle.customized_color = color;
                }
                "tpp_color_B" => {
                    color.blue = parse_u8(value, line_index + 1)?;
                    circle.customized_color = color;
                }
                _ => {}
            }
            circle_template = *circle;
        }

        if let Some((tag, value)) = tag_value(line) {
            folded_colors.apply_tag(tag, value, line_index + 1)?;
        }
    }

    folded_colors.write_metadata(&mut document);

    Ok(document)
}

/// Export an Oriedita/Orihime `.orh` file.
pub fn export_orh_string(document: &CreasePatternDocument) -> String {
    let mut output = String::new();
    let title = document.title.as_deref().unwrap_or("_");

    push_line(&mut output, "<タイトル>");
    push_line(&mut output, &format!("タイトル,{title}"));

    push_line(&mut output, "<線分集合>");
    for (index, segment) in document.crease_pattern.line_segments.iter().enumerate() {
        push_line(&mut output, &format!("番号,{}", index + 1));
        push_line(&mut output, &format!("色,{}", segment.color));
        push_custom_color(&mut output, segment.customized, segment.customized_color);
        push_line(
            &mut output,
            &format!(
                "座標,{},{},{},{}",
                java_double_string(segment.a.x),
                java_double_string(segment.a.y),
                java_double_string(segment.b.x),
                java_double_string(segment.b.y)
            ),
        );
    }

    push_line(&mut output, "<円集合>");
    for (index, circle) in document.crease_pattern.circles.iter().enumerate() {
        push_line(&mut output, &format!("番号,{}", index + 1));
        push_line(
            &mut output,
            &format!(
                "中心と半径と色,{},{},{},{}",
                java_double_string(circle.x),
                java_double_string(circle.y),
                java_double_string(circle.r),
                circle.color
            ),
        );
        push_custom_color(&mut output, circle.customized, circle.customized_color);
    }

    push_line(&mut output, "<補助線分集合>");
    for (index, segment) in document.crease_pattern.aux_line_segments.iter().enumerate() {
        push_line(&mut output, &format!("補助番号,{}", index + 1));
        push_line(&mut output, &format!("補助色,{}", segment.color));
        push_custom_color(&mut output, segment.customized, segment.customized_color);
        push_line(
            &mut output,
            &format!(
                "補助座標,{},{},{},{}",
                java_double_string(segment.a.x),
                java_double_string(segment.a.y),
                java_double_string(segment.b.x),
                java_double_string(segment.b.y)
            ),
        );
    }

    push_default_camera(&mut output);
    push_default_settings(&mut output);
    push_grid(&mut output, document.crease_pattern.grid);
    push_default_grid_colors(&mut output);
    push_folded_figure(&mut output, document);

    output
}

#[derive(Debug, Clone, Copy)]
struct OrhFoldedFigureColors {
    section_seen: bool,
    front: RgbColor,
    back: RgbColor,
    line: RgbColor,
}

impl Default for OrhFoldedFigureColors {
    fn default() -> Self {
        Self {
            section_seen: false,
            front: RgbColor::new(0, 0, 0),
            back: RgbColor::new(0, 0, 0),
            line: RgbColor::new(0, 0, 0),
        }
    }
}

impl OrhFoldedFigureColors {
    fn apply_tag(&mut self, tag: &str, value: &str, line: usize) -> Result<()> {
        match tag {
            "oriagarizu_F_color_R" => {
                self.section_seen = true;
                self.front.red = parse_u8(value, line)?;
            }
            "oriagarizu_F_color_G" => {
                self.section_seen = true;
                self.front.green = parse_u8(value, line)?;
            }
            "oriagarizu_F_color_B" => {
                self.section_seen = true;
                self.front.blue = parse_u8(value, line)?;
            }
            "oriagarizu_B_color_R" => {
                self.section_seen = true;
                self.back.red = parse_u8(value, line)?;
            }
            "oriagarizu_B_color_G" => {
                self.section_seen = true;
                self.back.green = parse_u8(value, line)?;
            }
            "oriagarizu_B_color_B" => {
                self.section_seen = true;
                self.back.blue = parse_u8(value, line)?;
            }
            "oriagarizu_L_color_R" => {
                self.section_seen = true;
                self.line.red = parse_u8(value, line)?;
            }
            "oriagarizu_L_color_G" => {
                self.section_seen = true;
                self.line.green = parse_u8(value, line)?;
            }
            "oriagarizu_L_color_B" => {
                self.section_seen = true;
                self.line.blue = parse_u8(value, line)?;
            }
            _ => {}
        }
        Ok(())
    }

    fn write_metadata(self, document: &mut CreasePatternDocument) {
        if !self.section_seen {
            return;
        }
        document.metadata.insert(
            ORH_FOLDED_FRONT_COLOR.to_string(),
            color_metadata(self.front),
        );
        document
            .metadata
            .insert(ORH_FOLDED_BACK_COLOR.to_string(), color_metadata(self.back));
        document
            .metadata
            .insert(ORH_FOLDED_LINE_COLOR.to_string(), color_metadata(self.line));
    }
}

fn count_orh_lines(lines: &[&str]) -> Result<usize> {
    let mut reading_flag = 0;
    let mut count = 0;

    for line in lines {
        let tokens = csv_tokens(line);
        let Some(token) = tokens.first() else {
            continue;
        };
        if *token == "<線分集合>" {
            reading_flag = 1;
        }
        if *token == "<円集合>" {
            reading_flag = 3;
        }
        if reading_flag == 1 && *token == "番号" {
            count += 1;
        }
    }

    Ok(count)
}

fn parse_one_based_index(value: Option<&&str>, line: usize) -> Result<usize> {
    let index = parse_i32(value, line)?;
    index
        .checked_sub(1)
        .and_then(|zero_based| usize::try_from(zero_based).ok())
        .ok_or_else(|| IoError::InvalidLine {
            format: "orh",
            line,
            message: format!("one-based index {index} is invalid"),
        })
}

fn parse_four_f64(tokens: &[&str], line: usize) -> Result<[f64; 4]> {
    Ok([
        parse_f64(tokens.get(1), line)?,
        parse_f64(tokens.get(2), line)?,
        parse_f64(tokens.get(3), line)?,
        parse_f64(tokens.get(4), line)?,
    ])
}

fn parse_line_color(value: Option<&&str>, line: usize) -> Result<LineColor> {
    let value = required_token(value, line)?;
    value
        .parse::<LineColor>()
        .map_err(|error| IoError::InvalidLine {
            format: "orh",
            line,
            message: error.to_string(),
        })
}

fn parse_active_state(value: Option<&&str>, line: usize) -> Result<ActiveState> {
    match required_token(value, line)? {
        "INACTIVE_0" => Ok(ActiveState::Inactive0),
        "ACTIVE_A_1" => Ok(ActiveState::ActiveA1),
        "ACTIVE_B_2" => Ok(ActiveState::ActiveB2),
        "ACTIVE_BOTH_3" => Ok(ActiveState::ActiveBoth3),
        value => Err(IoError::InvalidLine {
            format: "orh",
            line,
            message: format!("unknown active state {value:?}"),
        }),
    }
}

fn required_token<'a>(value: Option<&&'a str>, line: usize) -> Result<&'a str> {
    value.copied().ok_or_else(|| IoError::InvalidLine {
        format: "orh",
        line,
        message: "missing token".to_string(),
    })
}

fn parse_f64(value: Option<&&str>, line: usize) -> Result<f64> {
    required_token(value, line)?
        .parse::<f64>()
        .map_err(|error| IoError::InvalidLine {
            format: "orh",
            line,
            message: error.to_string(),
        })
}

fn parse_i32(value: Option<&&str>, line: usize) -> Result<i32> {
    parse_i32_value(required_token(value, line)?, line)
}

fn parse_i32_value(value: &str, line: usize) -> Result<i32> {
    value.parse::<i32>().map_err(|error| IoError::InvalidLine {
        format: "orh",
        line,
        message: error.to_string(),
    })
}

fn parse_u8(value: &str, line: usize) -> Result<u8> {
    value.parse::<u8>().map_err(|error| IoError::InvalidLine {
        format: "orh",
        line,
        message: error.to_string(),
    })
}

fn csv_tokens(line: &str) -> Vec<&str> {
    line.split(',').collect()
}

fn tag_value(line: &str) -> Option<(&str, &str)> {
    let rest = line.strip_prefix('<')?;
    let (tag, after_open) = rest.split_once('>')?;
    let (value, close) = after_open.rsplit_once("</")?;
    if close.ends_with('>') {
        Some((tag, value))
    } else {
        None
    }
}

fn push_custom_color(output: &mut String, customized: i32, color: RgbColor) {
    push_line(output, &format!("<tpp>{customized}</tpp>"));
    push_line(output, &format!("<tpp_color_R>{}</tpp_color_R>", color.red));
    push_line(
        output,
        &format!("<tpp_color_G>{}</tpp_color_G>", color.green),
    );
    push_line(
        output,
        &format!("<tpp_color_B>{}</tpp_color_B>", color.blue),
    );
}

fn push_default_camera(output: &mut String) {
    push_line(output, "<camera_of_orisen_nyuuryokuzu>");
    push_line(output, "<camera_ichi_x>0.0</camera_ichi_x>");
    push_line(output, "<camera_ichi_y>0.0</camera_ichi_y>");
    push_line(output, "<camera_kakudo>0.0</camera_kakudo>");
    push_line(output, "<camera_kagami>1.0</camera_kagami>");
    push_line(output, "<camera_bairitsu_x>1.0</camera_bairitsu_x>");
    push_line(output, "<camera_bairitsu_y>1.0</camera_bairitsu_y>");
    push_line(output, "<hyouji_ichi_x>0.0</hyouji_ichi_x>");
    push_line(output, "<hyouji_ichi_y>0.0</hyouji_ichi_y>");
    push_line(output, "</camera_of_orisen_nyuuryokuzu>");
}

fn push_default_settings(output: &mut String) {
    push_line(output, "<settei>");
    push_line(output, "<ckbox_mouse_settei>true</ckbox_mouse_settei>");
    push_line(output, "<ckbox_ten_sagasi>false</ckbox_ten_sagasi>");
    push_line(output, "<ckbox_ten_hanasi>false</ckbox_ten_hanasi>");
    push_line(
        output,
        "<ckbox_kou_mitudo_nyuuryoku>false</ckbox_kou_mitudo_nyuuryoku>",
    );
    push_line(output, "<ckbox_bun>true</ckbox_bun>");
    push_line(output, "<ckbox_cp>true</ckbox_cp>");
    push_line(output, "<ckbox_a0>true</ckbox_a0>");
    push_line(output, "<ckbox_a1>true</ckbox_a1>");
    push_line(output, "<ckbox_mejirusi>true</ckbox_mejirusi>");
    push_line(output, "<ckbox_cp_ue>false</ckbox_cp_ue>");
    push_line(
        output,
        "<ckbox_oritatami_keika>false</ckbox_oritatami_keika>",
    );
    push_line(output, "<iTenkaizuSenhaba>1</iTenkaizuSenhaba>");
    push_line(output, "<ir_ten>1</ir_ten>");
    push_line(output, "<i_orisen_hyougen>1</i_orisen_hyougen>");
    push_line(output, "<i_anti_alias>false</i_anti_alias>");
    push_line(output, "</settei>");
}

fn push_grid(output: &mut String, grid: crate::model::GridMetadata) {
    push_line(output, "<Kousi>");
    push_line(
        output,
        &format!("<i_kitei_jyoutai>{}</i_kitei_jyoutai>", grid.base_state),
    );
    push_line(
        output,
        &format!("<nyuuryoku_kitei>{}</nyuuryoku_kitei>", grid.grid_size),
    );
    push_line(
        output,
        &format!(
            "<memori_kankaku>{}</memori_kankaku>",
            grid.interval_grid_size
        ),
    );
    push_line(
        output,
        &format!(
            "<a_to_heikouna_memori_iti>{}</a_to_heikouna_memori_iti>",
            grid.horizontal_scale_position
        ),
    );
    push_line(
        output,
        &format!(
            "<b_to_heikouna_memori_iti>{}</b_to_heikouna_memori_iti>",
            grid.vertical_scale_position
        ),
    );
    push_line(output, "<kousi_senhaba>1</kousi_senhaba>");
    push_line(
        output,
        &format!(
            "<d_kousi_x_a>{}</d_kousi_x_a>",
            java_double_string(grid.grid_xa)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_x_b>{}</d_kousi_x_b>",
            java_double_string(grid.grid_xb)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_x_c>{}</d_kousi_x_c>",
            java_double_string(grid.grid_xc)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_y_a>{}</d_kousi_y_a>",
            java_double_string(grid.grid_ya)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_y_b>{}</d_kousi_y_b>",
            java_double_string(grid.grid_yb)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_y_c>{}</d_kousi_y_c>",
            java_double_string(grid.grid_yc)
        ),
    );
    push_line(
        output,
        &format!(
            "<d_kousi_kakudo>{}</d_kousi_kakudo>",
            java_double_string(grid.grid_angle)
        ),
    );
    push_line(output, "</Kousi>");
}

fn push_default_grid_colors(output: &mut String) {
    push_line(output, "<Kousi_iro>");
    push_line(output, "<kousi_color_R>230</kousi_color_R>");
    push_line(output, "<kousi_color_G>230</kousi_color_G>");
    push_line(output, "<kousi_color_B>230</kousi_color_B>");
    push_line(output, "<kousi_memori_color_R>180</kousi_memori_color_R>");
    push_line(output, "<kousi_memori_color_G>200</kousi_memori_color_G>");
    push_line(output, "<kousi_memori_color_B>180</kousi_memori_color_B>");
    push_line(output, "</Kousi_iro>");
}

fn push_folded_figure(output: &mut String, document: &CreasePatternDocument) {
    let front = metadata_color(
        document.metadata.get(ORH_FOLDED_FRONT_COLOR),
        RgbColor::new(255, 255, 50),
    );
    let back = metadata_color(
        document.metadata.get(ORH_FOLDED_BACK_COLOR),
        RgbColor::new(233, 233, 233),
    );
    let line = metadata_color(
        document.metadata.get(ORH_FOLDED_LINE_COLOR),
        RgbColor::new(0, 0, 0),
    );

    push_line(output, "<oriagarizu>");
    push_line(
        output,
        &format!("<oriagarizu_F_color_R>{}</oriagarizu_F_color_R>", front.red),
    );
    push_line(
        output,
        &format!(
            "<oriagarizu_F_color_G>{}</oriagarizu_F_color_G>",
            front.green
        ),
    );
    push_line(
        output,
        &format!(
            "<oriagarizu_F_color_B>{}</oriagarizu_F_color_B>",
            front.blue
        ),
    );
    push_line(
        output,
        &format!("<oriagarizu_B_color_R>{}</oriagarizu_B_color_R>", back.red),
    );
    push_line(
        output,
        &format!(
            "<oriagarizu_B_color_G>{}</oriagarizu_B_color_G>",
            back.green
        ),
    );
    push_line(
        output,
        &format!("<oriagarizu_B_color_B>{}</oriagarizu_B_color_B>", back.blue),
    );
    push_line(
        output,
        &format!("<oriagarizu_L_color_R>{}</oriagarizu_L_color_R>", line.red),
    );
    push_line(
        output,
        &format!(
            "<oriagarizu_L_color_G>{}</oriagarizu_L_color_G>",
            line.green
        ),
    );
    push_line(
        output,
        &format!("<oriagarizu_L_color_B>{}</oriagarizu_L_color_B>", line.blue),
    );
    push_line(output, "</oriagarizu>");
}

fn color_metadata(color: RgbColor) -> Value {
    json!([color.red, color.green, color.blue])
}

fn metadata_color(value: Option<&Value>, default: RgbColor) -> RgbColor {
    let Some(values) = value.and_then(Value::as_array) else {
        return default;
    };
    let [red, green, blue] = values.as_slice() else {
        return default;
    };
    let Some(red) = red.as_u64().and_then(|value| u8::try_from(value).ok()) else {
        return default;
    };
    let Some(green) = green.as_u64().and_then(|value| u8::try_from(value).ok()) else {
        return default;
    };
    let Some(blue) = blue.as_u64().and_then(|value| u8::try_from(value).ok()) else {
        return default;
    };
    RgbColor::new(red, green, blue)
}

fn push_line(output: &mut String, line: &str) {
    output.push_str(line);
    output.push('\n');
}

fn java_double_string(value: f64) -> String {
    if value.is_finite() && value.fract() == 0.0 {
        format!("{value:.1}")
    } else {
        value.to_string()
    }
}
