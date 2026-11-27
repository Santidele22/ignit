use crate::igb1::{decode_igb1, BookReadingDocument, ContentTier};
use crate::offline::validate_book_id;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalBookRow {
    pub id: String,
    pub remote_id: Option<i64>,
    pub content_hash: Option<String>,
    pub content_tier: String,
    pub title: String,
    pub author: String,
    pub kind: String,
    pub status: String,
    pub igb_local_path: Option<String>,
    pub igb_bytes: Option<i64>,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalReadingStateRow {
    pub book_id: String,
    pub page: i64,
    pub pct: f64,
    pub chunk_id: Option<String>,
    pub marks_json: String,
    pub words_json: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalLicenseRow {
    pub book_id: String,
    pub device_id: String,
    pub wrapped_key: String,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutboxRow {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    pub op: String,
    pub payload_json: String,
    pub created_at: i64,
    pub retry_count: i64,
    pub last_error: Option<String>,
}

pub struct LocalDb {
    conn: Connection,
}

impl LocalDb {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        let db = Self { conn };
        db.init_schema()?;
        Ok(db)
    }

    pub fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                PRAGMA journal_mode = WAL;
                PRAGMA foreign_keys = ON;

                CREATE TABLE IF NOT EXISTS local_books (
                    id TEXT PRIMARY KEY,
                    remote_id INTEGER,
                    content_hash TEXT,
                    content_tier TEXT NOT NULL DEFAULT 'private_user',
                    title TEXT NOT NULL,
                    author TEXT NOT NULL,
                    kind TEXT NOT NULL DEFAULT 'no_tecnico',
                    status TEXT NOT NULL DEFAULT 'queued',
                    igb_local_path TEXT,
                    igb_bytes INTEGER,
                    updated_at INTEGER NOT NULL,
                    deleted_at INTEGER
                );

                CREATE TABLE IF NOT EXISTS local_reading_states (
                    book_id TEXT PRIMARY KEY,
                    page INTEGER NOT NULL DEFAULT 1,
                    pct REAL NOT NULL DEFAULT 0.0,
                    chunk_id TEXT,
                    marks_json TEXT NOT NULL DEFAULT '[]',
                    words_json TEXT NOT NULL DEFAULT '[]',
                    updated_at INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS local_licenses (
                    book_id TEXT NOT NULL,
                    device_id TEXT NOT NULL,
                    wrapped_key TEXT NOT NULL,
                    expires_at INTEGER,
                    revoked_at INTEGER,
                    PRIMARY KEY (book_id, device_id)
                );

                CREATE TABLE IF NOT EXISTS sync_outbox (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    entity_type TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    op TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    retry_count INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT
                );

                CREATE TABLE IF NOT EXISTS sync_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                ",
            )
            .map_err(|e| e.to_string())
    }

    pub fn upsert_book(&self, book: &LocalBookRow) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO local_books (
                    id, remote_id, content_hash, content_tier, title, author,
                    kind, status, igb_local_path, igb_bytes, updated_at, deleted_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(id) DO UPDATE SET
                    remote_id = excluded.remote_id,
                    content_hash = excluded.content_hash,
                    content_tier = excluded.content_tier,
                    title = excluded.title,
                    author = excluded.author,
                    kind = excluded.kind,
                    status = excluded.status,
                    igb_local_path = COALESCE(excluded.igb_local_path, local_books.igb_local_path),
                    igb_bytes = COALESCE(excluded.igb_bytes, local_books.igb_bytes),
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at",
                params![
                    book.id,
                    book.remote_id,
                    book.content_hash,
                    book.content_tier,
                    book.title,
                    book.author,
                    book.kind,
                    book.status,
                    book.igb_local_path,
                    book.igb_bytes,
                    book.updated_at,
                    book.deleted_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_books(&self) -> Result<Vec<LocalBookRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, remote_id, content_hash, content_tier, title, author,
                        kind, status, igb_local_path, igb_bytes, updated_at, deleted_at
                 FROM local_books
                 WHERE deleted_at IS NULL
                 ORDER BY updated_at DESC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |r| {
                Ok(LocalBookRow {
                    id: r.get(0)?,
                    remote_id: r.get(1)?,
                    content_hash: r.get(2)?,
                    content_tier: r.get(3)?,
                    title: r.get(4)?,
                    author: r.get(5)?,
                    kind: r.get(6)?,
                    status: r.get(7)?,
                    igb_local_path: r.get(8)?,
                    igb_bytes: r.get(9)?,
                    updated_at: r.get(10)?,
                    deleted_at: r.get(11)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_book(&self, id: &str) -> Result<Option<LocalBookRow>, String> {
        self.conn
            .query_row(
                "SELECT id, remote_id, content_hash, content_tier, title, author,
                        kind, status, igb_local_path, igb_bytes, updated_at, deleted_at
                 FROM local_books
                 WHERE id = ?1",
                params![id],
                |r| {
                    Ok(LocalBookRow {
                        id: r.get(0)?,
                        remote_id: r.get(1)?,
                        content_hash: r.get(2)?,
                        content_tier: r.get(3)?,
                        title: r.get(4)?,
                        author: r.get(5)?,
                        kind: r.get(6)?,
                        status: r.get(7)?,
                        igb_local_path: r.get(8)?,
                        igb_bytes: r.get(9)?,
                        updated_at: r.get(10)?,
                        deleted_at: r.get(11)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn soft_delete_book(&self, id: &str, deleted_at: i64) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE local_books SET deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, deleted_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn upsert_reading_state(&self, state: &LocalReadingStateRow) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO local_reading_states (
                    book_id, page, pct, chunk_id, marks_json, words_json, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(book_id) DO UPDATE SET
                    page = excluded.page,
                    pct = excluded.pct,
                    chunk_id = excluded.chunk_id,
                    marks_json = excluded.marks_json,
                    words_json = excluded.words_json,
                    updated_at = excluded.updated_at",
                params![
                    state.book_id,
                    state.page,
                    state.pct,
                    state.chunk_id,
                    state.marks_json,
                    state.words_json,
                    state.updated_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_reading_state(&self, book_id: &str) -> Result<Option<LocalReadingStateRow>, String> {
        self.conn
            .query_row(
                "SELECT book_id, page, pct, chunk_id, marks_json, words_json, updated_at
                 FROM local_reading_states WHERE book_id = ?1",
                params![book_id],
                |r| {
                    Ok(LocalReadingStateRow {
                        book_id: r.get(0)?,
                        page: r.get(1)?,
                        pct: r.get(2)?,
                        chunk_id: r.get(3)?,
                        marks_json: r.get(4)?,
                        words_json: r.get(5)?,
                        updated_at: r.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn upsert_license(&self, license: &LocalLicenseRow) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO local_licenses (
                    book_id, device_id, wrapped_key, expires_at, revoked_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(book_id, device_id) DO UPDATE SET
                    wrapped_key = excluded.wrapped_key,
                    expires_at = excluded.expires_at,
                    revoked_at = excluded.revoked_at",
                params![
                    license.book_id,
                    license.device_id,
                    license.wrapped_key,
                    license.expires_at,
                    license.revoked_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_license(&self, book_id: &str, device_id: &str) -> Result<Option<LocalLicenseRow>, String> {
        self.conn
            .query_row(
                "SELECT book_id, device_id, wrapped_key, expires_at, revoked_at
                 FROM local_licenses WHERE book_id = ?1 AND device_id = ?2",
                params![book_id, device_id],
                |r| {
                    Ok(LocalLicenseRow {
                        book_id: r.get(0)?,
                        device_id: r.get(1)?,
                        wrapped_key: r.get(2)?,
                        expires_at: r.get(3)?,
                        revoked_at: r.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn enqueue_outbox(
        &self,
        entity_type: &str,
        entity_id: &str,
        op: &str,
        payload_json: &str,
        created_at: i64,
    ) -> Result<i64, String> {
        self.conn
            .execute(
                "INSERT INTO sync_outbox (entity_type, entity_id, op, payload_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![entity_type, entity_id, op, payload_json, created_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn list_pending_outbox(&self, limit: i64) -> Result<Vec<SyncOutboxRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, entity_type, entity_id, op, payload_json, created_at, retry_count, last_error
                 FROM sync_outbox
                 ORDER BY id ASC
                 LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                Ok(SyncOutboxRow {
                    id: r.get(0)?,
                    entity_type: r.get(1)?,
                    entity_id: r.get(2)?,
                    op: r.get(3)?,
                    payload_json: r.get(4)?,
                    created_at: r.get(5)?,
                    retry_count: r.get(6)?,
                    last_error: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn mark_outbox_done(&self, id: i64) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM sync_outbox WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_outbox_retry(&self, id: i64, error: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE sync_outbox SET retry_count = retry_count + 1, last_error = ?2 WHERE id = ?1",
                params![id, error],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_meta(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row(
                "SELECT value FROM sync_meta WHERE key = ?1",
                params![key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO sync_meta (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub fn save_igb_blob(dir: &Path, book_id: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let valid_id = validate_book_id(book_id)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{valid_id}.igb"));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn read_igb_blob(dir: &Path, book_id: &str) -> Result<Vec<u8>, String> {
    let valid_id = validate_book_id(book_id)?;
    let path = dir.join(format!("{valid_id}.igb"));
    fs::read(path).map_err(|e| e.to_string())
}

fn app_db(app: &tauri::AppHandle) -> Result<LocalDb, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    LocalDb::open(&base.join("ignit-local.sqlite"))
}

fn app_igb_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("igb"))
}

#[tauri::command]
pub fn local_db_list_books(app: tauri::AppHandle) -> Result<Vec<LocalBookRow>, String> {
    app_db(&app)?.list_books()
}

#[tauri::command]
pub fn local_db_upsert_book(
    app: tauri::AppHandle,
    book: LocalBookRow,
    enqueue_sync: Option<bool>,
) -> Result<(), String> {
    let db = app_db(&app)?;
    db.upsert_book(&book)?;
    if enqueue_sync.unwrap_or(true) {
        let payload = serde_json::to_string(&book).map_err(|e| e.to_string())?;
        db.enqueue_outbox("book", &book.id, "upsert", &payload, book.updated_at)?;
    }
    Ok(())
}

#[tauri::command]
pub fn local_db_delete_book(
    app: tauri::AppHandle,
    book_id: String,
    deleted_at: i64,
) -> Result<(), String> {
    let db = app_db(&app)?;
    db.soft_delete_book(&book_id, deleted_at)?;
    db.enqueue_outbox("book", &book_id, "delete", "{}", deleted_at)?;
    Ok(())
}

#[tauri::command]
pub fn local_db_get_reading_state(
    app: tauri::AppHandle,
    book_id: String,
) -> Result<Option<LocalReadingStateRow>, String> {
    app_db(&app)?.get_reading_state(&book_id)
}

#[tauri::command]
pub fn local_db_save_reading_state(
    app: tauri::AppHandle,
    state: LocalReadingStateRow,
    enqueue_sync: Option<bool>,
) -> Result<(), String> {
    let db = app_db(&app)?;
    db.upsert_reading_state(&state)?;
    if enqueue_sync.unwrap_or(true) {
        let payload = serde_json::to_string(&state).map_err(|e| e.to_string())?;
        db.enqueue_outbox("reading_state", &state.book_id, "upsert", &payload, state.updated_at)?;
    }
    Ok(())
}

#[tauri::command]
pub fn local_db_save_igb_book(
    app: tauri::AppHandle,
    book_id: String,
    igb_bytes: Vec<u8>,
) -> Result<String, String> {
    let dir = app_igb_dir(&app)?;
    let path = save_igb_blob(&dir, &book_id, &igb_bytes)?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn local_db_read_igb_book(
    app: tauri::AppHandle,
    book_id: String,
    tier: String,
    key_hex: Option<String>,
) -> Result<BookReadingDocument, String> {
    let dir = app_igb_dir(&app)?;
    let bytes = read_igb_blob(&dir, &book_id)?;
    let content_tier = match tier.as_str() {
        "public_open" => ContentTier::PublicOpen,
        "private_user" => ContentTier::PrivateUser,
        "editorial_closed" => ContentTier::EditorialClosed,
        other => return Err(format!("Unknown tier: {other}")),
    };
    let key_arr: Option<[u8; 32]> = match key_hex {
        Some(h) => {
            let decoded = hex::decode(h).map_err(|e| e.to_string())?;
            let arr: [u8; 32] = decoded
                .try_into()
                .map_err(|_| "key_hex must decode to 32 bytes".to_string())?;
            Some(arr)
        }
        None => None,
    };
    decode_igb1(&bytes, &book_id, content_tier, key_arr.as_ref())
}

#[tauri::command]
pub fn local_db_pending_outbox(
    app: tauri::AppHandle,
    limit: Option<i64>,
) -> Result<Vec<SyncOutboxRow>, String> {
    app_db(&app)?.list_pending_outbox(limit.unwrap_or(50))
}

#[tauri::command]
pub fn local_db_get_meta(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    app_db(&app)?.get_meta(&key)
}

#[tauri::command]
pub fn local_db_set_meta(
    app: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    app_db(&app)?.set_meta(&key, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::igb1::{encode_igb1, ReadingChunk};

    #[test]
    fn crud_books_reading_state_licenses_outbox_and_meta() {
        let db = LocalDb::open_in_memory().expect("open in-memory sqlite");

        let book = LocalBookRow {
            id: "b-1".to_string(),
            remote_id: Some(10),
            content_hash: Some("abc123".to_string()),
            content_tier: "private_user".to_string(),
            title: "Ficciones".to_string(),
            author: "Borges".to_string(),
            kind: "ficcion".to_string(),
            status: "reading".to_string(),
            igb_local_path: Some("/tmp/b-1.igb".to_string()),
            igb_bytes: Some(1024),
            updated_at: 1_700_000_000,
            deleted_at: None,
        };
        db.upsert_book(&book).unwrap();
        assert_eq!(db.list_books().unwrap().len(), 1);
        assert_eq!(db.get_book("b-1").unwrap().unwrap().title, "Ficciones");

        let state = LocalReadingStateRow {
            book_id: "b-1".to_string(),
            page: 42,
            pct: 0.35,
            chunk_id: Some("c-42".to_string()),
            marks_json: r#"[{"id":"m1"}]"#.to_string(),
            words_json: "[]".to_string(),
            updated_at: 1_700_000_010,
        };
        db.upsert_reading_state(&state).unwrap();
        assert_eq!(db.get_reading_state("b-1").unwrap().unwrap().page, 42);

        let lic = LocalLicenseRow {
            book_id: "b-1".to_string(),
            device_id: "dev-linux".to_string(),
            wrapped_key: "wrapped".to_string(),
            expires_at: None,
            revoked_at: None,
        };
        db.upsert_license(&lic).unwrap();
        assert_eq!(
            db.get_license("b-1", "dev-linux").unwrap().unwrap().wrapped_key,
            "wrapped"
        );

        let outbox_id = db
            .enqueue_outbox("reading_state", "b-1", "upsert", "{}", 1_700_000_010)
            .unwrap();
        assert_eq!(db.list_pending_outbox(10).unwrap().len(), 1);
        db.mark_outbox_retry(outbox_id, "offline").unwrap();
        assert_eq!(db.list_pending_outbox(10).unwrap()[0].retry_count, 1);
        db.mark_outbox_done(outbox_id).unwrap();
        assert!(db.list_pending_outbox(10).unwrap().is_empty());

        db.set_meta("last_sync_at", "1700000010").unwrap();
        assert_eq!(db.get_meta("last_sync_at").unwrap().as_deref(), Some("1700000010"));

        db.soft_delete_book("b-1", 1_700_000_020).unwrap();
        assert!(db.list_books().unwrap().is_empty());
    }

    #[test]
    fn saves_and_decodes_igb_blob_on_disk() {
        let dir = std::env::temp_dir().join(format!("ignit-igb-db-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let key = [0x24u8; 32];
        let iv = [0x09u8; 12];
        let doc = BookReadingDocument {
            book_id: "book-7".to_string(),
            pdf_pages: 5,
            ocr_pending: false,
            extractor_version: Some(3),
            refined_by_ai: None,
            chunks: vec![ReadingChunk {
                id: "c-1".to_string(),
                chunk_type: "para".to_string(),
                page: 1,
                offset: 0,
                text: "Guardado en SQLite + blob .igb local.".to_string(),
                mood: "espera".to_string(),
                cues: vec![],
                level: None,
                runs: None,
                ordered: None,
                items: None,
                align: Some("left".to_string()),
            }],
        };

        let encoded = encode_igb1(&doc, "book-7", ContentTier::PrivateUser, Some(&key), Some(&iv)).unwrap();
        save_igb_blob(&dir, "book-7", &encoded).unwrap();
        let raw = read_igb_blob(&dir, "book-7").unwrap();
        let decoded = decode_igb1(&raw, "book-7", ContentTier::PrivateUser, Some(&key)).unwrap();
        assert_eq!(decoded, doc);

        let _ = fs::remove_dir_all(&dir);
    }
}
