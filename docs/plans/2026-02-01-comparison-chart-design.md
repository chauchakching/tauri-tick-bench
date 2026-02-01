# Comparison Chart Design

## Goal

Generate a bar chart comparing WebSocket message processing throughput across 4 client modes, with JSON vs Binary format comparison.

## Modes to Compare

1. **browser-headless** - Chromium via Puppeteer
2. **browser-default** - User's default browser (Firefox)
3. **tauri-js** - Tauri with JavaScript WebSocket
4. **tauri-rust** - Tauri with native Rust WebSocket

## Benchmark Configuration

- Server: uWebSockets.js
- Target rate: 1,000,000 msg/sec
- Duration: 10 seconds per test
- Formats: JSON (~50B) and Binary (20B)
- Total runs: 8 (4 modes × 2 formats)

## Deliverables

### 1. Data Collection Script

**File:** `scripts/collect-comparison-data.ts`

```typescript
// Runs benchmarks sequentially:
// 1. browser-headless + json
// 2. browser-headless + binary
// 3. browser-default + json (pauses for user)
// 4. browser-default + binary (pauses for user)
// 5. tauri-js + json
// 6. tauri-js + binary
// 7. tauri-rust + json
// 8. tauri-rust + binary

// Output: results/comparison-YYYY-MM-DD.json
interface ComparisonResults {
  timestamp: string;
  server: 'uws';
  targetRate: number;
  duration: number;
  results: {
    mode: string;
    format: 'json' | 'binary';
    clientRate: number;
    serverRate: number;
    avgLatencyMs: number;
  }[];
}
```

### 2. Chart Generation Script

**File:** `scripts/generate-chart.py`

- Input: JSON results file
- Output: `results/comparison-chart.png`
- Library: matplotlib
- Style: Grouped bar chart, 4 groups × 2 bars
- Colors: Blue (JSON), Orange (Binary)
- Labels: Value on top of each bar

### Chart Layout

```
         WebSocket Message Processing by Client Mode
    
    800k ┤                                    ▓▓▓▓ ████
         │                                    ▓▓▓▓ ████
    600k ┤                                    ▓▓▓▓ ████
         │                                    ▓▓▓▓ ████
    400k ┤                                    ▓▓▓▓ ████
    msg/s│                                    ▓▓▓▓ ████
    200k ┤                                    ▓▓▓▓ ████
         │                                    ▓▓▓▓ ████
     50k ┤  ▓▓▓▓ ████  ▓▓▓▓ ████  ▓▓▓▓ ████  ▓▓▓▓ ████
         └────────────────────────────────────────────
            browser    browser    tauri-js   tauri-rust
            headless   default
           
            ▓▓▓▓ JSON    ████ Binary
```

## Execution

```bash
# Step 1: Collect data (~15-20 min)
npx tsx scripts/collect-comparison-data.ts

# Step 2: Generate chart
python scripts/generate-chart.py results/comparison-2026-02-01.json
```

## Notes

- browser-default requires manual window focus when prompted
- Tauri tests include build time (~1-2 min first run)
- Results may vary based on system load
