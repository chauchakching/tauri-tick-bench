# Tauri Tick Bench

A WebSocket performance benchmark comparing message throughput across different client configurations:

- **browser-js** - Standard browser with JavaScript WebSocket
- **tauri-js** - Tauri app with JavaScript WebSocket (WKWebView)
- **tauri-rust** - Tauri app with native Rust WebSocket

## Sample Results

At 500,000 msg/sec target rate:

| Mode | Client | Server | Efficiency | Avg Lat | P99 Lat |
|------|--------|--------|------------|---------|---------|
| browser-js | 58k/s | 186k/s | 31% | 3,878ms | 3,883ms |
| tauri-js | 24k/s | 186k/s | 13% | 11,782ms | 11,801ms |
| tauri-rust | 186k/s | 186k/s | 100% | 0.0ms | 0.0ms |

**Efficiency** = client rate / server rate. 100% means the client keeps up with everything the server sends.

See [BENCHMARK_REPORT.md](./BENCHMARK_REPORT.md) for detailed analysis.

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

Or run specific modes with options:

```bash
# Test only tauri-rust at 500k target rate for 15 seconds
npm run benchmark -- --mode tauri-rust --rate 500000 --duration 15

# Test only browser
npm run benchmark -- -m browser -r 100000

# Test both tauri modes
npm run benchmark -- -m tauri
```

**CLI Options:**

| Option | Description |
|--------|-------------|
| `-m, --mode <mode>` | `browser-js`, `tauri-js`, `tauri-rust`, `browser`, `tauri`, or `all` |
| `-r, --rate <n>` | Target message rate per second (default: 500000) |
| `-d, --duration <s>` | Test duration in seconds (default: 10) |

The script will:
1. Start the WebSocket server
2. Run requested test mode(s)
3. Track both server actual rate and client throughput
4. Calculate efficiency (client / server)
5. Save results to `results/` folder

**Note:** Tauri tests take longer on first run due to Rust compilation.

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

**Note on server throughput:** The `messageRate` is a *target*, not a guarantee. The Node.js server realistically achieves ~150-200k msg/sec due to single-threaded execution and `setInterval` timer resolution limits (~4ms minimum). The server logs its actual send rate during tests.

## Understanding Results

The benchmark measures:

| Metric | Description |
|--------|-------------|
| **Msg/sec** | Actual messages processed per second |
| **Avg Latency** | Average time from server send to client receive |
| **P99 Latency** | 99th percentile latency |

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
