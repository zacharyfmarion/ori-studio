//! LEB128 varints and a bounds-checked cursor.
//!
//! Every read is checked against the remaining bytes, so a truncated or forged
//! payload produces a typed error rather than a panic or a wild allocation.

use super::error::{Result, ShareError};

pub fn write_uvarint(out: &mut Vec<u8>, mut value: u64) {
    loop {
        let byte = (value & 0x7f) as u8;
        value >>= 7;
        if value == 0 {
            out.push(byte);
            return;
        }
        out.push(byte | 0x80);
    }
}

/// Zigzag so small negatives stay small: `-1 -> 1`, `1 -> 2`.
pub fn write_svarint(out: &mut Vec<u8>, value: i64) {
    write_uvarint(out, ((value << 1) ^ (value >> 63)) as u64);
}

pub fn uvarint_len(mut value: u64) -> usize {
    let mut n = 1;
    while value >= 0x80 {
        value >>= 7;
        n += 1;
    }
    n
}

/// A read cursor that cannot run past its slice.
pub struct Cursor<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    pub fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.pos)
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    pub fn position(&self) -> usize {
        self.pos
    }

    pub fn u8(&mut self, what: &'static str) -> Result<u8> {
        let byte = *self
            .bytes
            .get(self.pos)
            .ok_or(ShareError::UnexpectedEnd { what })?;
        self.pos += 1;
        Ok(byte)
    }

    pub fn take(&mut self, n: usize, what: &'static str) -> Result<&'a [u8]> {
        if self.remaining() < n {
            return Err(ShareError::UnexpectedEnd { what });
        }
        let slice = &self.bytes[self.pos..self.pos + n];
        self.pos += n;
        Ok(slice)
    }

    pub fn uvarint(&mut self, what: &'static str) -> Result<u64> {
        let mut value: u64 = 0;
        let mut shift = 0u32;
        loop {
            let byte = self.u8(what)?;
            // 10 groups of 7 bits is 70 > 64, so the final group must not carry
            // bits that would overflow. Reject rather than silently truncate.
            if shift >= 64 || (shift == 63 && (byte & 0x7f) > 1) {
                return Err(ShareError::BadVarint);
            }
            value |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(value);
            }
            shift += 7;
        }
    }

    pub fn svarint(&mut self, what: &'static str) -> Result<i64> {
        let raw = self.uvarint(what)?;
        Ok(((raw >> 1) as i64) ^ -((raw & 1) as i64))
    }

    /// Read a count that will drive an allocation. `min_bits_each` is the
    /// smallest number of bits one element can possibly occupy, so a count that
    /// could not fit in the remaining bytes is rejected before allocating.
    pub fn count(&mut self, what: &'static str, min_bits_each: usize) -> Result<usize> {
        let n = self.uvarint(what)?;
        let capacity = (self.remaining().saturating_mul(8)) / min_bits_each.max(1);
        if n > capacity as u64 {
            return Err(ShareError::ImplausibleCounts {
                counts: n,
                remaining: self.remaining(),
            });
        }
        Ok(n as usize)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uvarint_roundtrips_across_widths() {
        for value in [0u64, 1, 127, 128, 300, u32::MAX as u64, u64::MAX] {
            let mut out = Vec::new();
            write_uvarint(&mut out, value);
            assert_eq!(out.len(), uvarint_len(value));
            let mut cursor = Cursor::new(&out);
            assert_eq!(cursor.uvarint("t").unwrap(), value);
            assert!(cursor.is_empty());
        }
    }

    #[test]
    fn svarint_keeps_small_negatives_small() {
        let mut out = Vec::new();
        write_svarint(&mut out, -1);
        assert_eq!(out.len(), 1);
        for value in [0i64, -1, 1, -1000, 1000, i64::MIN, i64::MAX] {
            let mut out = Vec::new();
            write_svarint(&mut out, value);
            assert_eq!(Cursor::new(&out).svarint("t").unwrap(), value);
        }
    }

    #[test]
    fn unterminated_varint_is_an_error_not_a_hang() {
        let bytes = vec![0x80u8; 12];
        assert!(matches!(
            Cursor::new(&bytes).uvarint("t"),
            Err(ShareError::BadVarint | ShareError::UnexpectedEnd { .. })
        ));
    }

    #[test]
    fn implausible_count_is_rejected_before_allocation() {
        // A huge count in a tiny payload: the guard must fire.
        let mut out = Vec::new();
        write_uvarint(&mut out, 1 << 40);
        out.push(0);
        let mut cursor = Cursor::new(&out);
        assert!(matches!(
            cursor.count("t", 1),
            Err(ShareError::ImplausibleCounts { .. })
        ));
    }

    #[test]
    fn reads_cannot_run_past_the_end() {
        let bytes = [1u8, 2];
        let mut cursor = Cursor::new(&bytes);
        assert!(cursor.take(2, "t").is_ok());
        assert!(matches!(
            cursor.take(1, "t"),
            Err(ShareError::UnexpectedEnd { .. })
        ));
    }
}
