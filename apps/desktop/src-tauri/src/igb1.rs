use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

pub const IGB1_MAGIC: &[u8; 4] = b"IGB1";
pub const IGB1_VERSION: u8 = 1;
pub const IGB1_HEADER_BYTES: usize = 18;
pub const IGB1_NONCE_BYTES: usize = 12;
pub const IGB1_GCM_TAG_BYTES: usize = 16;
pub const IGB1_KEY_BYTES: usize = 32;

pub const IGB1_FLAG_BROTLI: u8 = 1 << 0;
pub const IGB1_FLAG_ENCRYPTED: u8 = 1 << 1;
pub const IGB1_FLAG_CHUNKED: u8 = 1 << 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentTier {
    PublicOpen,
    PrivateUser,
    EditorialClosed,
}

impl ContentTier {
    pub fn as_str(self) -> &'static str {
        match self {
            ContentTier::PublicOpen => "public_open",
            ContentTier::PrivateUser => "private_user",
            ContentTier::EditorialClosed => "editorial_closed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadingInlineRun {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marks: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingChunk {
    pub id: String,
    #[serde(rename = "type")]
    pub chunk_type: String,
    pub page: u32,
    pub offset: u32,
    pub text: String,
    pub mood: String,
    pub cues: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs: Option<Vec<ReadingInlineRun>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordered: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BookReadingDocument {
    pub book_id: String,
    pub pdf_pages: u32,
    pub ocr_pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extractor_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refined_by_ai: Option<bool>,
    pub chunks: Vec<ReadingChunk>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompactReadingChunk {
    i: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    t: Option<String>,
    p: u32,
    o: u32,
    x: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    m: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    q: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    l: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    r: Option<Vec<ReadingInlineRun>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ord: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    it: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    a: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CompactReadingDocument {
    v: u8,
    b: String,
    p: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    o: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ev: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ai: Option<u8>,
    c: Vec<CompactReadingChunk>,
}

fn compact_doc(doc: &BookReadingDocument) -> CompactReadingDocument {
    CompactReadingDocument {
        v: 1,
        b: doc.book_id.clone(),
        p: doc.pdf_pages,
        o: if doc.ocr_pending { Some(1) } else { None },
        ev: doc.extractor_version,
        ai: if doc.refined_by_ai == Some(true) { Some(1) } else { None },
        c: doc
            .chunks
            .iter()
            .map(|ch| CompactReadingChunk {
                i: ch.id.clone(),
                t: if ch.chunk_type != "para" { Some(ch.chunk_type.clone()) } else { None },
                p: ch.page,
                o: ch.offset,
                x: ch.text.clone(),
                m: if ch.mood != "espera" { Some(ch.mood.clone()) } else { None },
                q: if !ch.cues.is_empty() { Some(ch.cues.clone()) } else { None },
                l: ch.level,
                r: ch.runs.as_ref().filter(|v| !v.is_empty()).cloned(),
                ord: if ch.ordered == Some(true) { Some(1) } else { None },
                it: ch.items.as_ref().filter(|v| !v.is_empty()).cloned(),
                a: ch.align.as_ref().filter(|s| *s == "center" || *s == "right").cloned(),
            })
            .collect(),
    }
}

fn expand_doc(compact: CompactReadingDocument) -> Result<BookReadingDocument, String> {
    if compact.v != 1 {
        return Err(format!("Unsupported CompactReadingDocument version: {}", compact.v));
    }
    Ok(BookReadingDocument {
        book_id: compact.b,
        pdf_pages: compact.p,
        ocr_pending: compact.o == Some(1),
        extractor_version: compact.ev,
        refined_by_ai: if compact.ai == Some(1) { Some(true) } else { None },
        chunks: compact
            .c
            .into_iter()
            .map(|ch| ReadingChunk {
                id: ch.i,
                chunk_type: ch.t.unwrap_or_else(|| "para".to_string()),
                page: ch.p,
                offset: ch.o,
                text: ch.x,
                mood: ch.m.unwrap_or_else(|| "espera".to_string()),
                cues: ch.q.unwrap_or_default(),
                level: ch.l,
                runs: ch.r,
                ordered: if ch.ord == Some(1) { Some(true) } else { None },
                items: ch.it,
                align: Some(ch.a.unwrap_or_else(|| "left".to_string())),
            })
            .collect(),
    })
}

pub fn build_igb1_aad(book_id: &str, version: u8, tier: ContentTier) -> Vec<u8> {
    format!("{}|{}|{}", book_id, version, tier.as_str()).into_bytes()
}

pub fn encode_igb1(
    doc: &BookReadingDocument,
    book_id: &str,
    tier: ContentTier,
    key: Option<&[u8; IGB1_KEY_BYTES]>,
    iv: Option<&[u8; IGB1_NONCE_BYTES]>,
) -> Result<Vec<u8>, String> {
    let encrypted = tier != ContentTier::PublicOpen;
    let compact = compact_doc(doc);
    let json = serde_json::to_vec(&compact).map_err(|e| e.to_string())?;

    let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&json).map_err(|e| e.to_string())?;
    let compressed = encoder.finish().map_err(|e| e.to_string())?;

    let flags: u8 = if encrypted { IGB1_FLAG_ENCRYPTED } else { 0 };
    let nonce_bytes: [u8; IGB1_NONCE_BYTES] = if encrypted {
        *iv.ok_or_else(|| "IV is required for encrypted IGB1".to_string())?
    } else {
        [0u8; IGB1_NONCE_BYTES]
    };

    let mut out = Vec::with_capacity(IGB1_HEADER_BYTES + compressed.len() + IGB1_GCM_TAG_BYTES);
    out.extend_from_slice(IGB1_MAGIC);
    out.push(IGB1_VERSION);
    out.push(flags);
    out.extend_from_slice(&nonce_bytes);

    if !encrypted {
        out.extend_from_slice(&compressed);
        return Ok(out);
    }

    let raw_key = key.ok_or_else(|| "32-byte key is required for encrypted IGB1".to_string())?;
    let cipher = Aes256Gcm::new_from_slice(raw_key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&nonce_bytes);
    let aad = build_igb1_aad(book_id, IGB1_VERSION, tier);
    let ciphertext = cipher
        .encrypt(nonce, Payload { msg: &compressed, aad: &aad })
        .map_err(|e| format!("AES-256-GCM encrypt failed: {e}"))?;
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

pub fn decode_igb1(
    bytes: &[u8],
    book_id: &str,
    tier: ContentTier,
    key: Option<&[u8; IGB1_KEY_BYTES]>,
) -> Result<BookReadingDocument, String> {
    if bytes.len() < IGB1_HEADER_BYTES {
        return Err("Invalid IGB1 buffer: too short".to_string());
    }
    if &bytes[0..4] != IGB1_MAGIC {
        return Err("Invalid IGB1 magic".to_string());
    }
    let version = bytes[4];
    if version != IGB1_VERSION {
        return Err(format!("Unsupported IGB1 version: {version}"));
    }
    let flags = bytes[5];
    let nonce_bytes = &bytes[6..IGB1_HEADER_BYTES];
    let use_brotli = (flags & IGB1_FLAG_BROTLI) != 0;
    let encrypted = (flags & IGB1_FLAG_ENCRYPTED) != 0;

    let compressed = if !encrypted {
        bytes[IGB1_HEADER_BYTES..].to_vec()
    } else {
        let raw_key = key.ok_or_else(|| "32-byte key is required for encrypted IGB1".to_string())?;
        if bytes.len() < IGB1_HEADER_BYTES + IGB1_GCM_TAG_BYTES {
            return Err("Invalid encrypted IGB1 buffer: missing GCM tag".to_string());
        }
        let cipher = Aes256Gcm::new_from_slice(raw_key).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(nonce_bytes);
        let aad = build_igb1_aad(book_id, version, tier);
        cipher
            .decrypt(
                nonce,
                Payload {
                    msg: &bytes[IGB1_HEADER_BYTES..],
                    aad: &aad,
                },
            )
            .map_err(|e| format!("AES-256-GCM decrypt failed: {e}"))?
    };

    let mut decompressed = Vec::new();
    if use_brotli {
        let mut reader = brotli::Decompressor::new(compressed.as_slice(), 4096);
        reader.read_to_end(&mut decompressed).map_err(|e| e.to_string())?;
    } else {
        let mut decoder = GzDecoder::new(compressed.as_slice());
        decoder.read_to_end(&mut decompressed).map_err(|e| e.to_string())?;
    }

    let compact: CompactReadingDocument =
        serde_json::from_slice(&decompressed).map_err(|e| e.to_string())?;
    expand_doc(compact)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GoldenVector {
        book_id: String,
        tier: String,
        key_hex: Option<String>,
        igb1_base64: String,
        expected_document: BookReadingDocument,
    }

    #[derive(Deserialize)]
    struct GoldenVectorsFile {
        vectors: Vec<GoldenVector>,
    }

    fn parse_tier(s: &str) -> ContentTier {
        match s {
            "public_open" => ContentTier::PublicOpen,
            "private_user" => ContentTier::PrivateUser,
            "editorial_closed" => ContentTier::EditorialClosed,
            other => panic!("Unknown tier: {other}"),
        }
    }

    #[test]
    fn decodes_all_cross_platform_golden_vectors() {
        let raw = include_str!("../../../../docs/specs/igb1-golden-vectors.json");
        let file: GoldenVectorsFile = serde_json::from_str(raw).expect("valid golden vectors json");
        assert!(file.vectors.len() >= 4);

        for vec in file.vectors {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&vec.igb1_base64)
                .expect("valid base64");
            let key_vec = vec
                .key_hex
                .as_ref()
                .map(|h| hex::decode(h).expect("valid key hex"));
            let key_arr: Option<[u8; 32]> = key_vec.map(|k| k.try_into().expect("32-byte key"));
            let decoded = decode_igb1(&bytes, &vec.book_id, parse_tier(&vec.tier), key_arr.as_ref())
                .expect("decode_igb1 should succeed");
            assert_eq!(decoded, vec.expected_document);
        }
    }

    #[test]
    fn roundtrips_aes256_gcm_and_rejects_tamper() {
        let key: [u8; 32] = [0x42; 32];
        let iv: [u8; 12] = [0x11; 12];
        let doc = BookReadingDocument {
            book_id: "55".to_string(),
            pdf_pages: 3,
            ocr_pending: false,
            extractor_version: Some(3),
            refined_by_ai: Some(true),
            chunks: vec![ReadingChunk {
                id: "c-1".to_string(),
                chunk_type: "para".to_string(),
                page: 1,
                offset: 0,
                text: "Lectura offline encriptada en Rust Tauri.".to_string(),
                mood: "espera".to_string(),
                cues: vec![],
                level: None,
                runs: None,
                ordered: None,
                items: None,
                align: Some("left".to_string()),
            }],
        };

        let encoded = encode_igb1(&doc, "55", ContentTier::PrivateUser, Some(&key), Some(&iv))
            .expect("encode");
        let decoded = decode_igb1(&encoded, "55", ContentTier::PrivateUser, Some(&key))
            .expect("decode");
        assert_eq!(decoded, doc);

        // Wrong bookId in AAD must fail
        assert!(decode_igb1(&encoded, "99", ContentTier::PrivateUser, Some(&key)).is_err());

        // Tampered GCM tag must fail
        let mut tampered = encoded.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 0xff;
        assert!(decode_igb1(&tampered, "55", ContentTier::PrivateUser, Some(&key)).is_err());
    }
}
