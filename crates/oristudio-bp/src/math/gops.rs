use crate::data::get_ordered_int_double_key;
use crate::math::reduce_int;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

static MEMO: LazyLock<Mutex<HashMap<usize, Vec<GopsMemo>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct JsonPoint {
    pub x: f64,
    pub y: f64,
}

impl JsonPoint {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonPiece {
    pub ox: f64,
    pub oy: f64,
    pub u: f64,
    pub v: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detours: Option<Vec<Vec<JsonPoint>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shift: Option<JsonPoint>,
}

impl JsonPiece {
    pub fn new(ox: f64, oy: f64, u: f64, v: f64) -> Self {
        Self {
            ox,
            oy,
            u,
            v,
            detours: None,
            shift: None,
        }
    }

    pub fn sx(&self) -> f64 {
        self.oy + self.u + self.v
    }

    pub fn sy(&self) -> f64 {
        self.ox + self.u + self.v
    }

    pub fn shrink(&mut self, by: f64) {
        self.ox /= by;
        self.oy /= by;
        self.u /= by;
        self.v /= by;
    }

    pub fn reverse(&mut self, tx: f64, ty: f64) {
        let sx = self.sx();
        let sy = self.sy();
        let shift = self.shift.unwrap_or(JsonPoint::new(0.0, 0.0));
        self.shift = Some(JsonPoint::new(tx - sx - shift.x, ty - sy - shift.y));
        self.detours = self.detours.take().map(|detours| {
            detours
                .into_iter()
                .map(|detour| {
                    detour
                        .into_iter()
                        .map(|point| JsonPoint::new(sx - point.x, sy - point.y))
                        .collect()
                })
                .collect()
        });
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonAnchor {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slack: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<JsonPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonGadget {
    pub pieces: Vec<JsonPiece>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<JsonPoint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchors: Option<Vec<Option<JsonAnchor>>>,
}

impl JsonGadget {
    pub fn new(pieces: Vec<JsonPiece>) -> Self {
        Self {
            pieces,
            offset: None,
            anchors: None,
        }
    }

    pub fn reverse_gps(&self) -> Self {
        let mut gadget = self.clone();
        let sx = gadget
            .pieces
            .iter()
            .take(2)
            .map(JsonPiece::sx)
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil();
        let sy = gadget
            .pieces
            .iter()
            .take(2)
            .map(JsonPiece::sy)
            .fold(f64::NEG_INFINITY, f64::max)
            .ceil();
        for piece in gadget.pieces.iter_mut().take(2) {
            piece.reverse(sx, sy);
        }
        gadget
    }

    pub fn add_slack(mut self, quadrant: usize, slack: f64) -> Self {
        if slack != 0.0 {
            let anchors = self.anchors.get_or_insert_with(Vec::new);
            if anchors.len() <= quadrant {
                anchors.resize_with(quadrant + 1, || None);
            }
            let anchor = anchors[quadrant].get_or_insert(JsonAnchor {
                slack: None,
                location: None,
            });
            anchor.slack = Some(anchor.slack.unwrap_or(0.0) + slack);
        }
        self
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JsonOverlap {
    pub ox: i64,
    pub oy: i64,
}

#[derive(Debug, Clone)]
struct GopsMemo {
    piece: JsonPiece,
    sx: f64,
}

pub fn generate(ox: i64, oy: i64, sx: f64) -> Vec<JsonPiece> {
    if ox % 2 != 0 && oy % 2 != 0 {
        return Vec::new();
    }

    let memo = get_or_create_memo(ox, oy);
    memo.into_iter()
        .filter(|entry| entry.sx <= sx)
        .map(|entry| entry.piece)
        .collect()
}

pub fn rank(piece: &JsonPiece) -> i64 {
    let r1 = reduce_int((piece.oy + piece.v) as i64, piece.oy as i64).0;
    let r2 = reduce_int((piece.ox + piece.u) as i64, piece.ox as i64).0;
    r1.max(r2)
}

fn get_or_create_memo(ox: i64, oy: i64) -> Vec<GopsMemo> {
    let key = get_ordered_int_double_key(ox as usize, oy as usize);
    if let Some(memo) = MEMO.lock().expect("gops memo lock").get(&key) {
        return memo.clone();
    }

    let half_area = ox * oy / 2;
    let mut array = Vec::new();
    let mut u = (half_area as f64).sqrt().floor() as i64;
    while u > 0 {
        if half_area % u == 0 {
            let v = half_area / u;
            if u == v {
                add_memo(
                    JsonPiece::new(ox as f64, oy as f64, u as f64, v as f64),
                    &mut array,
                );
            } else {
                let p1 = JsonPiece::new(ox as f64, oy as f64, u as f64, v as f64);
                let p2 = JsonPiece::new(ox as f64, oy as f64, v as f64, u as f64);
                if rank(&p1) > rank(&p2) {
                    add_memo(p2, &mut array);
                    add_memo(p1, &mut array);
                } else {
                    add_memo(p1, &mut array);
                    add_memo(p2, &mut array);
                }
            }
        }
        u -= 1;
    }
    MEMO.lock()
        .expect("gops memo lock")
        .insert(key, array.clone());
    array
}

fn add_memo(piece: JsonPiece, array: &mut Vec<GopsMemo>) {
    let sx = piece.u + piece.v + piece.oy;
    array.push(GopsMemo { piece, sx });
}
