# Tauri Tick Bench

A WebSocket performance benchmark comparing message throughput across different client configurations:

- **browser-js** - Standard browser with JavaScript WebSocket
- **tauri-js** - Tauri app with JavaScript WebSocket (WKWebView)
- **tauri-rust** - Tauri app with native Rust WebSocket

## Prerequisites

- **Node.js** 18+ and npm
- **Rust** (via [rustup](https://rustup.rs/))
- **Tauri CLI** dependencies (see [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites))
- **macOS** (benchmark script uses macOS-specific commands)

## Installation

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd tauri-tick-bench
   ```

2. Install root dependencies:
   ```bash
   npm install
   ```

3. Install server dependencies:
   ```bash
   cd server && npm install && cd ..
   ```

4. Install client dependencies:
   ```bash
   cd client && npm install && cd ..
   ```

## Running the Benchmark

### Automated Benchmark

Run the full benchmark suite comparing all three client modes:

```bash
npm run benchmark
```

This will:
1. Start the WebSocket server
2. Test browser-js (opens default browser)
3. Test tauri-js (builds and runs Tauri app with JS WebSocket)
4. Test tauri-rust (builds and runs Tauri app with Rust WebSocket)
5. Print results and save to `results/` folder

**Note:** The automated benchmark takes several minutes as it builds Tauri twice and runs 10-second tests for each mode.

### Manual Testing

#### 1. Start the Server

```bash
cd server
npm run dev
```

The server runs on:
- WebSocket: `ws://localhost:8080`
- HTTP API: `http://localhost:8081`

#### 2. Start the Client

**Browser (JS WebSocket):**
```bash
cd client
npm run dev
```
Open http://localhost:5173 in your browser.

**Tauri App (JS WebSocket):**
```bash
cd client
TICK_BENCH_MODE=js npm run tauri:dev
```

**Tauri App (Rust WebSocket):**
```bash
cd client
TICK_BENCH_MODE=rust npm run tauri:dev
```

## Configuration

### Server Configuration

The server exposes an HTTP API to adjust settings during runtime:

```bash
# Set message rate (messages per second)
curl -X POST http://localhost:8081/config \
  -H "Content-Type: application/json" \
  -d '{"rate": 100000}'

# Get current configuration
curl http://localhost:8081/config

# Get client stats
curl http://localhost:8081/stats

# Clear stats
curl -X DELETE http://localhost:8081/stats
```

### Benchmark Script Configuration

Edit `scripts/run-benchmark.ts` to adjust:

```typescript
const CONFIG = {
  testDurationMs: 10_000,      // Test duration per mode
  stabilizationMs: 2_000,      // Wait time before measuring
  serverWsPort: 8080,          // WebSocket port
  serverHttpPort: 8081,        // HTTP API port
  clientDevPort: 5173,         // Vite dev server port
  messageRate: 500_000,        // Target messages per second
};
```

## Understanding Results

The benchmark measures:

| Metric | Description |
|--------|-------------|
| **Msg/sec** | Actual messages processed per second |
| **Avg Latency** | Average time from server send to client receive |
| **P99 Latency** | 99th percentile latency |

### Sample Results

At 500,000 msg/sec server rate:

| Mode | Throughput | Avg Latency | P99 Latency |
|------|------------|-------------|-------------|
| browser-js | ~58k/s | 3,878ms | 3,883ms |
| tauri-js | ~24k/s | 11,782ms | 11,801ms |
| tauri-rust | ~184k/s | 0.0ms | 0.0ms |

See [BENCHMARK_REPORT.md](./BENCHMARK_REPORT.md) for detailed analysis.

## Project Structure

```
tauri-tick-bench/
├── client/                 # Tauri + React frontend
│   ├── src/
│   │   ├── App.tsx         # Main UI component
│   │   └── hooks/
│   │       ├── useWebSocket.ts      # JS WebSocket hook
│   │       └── useRustWebSocket.ts  # Rust WebSocket hook
│   └── src-tauri/
│       └── src/
│           ├── lib.rs      # Tauri commands
│           └── websocket.rs # Rust WebSocket implementation
├── server/                 # WebSocket server
│   └── src/
│       ├── index.ts        # Main server
│       ├── config.ts       # Server configuration
│       └── generator.ts    # Message generator
├── scripts/
│   └── run-benchmark.ts    # Automated benchmark runner
└── results/                # Benchmark output (JSON)
```

## Troubleshooting

### Tauri build fails
Ensure Rust is installed and up to date:
```bash
rustup update
```

### Port already in use
Kill processes on the required ports:
```bash
lsof -ti :8080 | xargs kill -9
lsof -ti :8081 | xargs kill -9
lsof -ti :5173 | xargs kill -9
```

### Browser test doesn't work
The benchmark uses `open` command to open the browser. Ensure your default browser is set correctly.

### Tauri app closes too quickly
In manual mode, the app should stay open. In benchmark mode, it's intentionally closed after collecting stats.
