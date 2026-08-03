//! The fixed 16-byte frame that wraps every share payload, and the compression
//! layer beneath it.
//!
//! The frame is identical for every `format_version`, so a decoder can identify
//! and reject a payload it does not understand without parsing any of it. All
//! bounds validation lives here: by the time a body reaches a version decoder it
//! has a known length, a verified checksum, and a bounded size.

use super::error::{Result, ShareError};

/// `"OCS1"` — Ori Studio Crease-pattern Share. Fixed forever; `format_version`
/// selects the body grammar, never the magic.
pub const MAGIC: [u8; 4] = *b"OCS1";
pub const FRAME_LEN: usize = 16;

/// Largest body we will ever decompress. Comfortably above the corpus maximum
/// (a 9,396-crease pattern bodies out around 12 KB) while keeping a forged
/// header from driving a large allocation.
pub const MAX_BODY_LEN: usize = 8 * 1024 * 1024;

/// Decompression-bomb guard. Deflate compresses long zero runs by ~1000x, so a
/// short link must not be allowed to claim a huge expansion.
pub const MAX_EXPANSION_RATIO: usize = 4096;

const FLAG_BODY_CRC_PRESENT: u16 = 1 << 0;
const FRAME_FLAG_MASK: u16 = FLAG_BODY_CRC_PRESENT;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Compressor {
    /// Body is stored verbatim.
    Stored = 0,
    /// Raw DEFLATE (RFC 1951), no zlib or gzip wrapper.
    DeflateRaw = 1,
}

impl Compressor {
    fn from_u8(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Stored),
            1 => Ok(Self::DeflateRaw),
            other => Err(ShareError::UnknownCompressor(other)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub format_version: u8,
    pub compressor: Compressor,
    pub raw_body_len: usize,
    pub crc_present: bool,
}

/// Wrap a body: compress it if that helps, checksum the *uncompressed* bytes,
/// and prepend the frame.
///
/// The checksum covers the uncompressed body so it validates the thing the
/// version decoder will actually read, independent of which compressor ran.
pub fn write(format_version: u8, body: &[u8]) -> Vec<u8> {
    let deflated = miniz_oxide::deflate::compress_to_vec(body, 10);
    let (compressor, payload) = if deflated.len() < body.len() {
        (Compressor::DeflateRaw, deflated)
    } else {
        (Compressor::Stored, body.to_vec())
    };

    let mut out = Vec::with_capacity(FRAME_LEN + payload.len());
    out.extend_from_slice(&MAGIC);
    out.push(format_version);
    out.push(compressor as u8);
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&FLAG_BODY_CRC_PRESENT.to_le_bytes());
    out.extend_from_slice(&crc32fast::hash(body).to_le_bytes());
    debug_assert_eq!(out.len(), FRAME_LEN);
    out.extend_from_slice(&payload);
    out
}

/// Parse and fully validate a frame, returning the header and the decompressed
/// body. Every reject happens before the body is materialised.
pub fn read(bytes: &[u8], supported_versions: &[u8]) -> Result<(FrameHeader, Vec<u8>)> {
    if bytes.len() < FRAME_LEN {
        return Err(ShareError::Truncated {
            need: FRAME_LEN,
            got: bytes.len(),
        });
    }
    if bytes[0..4] != MAGIC {
        return Err(ShareError::BadMagic);
    }

    let format_version = bytes[4];
    if !supported_versions.contains(&format_version) {
        return Err(ShareError::UnknownVersion(format_version));
    }
    let compressor = Compressor::from_u8(bytes[5])?;

    let raw_body_len = u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;
    let flags = u16::from_le_bytes([bytes[10], bytes[11]]);
    if flags & !FRAME_FLAG_MASK != 0 {
        return Err(ShareError::ReservedFrameFlags);
    }
    let crc_present = flags & FLAG_BODY_CRC_PRESENT != 0;
    let expected_crc = u32::from_le_bytes([bytes[12], bytes[13], bytes[14], bytes[15]]);

    if raw_body_len > MAX_BODY_LEN {
        return Err(ShareError::BodyTooLarge {
            declared: raw_body_len,
            limit: MAX_BODY_LEN,
        });
    }

    let payload = &bytes[FRAME_LEN..];
    // Guard before allocating: the ratio check uses the compressed length that
    // is actually present, so a 13-byte forgery cannot claim 8 MiB.
    let ratio = raw_body_len / payload.len().max(1);
    if ratio > MAX_EXPANSION_RATIO {
        return Err(ShareError::ExpansionRatio {
            declared: raw_body_len,
            ratio,
        });
    }

    let body = match compressor {
        Compressor::Stored => payload.to_vec(),
        Compressor::DeflateRaw => {
            miniz_oxide::inflate::decompress_to_vec_with_limit(payload, raw_body_len)
                .map_err(|_| ShareError::Decompress)?
        }
    };

    if body.len() != raw_body_len {
        return Err(ShareError::LengthMismatch {
            declared: raw_body_len,
            actual: body.len(),
        });
    }
    if crc_present && crc32fast::hash(&body) != expected_crc {
        return Err(ShareError::ChecksumMismatch);
    }

    Ok((
        FrameHeader {
            format_version,
            compressor,
            raw_body_len,
            crc_present,
        },
        body,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    const V: &[u8] = &[1];

    #[test]
    fn roundtrips_a_compressible_body() {
        let body = vec![7u8; 4096];
        let framed = write(1, &body);
        assert!(framed.len() < body.len(), "should have compressed");
        let (header, decoded) = read(&framed, V).unwrap();
        assert_eq!(header.compressor, Compressor::DeflateRaw);
        assert_eq!(header.raw_body_len, body.len());
        assert_eq!(decoded, body);
    }

    #[test]
    fn stores_a_body_that_does_not_compress() {
        // A short incompressible body: deflate would add overhead.
        let body = vec![0x5au8, 0x17, 0xc3];
        let framed = write(1, &body);
        let (header, decoded) = read(&framed, V).unwrap();
        assert_eq!(header.compressor, Compressor::Stored);
        assert_eq!(decoded, body);
    }

    #[test]
    fn rejects_bad_magic() {
        let mut framed = write(1, b"hello");
        framed[0] = b'X';
        assert_eq!(read(&framed, V), Err(ShareError::BadMagic));
    }

    #[test]
    fn rejects_unknown_version_without_partial_decode() {
        let framed = write(9, b"hello");
        assert_eq!(read(&framed, V), Err(ShareError::UnknownVersion(9)));
    }

    #[test]
    fn rejects_reserved_flags() {
        let mut framed = write(1, b"hello");
        framed[11] = 0x80;
        assert_eq!(read(&framed, V), Err(ShareError::ReservedFrameFlags));
    }

    #[test]
    fn rejects_checksum_mismatch() {
        let body = vec![1u8, 2, 3, 4, 5];
        let mut framed = write(1, &body);
        let last = framed.len() - 1;
        framed[last] ^= 0xff;
        assert!(matches!(
            read(&framed, V),
            Err(ShareError::ChecksumMismatch
                | ShareError::Decompress
                | ShareError::LengthMismatch { .. })
        ));
    }

    #[test]
    fn rejects_a_decompression_bomb() {
        // Claim a huge expansion from a tiny payload.
        let mut framed = write(1, b"x");
        framed[5] = Compressor::DeflateRaw as u8;
        framed[6..10].copy_from_slice(&(1_000_000u32).to_le_bytes());
        assert!(matches!(
            read(&framed, V),
            Err(ShareError::ExpansionRatio { .. })
        ));
    }

    #[test]
    fn rejects_an_oversized_declared_body() {
        let mut framed = write(1, b"x");
        framed[6..10].copy_from_slice(&(u32::MAX).to_le_bytes());
        assert!(matches!(
            read(&framed, V),
            Err(ShareError::BodyTooLarge { .. })
        ));
    }

    #[test]
    fn truncation_at_every_offset_is_an_error_never_a_panic() {
        let framed = write(1, &vec![3u8; 512]);
        for cut in 0..framed.len() {
            let _ = read(&framed[..cut], V);
        }
    }
}
