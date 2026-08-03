//! Bit-level writer/reader for the packed sections (M/V bitmap, nibble escapes,
//! angle references).
//!
//! LSB-first within a byte, matching the format spec. Reads past the end return
//! an error rather than zero bits, so a truncated bitmap cannot silently decode
//! as a run of mountains.

use super::error::{Result, ShareError};

#[derive(Default)]
pub struct BitWriter {
    bytes: Vec<u8>,
    partial: u8,
    used: u32,
}

impl BitWriter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn write_bit(&mut self, bit: bool) {
        if bit {
            self.partial |= 1 << self.used;
        }
        self.used += 1;
        if self.used == 8 {
            self.bytes.push(self.partial);
            self.partial = 0;
            self.used = 0;
        }
    }

    /// Write the low `width` bits of `value`, LSB first. `width == 0` writes
    /// nothing, which is the correct behaviour for a single-symbol alphabet.
    pub fn write_bits(&mut self, value: u32, width: u32) {
        for i in 0..width {
            self.write_bit((value >> i) & 1 == 1);
        }
    }

    /// Flush the partial byte and return the buffer. Padding bits are zero.
    pub fn finish(mut self) -> Vec<u8> {
        if self.used > 0 {
            self.bytes.push(self.partial);
        }
        self.bytes
    }
}

pub struct BitReader<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> BitReader<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, pos: 0 }
    }

    pub fn read_bit(&mut self, what: &'static str) -> Result<bool> {
        let byte = self
            .bytes
            .get(self.pos / 8)
            .ok_or(ShareError::UnexpectedEnd { what })?;
        let bit = (byte >> (self.pos % 8)) & 1 == 1;
        self.pos += 1;
        Ok(bit)
    }

    pub fn read_bits(&mut self, width: u32, what: &'static str) -> Result<u32> {
        let mut value = 0u32;
        for i in 0..width {
            if self.read_bit(what)? {
                value |= 1 << i;
            }
        }
        Ok(value)
    }
}

/// Bits needed to distinguish `n` symbols. Zero for 0 or 1 symbols — a
/// single-valued alphabet needs no selector at all.
pub fn bit_width(n: usize) -> u32 {
    if n <= 1 {
        0
    } else {
        (usize::BITS - (n - 1).leading_zeros()).min(32)
    }
}

/// Bytes a bit run occupies once flushed.
pub fn packed_len(bits: usize) -> usize {
    bits.div_ceil(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bits_roundtrip_lsb_first() {
        let mut w = BitWriter::new();
        let pattern = [true, false, true, true, false, false, false, true, true];
        for b in pattern {
            w.write_bit(b);
        }
        let bytes = w.finish();
        assert_eq!(bytes.len(), 2);
        let mut r = BitReader::new(&bytes);
        for b in pattern {
            assert_eq!(r.read_bit("t").unwrap(), b);
        }
    }

    #[test]
    fn multi_bit_values_roundtrip() {
        let mut w = BitWriter::new();
        for v in 0..16u32 {
            w.write_bits(v, 4);
        }
        let bytes = w.finish();
        let mut r = BitReader::new(&bytes);
        for v in 0..16u32 {
            assert_eq!(r.read_bits(4, "t").unwrap(), v);
        }
    }

    #[test]
    fn reading_past_the_end_errors() {
        let bytes = [0xffu8];
        let mut r = BitReader::new(&bytes);
        for _ in 0..8 {
            assert!(r.read_bit("t").is_ok());
        }
        assert!(matches!(
            r.read_bit("t"),
            Err(ShareError::UnexpectedEnd { .. })
        ));
    }

    #[test]
    fn bit_width_is_zero_for_degenerate_alphabets() {
        assert_eq!(bit_width(0), 0);
        assert_eq!(bit_width(1), 0);
        assert_eq!(bit_width(2), 1);
        assert_eq!(bit_width(3), 2);
        assert_eq!(bit_width(4), 2);
        assert_eq!(bit_width(5), 3);
        assert_eq!(bit_width(256), 8);
        assert_eq!(bit_width(257), 9);
    }
}
