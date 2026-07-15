use crate::math::gops::{JsonGadget, JsonOverlap, JsonPiece, JsonPoint, generate, rank};

const SLOPE: f64 = 3.0;
const SLOPE_RANK: i64 = 3;
const SLACK: f64 = 0.5;
const DIRECTION_UR: usize = 0;
const DIRECTION_LL: usize = 2;

pub fn kamiya_half_integral(overlap: &JsonOverlap, sx: f64) -> Vec<JsonGadget> {
    if overlap.ox % 2 == 0 || overlap.oy % 2 == 0 {
        return Vec::new();
    }

    let double_ox = overlap.ox << 1;
    let double_oy = overlap.oy << 1;
    let mut result = Vec::new();
    for piece in generate(double_ox, double_oy, sx * 2.0) {
        if rank(&piece) > SLOPE_RANK {
            continue;
        }
        let mut p1 = piece;
        let v_even = p1.v as i64 % 2 == 0;
        if p1.ox == p1.oy && v_even {
            continue;
        }

        p1.shrink(2.0);
        let (ox, oy, u, v) = (p1.ox, p1.oy, p1.u, p1.v);
        let diff = (ox - oy).abs() / 2.0;
        let sm = ox.min(oy);
        let p2: JsonPiece;

        if v_even && ox >= oy {
            p1.detours = Some(vec![vec![
                JsonPoint::new(diff, SLOPE * diff),
                JsonPoint::new(oy + u + v, ox + u + v),
            ]]);
            p2 = JsonPiece {
                ox: sm,
                oy: sm,
                u: v,
                v: u - diff,
                detours: Some(vec![vec![
                    JsonPoint::new(sm + u + v - diff, sm + u + v - diff),
                    JsonPoint::new(0.0, 0.0),
                ]]),
                shift: Some(JsonPoint::new(diff, SLOPE * diff)),
            };
        } else if !v_even && oy >= ox {
            p1.detours = Some(vec![vec![
                JsonPoint::new(oy + u + v, ox + u + v),
                JsonPoint::new(diff * SLOPE, diff),
            ]]);
            p2 = JsonPiece {
                ox: sm,
                oy: sm,
                u: v - diff,
                v: u,
                detours: Some(vec![vec![
                    JsonPoint::new(0.0, 0.0),
                    JsonPoint::new(sm + u + v - diff, sm + u + v - diff),
                ]]),
                shift: Some(JsonPoint::new(diff * SLOPE, diff)),
            };
        } else {
            continue;
        }

        let gadget = JsonGadget::new(vec![p1, p2]);
        let reversed = gadget.reverse_gps();
        result.push(gadget.add_slack(DIRECTION_LL, SLACK));
        result.push(reversed.add_slack(DIRECTION_UR, SLACK));
    }
    result
}
