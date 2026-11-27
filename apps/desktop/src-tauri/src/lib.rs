pub mod igb1;
pub mod local_db;
mod offline;

use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

pub const DEV_URL: &str = "http://localhost:4321/biblioteca";
pub const PROD_URL: &str = "https://ignit.ignit677.workers.dev/biblioteca";

const MIN_ZOOM: f64 = 0.7;
const MAX_ZOOM: f64 = 1.8;
#[cfg(test)]
const ZOOM_STEP: f64 = 0.1;

struct ZoomState(Mutex<f64>);

/// Resolves the initial URL for the main desktop window.
pub fn resolve_start_url(is_debug: bool, override_url: Option<&str>) -> String {
    if let Some(url) = override_url.filter(|s| !s.trim().is_empty()) {
        return url.trim().to_string();
    }
    if is_debug {
        DEV_URL.to_string()
    } else {
        PROD_URL.to_string()
    }
}

/// Returns true when a URL belongs to Ignit (prod, local dev, or bundled fallback)
/// and should stay inside the desktop WebView rather than opening the OS browser.
pub fn is_in_app_url(url: &url::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" | "data" | "blob" => true,
        "http" | "https" => {
            let Some(host) = url.host_str() else {
                return false;
            };
            if host == "ignit.ignit677.workers.dev" || host == "tauri.localhost" {
                return true;
            }
            if (host == "localhost" || host == "127.0.0.1") && url.port() == Some(4321) {
                return true;
            }
            false
        }
        _ => false,
    }
}

/// Clamps zoom factor updates within `[MIN_ZOOM, MAX_ZOOM]`, resetting to `1.0` when `delta == 0.0`.
fn clamped_zoom(current: f64, delta: f64) -> f64 {
    if delta == 0.0 {
        return 1.0;
    }
    let next = ((current + delta) * 100.0).round() / 100.0;
    next.clamp(MIN_ZOOM, MAX_ZOOM)
}

#[tauri::command]
fn toggle_fullscreen(window: tauri::WebviewWindow) -> Result<bool, String> {
    let is_full = window.is_fullscreen().map_err(|e| e.to_string())?;
    let next = !is_full;
    window.set_fullscreen(next).map_err(|e| e.to_string())?;
    Ok(next)
}

#[tauri::command]
fn adjust_zoom(window: tauri::WebviewWindow, state: State<'_, ZoomState>, delta: f64) -> Result<f64, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let next = clamped_zoom(*guard, delta);
    *guard = next;
    window.set_zoom(next).map_err(|e| e.to_string())?;
    Ok(next)
}

const KEYBOARD_SHORTCUTS_SCRIPT: &str = r#"
(() => {
  if (window.__ignitDesktopShortcutsInstalled) return;
  window.__ignitDesktopShortcutsInstalled = true;
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F11' || (mod && e.shiftKey && e.key.toLowerCase() === 'f')) {
      e.preventDefault();
      window.__TAURI_INTERNALS__?.invoke('toggle_fullscreen');
      return;
    }
    if (e.key === 'F5' || (mod && !e.shiftKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      window.location.reload();
      return;
    }
    if (mod && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      window.__TAURI_INTERNALS__?.invoke('adjust_zoom', { delta: 0.1 });
      return;
    }
    if (mod && e.key === '-') {
      e.preventDefault();
      window.__TAURI_INTERNALS__?.invoke('adjust_zoom', { delta: -0.1 });
      return;
    }
    if (mod && e.key === '0') {
      e.preventDefault();
      window.__TAURI_INTERNALS__?.invoke('adjust_zoom', { delta: 0 });
    }
  });
})();
"#;

fn is_target_reachable(url: &url::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(port) = url.port_or_known_default() else {
        return false;
    };
    let Ok(addrs) = (host, port).to_socket_addrs() else {
        return false;
    };
    let timeout = Duration::from_millis(1200);
    addrs.into_iter().any(|addr| TcpStream::connect_timeout(&addr, timeout).is_ok())
}

#[tauri::command]
fn get_start_url() -> String {
    let override_url = std::env::var("IGNIT_DESKTOP_URL").ok();
    resolve_start_url(cfg!(debug_assertions), override_url.as_deref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ZoomState(Mutex::new(1.0)))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            toggle_fullscreen,
            adjust_zoom,
            get_start_url,
            offline::save_offline_book,
            offline::read_offline_book,
            offline::list_offline_books,
            offline::delete_offline_book,
            local_db::local_db_list_books,
            local_db::local_db_upsert_book,
            local_db::local_db_delete_book,
            local_db::local_db_get_reading_state,
            local_db::local_db_save_reading_state,
            local_db::local_db_save_igb_book,
            local_db::local_db_read_igb_book,
            local_db::local_db_pending_outbox,
            local_db::local_db_get_meta,
            local_db::local_db_set_meta
        ])
        .setup(|app| {
            let override_url = std::env::var("IGNIT_DESKTOP_URL").ok();
            let target = resolve_start_url(cfg!(debug_assertions), override_url.as_deref());
            let start_url = match target.parse::<url::Url>() {
                Ok(parsed) if is_target_reachable(&parsed) => WebviewUrl::External(parsed),
                _ => WebviewUrl::App("index.html".into()),
            };

            let win_cfg = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .expect("main window config must exist in tauri.conf.json");

            let builder = WebviewWindowBuilder::new(app, &win_cfg.label, start_url)
                .title(&win_cfg.title)
                .inner_size(win_cfg.width, win_cfg.height)
                .min_inner_size(
                    win_cfg.min_width.unwrap_or(900.0),
                    win_cfg.min_height.unwrap_or(600.0),
                )
                .resizable(win_cfg.resizable)
                .fullscreen(win_cfg.fullscreen)
                .initialization_script(KEYBOARD_SHORTCUTS_SCRIPT)
                .on_navigation({
                    let handle = app.handle().clone();
                    move |url| {
                        if is_in_app_url(url) {
                            true
                        } else {
                            let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                            false
                        }
                    }
                })
                .on_new_window({
                    let handle = app.handle().clone();
                    move |url, _features| {
                        if !is_in_app_url(&url) {
                            let _ = handle.opener().open_url(url.as_str(), None::<&str>);
                        }
                        tauri::webview::NewWindowResponse::Deny
                    }
                });

            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_dev_and_prod_start_urls() {
        assert_eq!(resolve_start_url(true, None), DEV_URL);
        assert_eq!(resolve_start_url(false, None), PROD_URL);
        assert_eq!(
            resolve_start_url(false, Some("  http://localhost:4321/lecturas/1  ")),
            "http://localhost:4321/lecturas/1"
        );
        assert_eq!(resolve_start_url(true, Some("   ")), DEV_URL);
    }

    #[test]
    fn classifies_in_app_vs_external_urls() {
        assert!(is_in_app_url(&url::Url::parse("https://ignit.ignit677.workers.dev/biblioteca").unwrap()));
        assert!(is_in_app_url(&url::Url::parse("http://localhost:4321/lecturas/42").unwrap()));
        assert!(is_in_app_url(&url::Url::parse("http://127.0.0.1:4321/login").unwrap()));
        assert!(is_in_app_url(&url::Url::parse("tauri://localhost/index.html").unwrap()));

        assert!(!is_in_app_url(&url::Url::parse("https://github.com/Santidele22/ignit").unwrap()));
        assert!(!is_in_app_url(&url::Url::parse("http://localhost:3000/").unwrap()));
    }

    #[test]
    fn clamps_zoom_within_bounds_and_resets_on_zero() {
        assert_eq!(clamped_zoom(1.0, ZOOM_STEP), 1.1);
        assert_eq!(clamped_zoom(1.8, ZOOM_STEP), MAX_ZOOM);
        assert_eq!(clamped_zoom(0.7, -ZOOM_STEP), MIN_ZOOM);
        assert_eq!(clamped_zoom(1.4, 0.0), 1.0);
    }
}
