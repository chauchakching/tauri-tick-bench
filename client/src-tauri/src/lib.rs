mod websocket;

use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::State;
use tokio::sync::Mutex;
use websocket::WebSocketState;

// Wrapper for managing the WebSocket task
struct WsTaskHandle(Mutex<Option<tokio::task::JoinHandle<()>>>);

#[tauri::command]
async fn connect_rust_ws(
    app_handle: tauri::AppHandle,
    state: State<'_, Arc<WebSocketState>>,
    task_handle: State<'_, WsTaskHandle>,
    url: String,
) -> Result<(), String> {
    // Check if already running
    if state.running.load(Ordering::SeqCst) {
        return Err("Already connected".to_string());
    }

    let state_clone = state.inner().clone();
    let handle = tokio::spawn(async move {
        websocket::connect_websocket(app_handle, state_clone, url).await;
    });

    *task_handle.0.lock().await = Some(handle);
    Ok(())
}

#[tauri::command]
async fn disconnect_rust_ws(
    state: State<'_, Arc<WebSocketState>>,
    task_handle: State<'_, WsTaskHandle>,
) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);
    
    if let Some(handle) = task_handle.0.lock().await.take() {
        handle.abort();
    }
    
    Ok(())
}

#[tauri::command]
fn reset_rust_metrics(state: State<'_, Arc<WebSocketState>>) {
    state.reset();
}

#[tauri::command]
fn is_rust_ws_connected(state: State<'_, Arc<WebSocketState>>) -> bool {
    state.running.load(Ordering::SeqCst)
}

// Get test mode from environment variable (for automated testing)
#[tauri::command]
fn get_test_mode() -> String {
    std::env::var("TICK_BENCH_MODE").unwrap_or_else(|_| "js".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let ws_state = Arc::new(WebSocketState::new());
    let task_handle = WsTaskHandle(Mutex::new(None));

    tauri::Builder::default()
        .manage(ws_state)
        .manage(task_handle)
        .invoke_handler(tauri::generate_handler![
            connect_rust_ws,
            disconnect_rust_ws,
            reset_rust_metrics,
            is_rust_ws_connected,
            get_test_mode,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
