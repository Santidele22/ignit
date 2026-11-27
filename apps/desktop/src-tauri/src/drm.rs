use crate::igb1::{ReadingChunk, IGB1_GCM_TAG_BYTES, IGB1_KEY_BYTES, IGB1_NONCE_BYTES, IGB1_VERSION};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::Engine;
use flate2::read::GzDecoder;
use rsa::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding},
    Oaep, RsaPrivateKey, RsaPublicKey,
};
use sha2::Sha256;
use std::io::Read;
use zeroize::Zeroizing;

pub fn build_chapter_aad(book_id: &str, chapter_index: u32) -> Vec<u8> {
    format!("{book_id}|{IGB1_VERSION}|editorial_closed|ch:{chapter_index}").into_bytes()
}

pub fn unwrap_cek_rsa_oaep(
    wrapped_cek_b64: &str,
    private_key_pem: &str,
) -> Result<Zeroizing<[u8; IGB1_KEY_BYTES]>, String> {
    let wrapped = base64::engine::general_purpose::STANDARD
        .decode(wrapped_cek_b64)
        .map_err(|e| format!("Invalid wrappedCek base64: {e}"))?;
    let priv_key = RsaPrivateKey::from_pkcs8_pem(private_key_pem)
        .map_err(|e| format!("Invalid device private key PEM: {e}"))?;
    let padding = Oaep::new::<Sha256>();
    let raw = priv_key
        .decrypt(padding, &wrapped)
        .map_err(|e| format!("Failed to unwrap CEK: {e}"))?;
    let arr: [u8; IGB1_KEY_BYTES] = raw
        .try_into()
        .map_err(|_| "Unwrapped CEK is not 32 bytes".to_string())?;
    Ok(Zeroizing::new(arr))
}

pub fn decode_editorial_chapter(
    book_id: &str,
    chapter_index: u32,
    iv_b64: &str,
    ciphertext_b64: &str,
    cek: &[u8; IGB1_KEY_BYTES],
) -> Result<Vec<ReadingChunk>, String> {
    let iv_vec = base64::engine::general_purpose::STANDARD
        .decode(iv_b64)
        .map_err(|e| format!("Invalid chapter IV base64: {e}"))?;
    if iv_vec.len() != IGB1_NONCE_BYTES {
        return Err("Invalid chapter IV length".to_string());
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(ciphertext_b64)
        .map_err(|e| format!("Invalid chapter ciphertext base64: {e}"))?;
    if raw.len() < IGB1_GCM_TAG_BYTES {
        return Err("Missing GCM tag in chapter packet".to_string());
    }

    let cipher = Aes256Gcm::new_from_slice(cek).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(&iv_vec);
    let aad = build_chapter_aad(book_id, chapter_index);
    let compressed = cipher
        .decrypt(nonce, Payload { msg: &raw, aad: &aad })
        .map_err(|e| format!("Chapter AES-256-GCM decrypt failed: {e}"))?;

    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut json_bytes = Vec::new();
    decoder.read_to_end(&mut json_bytes).map_err(|e| e.to_string())?;
    serde_json::from_slice::<Vec<ReadingChunk>>(&json_bytes).map_err(|e| e.to_string())
}

pub fn generate_device_rsa_keypair() -> Result<(String, Zeroizing<String>), String> {
    let mut rng = rand_core_compat();
    let priv_key = RsaPrivateKey::new(&mut rng, 2048).map_err(|e| e.to_string())?;
    let pub_key = RsaPublicKey::from(&priv_key);
    let pub_pem = pub_key.to_public_key_pem(LineEnding::LF).map_err(|e| e.to_string())?;
    let priv_pem = priv_key
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;
    Ok((pub_pem, Zeroizing::new(priv_pem.to_string())))
}

pub fn wrap_cek_for_public_key_pem(cek: &[u8; 32], public_key_pem: &str) -> Result<String, String> {
    let pub_key = RsaPublicKey::from_public_key_pem(public_key_pem).map_err(|e| e.to_string())?;
    let mut rng = rand_core_compat();
    let wrapped = pub_key
        .encrypt(&mut rng, Oaep::new::<Sha256>(), cek)
        .map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(wrapped))
}

fn rand_core_compat() -> aes_gcm::aead::OsRng {
    aes_gcm::aead::OsRng
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{write::GzEncoder, Compression};
    use std::io::Write;

    #[test]
    fn unwraps_cek_with_device_key_and_decrypts_single_chapter_in_ram() {
        let (pub_a, priv_a) = generate_device_rsa_keypair().unwrap();
        let (_pub_b, priv_b) = generate_device_rsa_keypair().unwrap();
        let cek = [0x7au8; 32];

        let wrapped = wrap_cek_for_public_key_pem(&cek, &pub_a).unwrap();

        // Device A unwraps CEK into Zeroizing buffer
        let unwrapped = unwrap_cek_rsa_oaep(&wrapped, &priv_a).unwrap();
        assert_eq!(&*unwrapped, &cek);

        // Device B cannot unwrap Device A's CEK
        assert!(unwrap_cek_rsa_oaep(&wrapped, &priv_b).is_err());

        // Encrypt chapter 2 in AES-256-GCM with chapter-specific AAD
        let chunks = vec![ReadingChunk {
            id: "ch2-1".to_string(),
            chunk_type: "para".to_string(),
            page: 12,
            offset: 0,
            text: "Capítulo 2 editorial protegido en RAM.".to_string(),
            mood: "espera".to_string(),
            cues: vec![],
            level: None,
            runs: None,
            ordered: None,
            items: None,
            align: Some("left".to_string()),
        }];
        let mut gz = GzEncoder::new(Vec::new(), Compression::best());
        gz.write_all(&serde_json::to_vec(&chunks).unwrap()).unwrap();
        let compressed = gz.finish().unwrap();

        let iv = [0x33u8; 12];
        let cipher = Aes256Gcm::new_from_slice(&*unwrapped).unwrap();
        let ct = cipher
            .encrypt(
                Nonce::from_slice(&iv),
                Payload {
                    msg: &compressed,
                    aad: &build_chapter_aad("700", 2),
                },
            )
            .unwrap();

        let iv_b64 = base64::engine::general_purpose::STANDARD.encode(iv);
        let ct_b64 = base64::engine::general_purpose::STANDARD.encode(ct);

        let decoded = decode_editorial_chapter("700", 2, &iv_b64, &ct_b64, &unwrapped).unwrap();
        assert_eq!(decoded, chunks);

        // Wrong chapter index AAD fails
        assert!(decode_editorial_chapter("700", 1, &iv_b64, &ct_b64, &unwrapped).is_err());
    }
}
