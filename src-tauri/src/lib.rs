// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Phase 2.7 — Notification bridge types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Deserialize)]
pub struct NotificationPayload {
    pub title: String,
    pub body: String,
    /// Optional deep-link target: "channel/<id>" | "dm/<id>" | "notification/<id>"
    pub target: Option<String>,
    /// Whether the notification is silent (no sound).
    pub silent: Option<bool>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_positioner::init())
        .setup(|app| {
            // Setup logging
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Debug)
                        .build(),
                )?;
            }

            // Create system tray
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Show Innowit One", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            window.hide().unwrap();
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click { .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                window.hide().unwrap();
                            } else {
                                window.show().unwrap();
                                window.set_focus().unwrap();
                            }
                        }
                    }
                })
                .build(app)?;

            // Handle window close: hide to tray rather than quit
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        window_clone.hide().unwrap();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            check_server_health,
            get_app_version,
            minimize_to_tray,
            show_window,
            hide_window,
            // Phase 2.7 — notification bridge
            send_native_notification,
            check_notification_permission,
            // Phase 2.7 — deep navigation helper
            navigate_to_channel,
            // Phase 2.7 — connectivity probe for reconnect-after-sleep
            probe_server_connectivity,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}

// ---------------------------------------------------------------------------
// Existing commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Welcome to Innowit One.", name)
}

#[tauri::command]
async fn check_server_health() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    match client.get("http://localhost:3001/health").send().await {
        Ok(response) => {
            if response.status().is_success() {
                match response.json().await {
                    Ok(json) => Ok(json),
                    Err(e) => Err(format!("Failed to parse health response: {}", e)),
                }
            } else {
                Err(format!("Health check failed with status: {}", response.status()))
            }
        }
        Err(e) => Err(format!("Failed to connect to server: {}", e)),
    }
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn minimize_to_tray(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().unwrap();
    }
}

#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().unwrap();
        window.set_focus().unwrap();
    }
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().unwrap();
    }
}

// ---------------------------------------------------------------------------
// Phase 2.7 — Native notification bridge
//
// NOTE: Windows native notifications require the app to be installed (NSIS/MSI).
// In dev mode (tauri dev) the notification API is available but the OS may
// display them without an app icon or not at all depending on Windows version.
// Test with a packaged build: `npm run tauri build`.
//
// The frontend calls: invoke('send_native_notification', { payload: { title, body, target } })
// On click the frontend receives a 'notification-action' event and routes to `target`.
// ---------------------------------------------------------------------------

#[tauri::command]
async fn send_native_notification(
    app: tauri::AppHandle,
    payload: NotificationPayload,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    // Respect silent flag: skip if silent is explicitly true
    if payload.silent.unwrap_or(false) {
        return Ok(());
    }

    app.notification()
        .builder()
        .title(&payload.title)
        .body(&payload.body)
        .show()
        .map_err(|e| format!("Notification error: {}", e))?;

    Ok(())
}

/// Returns "granted" | "denied" | "default" so the frontend can decide
/// whether to show a permission prompt.
#[tauri::command]
async fn check_notification_permission(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_notification::NotificationExt;

    let state = app
        .notification()
        .permission_state()
        .map_err(|e| format!("Permission check error: {}", e))?;

    Ok(format!("{:?}", state).to_lowercase())
}

// ---------------------------------------------------------------------------
// Phase 2.7 — Deep navigation
//
// The frontend emits a custom event on the main window to navigate to a
// specific channel/DM without round-tripping through the OS notification stack.
// This is used by tray-menu deep links and future URL scheme handlers.
// ---------------------------------------------------------------------------

#[tauri::command]
fn navigate_to_channel(app: tauri::AppHandle, target: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window
            .emit("navigate", serde_json::json!({ "target": target }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Phase 2.7 — Connectivity probe for reconnect-after-sleep
//
// The frontend calls this on window focus/resume to determine whether the
// backend is reachable before attempting Socket.IO reconnect.  Returns the
// HTTP status as a u16 or 0 on network error.
// ---------------------------------------------------------------------------

#[tauri::command]
async fn probe_server_connectivity() -> u16 {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .unwrap_or_default();

    match client.get("http://localhost:3001/health").send().await {
        Ok(r) => r.status().as_u16(),
        Err(_) => 0,
    }
}
