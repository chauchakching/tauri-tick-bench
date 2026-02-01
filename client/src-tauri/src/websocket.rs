use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_tungstenite::{connect_async, tungstenite::Message};

// Message from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TickMessage {
    pub symbol: String,
    pub price: f64,
    pub ts: u64,
}

// Metrics emitted to frontend
#[derive(Debug, Clone, Serialize)]
pub struct RustMetrics {
    pub messages_per_sec: u64,
    pub total_messages: u64,
    pub avg_latency_ms: f64,
    pub last_tick: Option<TickMessage>,
}

// Messages sent to the server (camelCase to match JS client format)
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
#[allow(non_snake_case)]
pub enum OutgoingMessage {
    #[serde(rename = "identify")]
    Identify { clientId: String },
    #[serde(rename = "stats")]
    Stats {
        clientId: String,
        messagesPerSec: u64,
        totalMessages: u64,
        avgLatencyMs: f64,
        p99LatencyMs: f64,
    },
}

// Shared state for the WebSocket connection
pub struct WebSocketState {
    pub running: AtomicBool,
    pub total_messages: AtomicU64,
    pub messages_this_second: AtomicU64,
    pub latency_sum_ms: AtomicU64,
    pub latency_count: AtomicU64,
    pub last_tick: Mutex<Option<TickMessage>>,
    pub last_tick_update_counter: AtomicU64,
}

impl WebSocketState {
    pub fn new() -> Self {
        Self {
            running: AtomicBool::new(false),
            total_messages: AtomicU64::new(0),
            messages_this_second: AtomicU64::new(0),
            latency_sum_ms: AtomicU64::new(0),
            latency_count: AtomicU64::new(0),
            last_tick: Mutex::new(None),
            last_tick_update_counter: AtomicU64::new(0),
        }
    }

    pub fn reset(&self) {
        self.total_messages.store(0, Ordering::SeqCst);
        self.messages_this_second.store(0, Ordering::SeqCst);
        self.latency_sum_ms.store(0, Ordering::SeqCst);
        self.latency_count.store(0, Ordering::SeqCst);
        self.last_tick_update_counter.store(0, Ordering::SeqCst);
    }
}

pub async fn connect_websocket(
    app_handle: AppHandle,
    state: Arc<WebSocketState>,
    url: String,
) {
    state.running.store(true, Ordering::SeqCst);
    state.reset();

    log::info!("Rust WebSocket connecting to {}", url);

    let ws_result = connect_async(&url).await;
    
    let (mut write, mut read) = match ws_result {
        Ok((ws_stream, _)) => ws_stream.split(),
        Err(e) => {
            log::error!("WebSocket connection failed: {}", e);
            state.running.store(false, Ordering::SeqCst);
            let _ = app_handle.emit("rust-ws-error", format!("Connection failed: {}", e));
            return;
        }
    };

    log::info!("Rust WebSocket connected!");
    let _ = app_handle.emit("rust-ws-connected", ());

    // Send identify message
    let identify_msg = OutgoingMessage::Identify {
        clientId: "tauri-rust".to_string(),
    };
    if let Ok(json) = serde_json::to_string(&identify_msg) {
        let _ = write.send(Message::Text(json)).await;
    }

    // Wrap write in Arc<Mutex> for sharing with metrics task
    let write = Arc::new(Mutex::new(write));
    let write_clone = write.clone();

    // Spawn metrics emitter (1Hz) - also sends stats to server
    let metrics_state = state.clone();
    let metrics_handle = app_handle.clone();
    let metrics_task = tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(1));
        while metrics_state.running.load(Ordering::SeqCst) {
            interval.tick().await;
            
            let msg_per_sec = metrics_state.messages_this_second.swap(0, Ordering::SeqCst);
            let total = metrics_state.total_messages.load(Ordering::SeqCst);
            
            let latency_sum = metrics_state.latency_sum_ms.swap(0, Ordering::SeqCst);
            let latency_count = metrics_state.latency_count.swap(0, Ordering::SeqCst);
            let avg_latency = if latency_count > 0 {
                latency_sum as f64 / latency_count as f64
            } else {
                0.0
            };

            let last_tick = metrics_state.last_tick.lock().await.clone();

            let metrics = RustMetrics {
                messages_per_sec: msg_per_sec,
                total_messages: total,
                avg_latency_ms: avg_latency,
                last_tick,
            };

            // Emit to frontend
            let _ = metrics_handle.emit("rust-ws-metrics", metrics);

            // Send stats to server
            let stats_msg = OutgoingMessage::Stats {
                clientId: "tauri-rust".to_string(),
                messagesPerSec: msg_per_sec,
                totalMessages: total,
                avgLatencyMs: avg_latency,
                p99LatencyMs: 0.0, // Not tracked in Rust version
            };
            if let Ok(json) = serde_json::to_string(&stats_msg) {
                let mut w = write_clone.lock().await;
                let _ = w.send(Message::Text(json)).await;
            }
        }
    });

    // Read messages - optimized for high throughput
    while state.running.load(Ordering::Relaxed) {
        match read.next().await {
            Some(Ok(msg)) => {
                if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
                    // Count every message
                    let count = state.total_messages.fetch_add(1, Ordering::Relaxed);
                    state.messages_this_second.fetch_add(1, Ordering::Relaxed);
                    
                    // Only parse JSON and update last_tick every 1000 messages to reduce overhead
                    if count % 1000 == 0 {
                        if let Ok(tick) = serde_json::from_str::<TickMessage>(&text) {
                            let now = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap()
                                .as_millis() as u64;
                            
                            let latency = now.saturating_sub(tick.ts);
                            state.latency_sum_ms.fetch_add(latency, Ordering::Relaxed);
                            state.latency_count.fetch_add(1, Ordering::Relaxed);
                            
                            // Update last_tick (only every 1000 messages)
                            if let Ok(mut last) = state.last_tick.try_lock() {
                                *last = Some(tick);
                            }
                        }
                    }
                }
            }
            Some(Err(e)) => {
                log::error!("WebSocket error: {}", e);
                break;
            }
            None => {
                log::info!("WebSocket stream ended");
                break;
            }
        }
    }

    state.running.store(false, Ordering::SeqCst);
    metrics_task.abort();
    let _ = app_handle.emit("rust-ws-disconnected", ());
    log::info!("Rust WebSocket disconnected");
}
