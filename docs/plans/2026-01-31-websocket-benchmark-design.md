# WebSocket Throughput Benchmark: Web vs Tauri

## Goal

Determine if Tauri can handle more WebSocket messages than a pure web app before becoming unresponsive.

## Test Variants

1. **Web App** - React app in browser, WebSocket in JavaScript
2. **Tauri JS Mode** - Same React app in Tauri webview, WebSocket in JavaScript
3. **Tauri Rust Mode** - React UI in Tauri, WebSocket handled by Rust backend

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    WebSocket Server (Node.js)                   │
│  - Configurable message rate (1/sec → 100k/sec ramp)            │
│  - Configurable message format (JSON, binary)                   │
│  - Broadcasts identical data to connected clients               │
└──────────────────────────┬──────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
   ┌─────────┐       ┌──────────┐      ┌──────────────┐
   │ Browser │       │ Tauri JS │      │ Tauri Rust   │
   │  (React)│       │  (React) │      │  (React +    │
   │   + WS  │       │   + WS   │      │   Rust WS)   │
   └─────────┘       └──────────┘      └──────────────┘
```

## WebSocket Server

### Responsibilities

- **Rate control** - Configurable messages/second, from 1 to 100k+
- **Ramp mode** - Gradually increase rate to find breaking point
- **Message formats**:
  - Simple: `{symbol: "BTC", price: 50000.00, ts: 1706745600000}`
  - Realistic: `{symbol, price, volume, bid, ask, open, high, low, ts}`
  - Binary: MessagePack for lower overhead

### API

```
ws://localhost:8080              # Data feed
http://localhost:8080/config     # GET/POST rate, format, ramp settings
http://localhost:8080/stats      # Current server metrics
```

### Ramp Behavior

- Start at N messages/sec
- Increase by X% every Y seconds
- Continue until client disconnects or manual stop
- Log the rate at which client disconnected

## Client Architecture

### Project Structure

```
src/
├── App.tsx                 # Main app, mode detection
├── hooks/
│   ├── useWebSocket.ts     # JS WebSocket hook (web + Tauri JS mode)
│   └── useTauriSocket.ts   # Tauri command bridge (Rust mode)
├── components/
│   ├── TickerView.tsx      # Simple text display (phase 1)
│   ├── DataTable.tsx       # Live updating table (phase 2)
│   └── MetricsPanel.tsx    # Real-time performance stats
├── metrics/
│   ├── collector.ts        # Gathers performance data
│   └── reporter.ts         # Exports results to file/console
└── config.ts               # Server URL, mode flags
```

### Message Handling Strategy

1. **Receive** - WebSocket onmessage fires
2. **Parse** - JSON.parse or binary decode
3. **Store** - Update state (latest prices per symbol)
4. **Throttle UI** - Render at 60fps max, batch updates

Key insight: Decouple message ingestion from rendering. The test measures how many messages can be *processed* per second, not displayed.

### Tauri Rust Mode

- Rust backend receives WebSocket, parses, stores
- Emits batched updates to frontend via Tauri events
- Frontend only receives pre-throttled data

## Metrics Collection

| Metric | How | Tool |
|--------|-----|------|
| Messages/sec processed | Counter in message handler | Custom JS |
| CPU usage | Process monitoring | `window.performance` + external |
| Memory (JS heap) | `performance.memory` | Chrome DevTools / Tauri |
| Message latency | `Date.now() - msg.timestamp` | Custom JS |
| Frame rate | `requestAnimationFrame` timing | Custom JS |
| UI responsiveness | Input lag measurement | Custom JS |

### Breakpoint Detection

- FPS drops below 30 sustained
- Message backlog grows (processed < received)
- Latency exceeds 500ms

## Benchmark Workflow

```
1. Start WebSocket server
2. Configure: rate=100/sec, ramp=+10%/5sec, format=json
3. Launch client (web OR Tauri-JS OR Tauri-Rust)
4. Client connects, receives data, collects metrics
5. Server ramps rate every 5 seconds
6. Continue until breakpoint detected or manual stop
7. Export metrics to results/<client-type>-<timestamp>.json
8. Repeat for other client types
```

### Test Scenarios

| Scenario | Purpose |
|----------|---------|
| Ramp test (JSON) | Find ceiling for each client |
| Ramp test (binary) | Test with lower parsing overhead |
| Fixed 10k/sec for 60s | Sustained load comparison |
| Fixed 50k/sec for 60s | High sustained load |
| Multi-symbol (100 symbols) | More realistic data variety |

Run each scenario 3x per client type for consistency.

## Project Structure

```
tauri-tick-bench/
├── server/                    # Node.js WebSocket server
│   ├── package.json
│   ├── src/
│   │   ├── index.ts           # Server entry
│   │   ├── generator.ts       # Price data generator
│   │   └── config.ts          # Rate, format settings
│   └── tsconfig.json
│
├── client/                    # React app (web + Tauri)
│   ├── package.json
│   ├── src/                   # React source
│   ├── src-tauri/             # Tauri Rust backend
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── main.rs
│   │   │   └── websocket.rs   # Rust WebSocket handler
│   │   └── tauri.conf.json
│   ├── index.html
│   └── vite.config.ts
│
├── results/                   # Benchmark output JSON/CSV
├── scripts/
│   └── compare.js             # Generate comparison report
└── README.md
```

## Tech Stack

| Component | Tech |
|-----------|------|
| Server | Node.js, `ws`, TypeScript |
| Client | React 18, Vite, TypeScript |
| Tauri | Tauri 2.x, Rust |
| Rust WS | `tokio-tungstenite` |
| Binary format | MessagePack (`@msgpack/msgpack`, `rmp-serde`) |

## Implementation Phases

### Phase 1: Minimal viable benchmark
- WebSocket server with fixed rate, JSON only
- React app with simple ticker display
- Basic metrics (msg/sec, latency)
- Web-only (no Tauri yet)

### Phase 2: Add Tauri JS mode
- Wrap same React app in Tauri
- Run same test, compare web vs Tauri-JS
- First real comparison data

### Phase 3: Add Tauri Rust mode
- Implement Rust WebSocket handler
- Tauri event bridge to frontend
- Three-way comparison

### Phase 4: Full benchmark suite
- Ramp testing
- Binary message format
- Multiple test scenarios
- Results export and comparison tooling

### Phase 5: Polish (optional)
- Data table UI
- Charts for results visualization
- Automated benchmark runner script
