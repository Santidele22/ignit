use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const MAX_BOOK_ID_LEN: usize = 128;

/// Validates `book_id` to prevent path traversal and invalid filenames.
pub fn validate_book_id(book_id: &str) -> Result<&str, String> {
    if book_id.is_empty() || book_id.len() > MAX_BOOK_ID_LEN {
        return Err("book_id must be between 1 and 128 characters".to_string());
    }
    if book_id == "." || book_id == ".." {
        return Err("book_id cannot be '.' or '..'".to_string());
    }
    if !book_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("book_id contains invalid characters".to_string());
    }
    Ok(book_id)
}

fn books_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(base.join("books"))
}

fn book_file_path(dir: &Path, book_id: &str) -> Result<PathBuf, String> {
    let valid_id = validate_book_id(book_id)?;
    Ok(dir.join(format!("{valid_id}.json")))
}

pub fn save_book_in_dir(dir: &Path, book_id: &str, payload: &str) -> Result<(), String> {
    let path = book_file_path(dir, book_id)?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    fs::write(path, payload).map_err(|e| e.to_string())
}

pub fn read_book_in_dir(dir: &Path, book_id: &str) -> Result<String, String> {
    let path = book_file_path(dir, book_id)?;
    fs::read_to_string(path).map_err(|e| e.to_string())
}

pub fn list_books_in_dir(dir: &Path) -> Result<Vec<String>, String> {
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut ids = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if validate_book_id(stem).is_ok() {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    ids.sort();
    Ok(ids)
}

pub fn delete_book_in_dir(dir: &Path, book_id: &str) -> Result<bool, String> {
    let path = book_file_path(dir, book_id)?;
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn save_offline_book(
    app: tauri::AppHandle,
    book_id: String,
    payload: String,
) -> Result<(), String> {
    let dir = books_dir(&app)?;
    save_book_in_dir(&dir, &book_id, &payload)
}

#[tauri::command]
pub fn read_offline_book(app: tauri::AppHandle, book_id: String) -> Result<String, String> {
    let dir = books_dir(&app)?;
    read_book_in_dir(&dir, &book_id)
}

#[tauri::command]
pub fn list_offline_books(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = books_dir(&app)?;
    list_books_in_dir(&dir)
}

#[tauri::command]
pub fn delete_offline_book(app: tauri::AppHandle, book_id: String) -> Result<bool, String> {
    let dir = books_dir(&app)?;
    delete_book_in_dir(&dir, &book_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_books_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ignit-desktop-test-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn rejects_path_traversal_and_invalid_book_ids() {
        for bad in [
            "",
            ".",
            "..",
            "../secret",
            "..\\secret",
            "a/b",
            "a\\b",
            "book.json",
            "book\0id",
            "book id",
        ] {
            assert!(
                validate_book_id(bad).is_err(),
                "expected '{bad}' to be rejected"
            );
        }
        assert!(validate_book_id("tomo-01_es").is_ok());
    }

    #[test]
    fn roundtrips_save_read_list_and_delete_book() {
        let dir = temp_books_dir("roundtrip");
        assert_eq!(list_books_in_dir(&dir).unwrap(), Vec::<String>::new());

        let payload = r#"{"id":"book-1","title":"Demo"}"#;
        save_book_in_dir(&dir, "book-1", payload).unwrap();
        save_book_in_dir(&dir, "book-2", "{}").unwrap();

        assert_eq!(
            list_books_in_dir(&dir).unwrap(),
            vec!["book-1".to_string(), "book-2".to_string()]
        );
        assert_eq!(read_book_in_dir(&dir, "book-1").unwrap(), payload);

        assert!(delete_book_in_dir(&dir, "book-1").unwrap());
        assert!(!delete_book_in_dir(&dir, "book-1").unwrap());
        assert_eq!(
            list_books_in_dir(&dir).unwrap(),
            vec!["book-2".to_string()]
        );

        let _ = fs::remove_dir_all(&dir);
    }
}
