# Tick Bench: WebSocket Performance Report

**Date:** 2026-02-01  
**Machine:** macOS (Apple Silicon)  
**Test Duration:** 10 seconds per test

## Summary

This benchmark compares real-time WebSocket throughput across three client configurations:

| Mode | Description |
|------|-------------|
| **browser-js** | Chrome/Safari with JavaScript WebSocket |
| **tauri-js** | Tauri app with JavaScript WebSocket (WKWebView) |
| **tauri-rust** | Tauri app with Rust WebSocket (native) |

## Results

### At 100,000 msg/sec server rate

| Mode | Throughput | Avg Latency | P99 Latency |
|------|------------|-------------|-------------|
| browser-js | 81,977/s | 4.0ms | 6.0ms |
| tauri-js | 24,387/s | 9,467ms | 9,478ms |
| tauri-rust | 88,000/s | 0.2ms | 0.0ms |

### At 500,000 msg/sec server rate

| Mode | Throughput | Avg Latency | P99 Latency |
|------|------------|-------------|-------------|
| browser-js | 57,688/s | 3,878ms | 3,883ms |
| tauri-js | 23,841/s | 11,782ms | 11,801ms |
| tauri-rust | 183,914/s | 0.0ms | 0.0ms |

## Analysis

### Browser JS (Chrome/Safari)
- **Peak throughput:** ~80,000 msg/sec
- **Behavior:** Scales well up to its limit, then starts dropping messages
- Chrome's V8 engine is highly optimized for this workload

### Tauri JS (WKWebView)
- **Peak throughput:** ~24,000 msg/sec (hard ceiling)
- **Behavior:** Consistently limited regardless of server rate
- **Bottleneck:** WKWebView's JavaScript engine (JavaScriptCore) is 3-4x slower than V8
- High latency indicates severe message queue buildup

### Tauri Rust (Native WebSocket)
- **Peak throughput:** 180,000+ msg/sec (still scaling)
- **Behavior:** Excellent performance, near-zero latency
- Bypasses WKWebView entirely for message processing
- Only sends aggregated metrics to the UI (1Hz)

## Performance Comparison

```
                    Relative Performance (higher = better)
                    
browser-js    ████████████████████████████████░░░░░░░░  ~80k/s
tauri-js      ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  ~24k/s  
tauri-rust    ████████████████████████████████████████████████████████████████████████  ~184k/s
```

## Key Findings

1. **WKWebView is the bottleneck** - Tauri's embedded webview (WKWebView on macOS) has a hard limit of ~24k msg/sec for JS-based WebSocket handling.

2. **Rust WebSocket is 7.7x faster than Tauri JS** - By handling WebSocket in Rust and only sending aggregated data to the UI, performance improves dramatically.

3. **Rust WebSocket beats browser by 2-3x** - At high loads, native Rust outperforms even Chrome's optimized V8.

4. **Latency tells the story** - The 11+ second latency in tauri-js shows messages backing up, while tauri-rust maintains near-zero latency.

## Recommendations

| Use Case | Recommendation |
|----------|----------------|
| < 10,000 msg/sec | JS-only is fine in Tauri |
| 10,000 - 50,000 msg/sec | Consider Rust WebSocket |
| > 50,000 msg/sec | Rust WebSocket is essential |
| Real-time trading data | Always use Rust WebSocket |

## Architecture Comparison

### JS WebSocket (Simple)
```
Server → WebSocket → WKWebView JS → React State → UI
         (every message parsed in JS)
```

### Rust WebSocket (High Performance)
```
Server → WebSocket → Rust (parse & aggregate) → Tauri Event → React State → UI
         (only aggregated metrics sent to UI at 1Hz)
```

## Reproducing These Results

```bash
# Run the benchmark
cd /path/to/tauri-tick-bench
npm run benchmark

# Results saved to results/ folder
```

## Files

- `results/*.json` - Raw benchmark data
- `scripts/run-benchmark.ts` - Automated test runner
- `client/src-tauri/src/websocket.rs` - Rust WebSocket implementation
