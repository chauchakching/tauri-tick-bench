# Phase 1: Minimal Viable Benchmark - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a working WebSocket server and React client that can benchmark message throughput in the browser.

**Architecture:** Node.js server broadcasts simulated market data at configurable rates. React client receives messages, tracks metrics (msg/sec, latency), and displays live stats. Web-only for Phase 1.

**Tech Stack:** Node.js + ws + TypeScript (server), React 18 + Vite + TypeScript (client)

---

## Task 1: Initialize Server Project

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/src/index.ts`

**Step 1: Create server directory and package.json**

```bash
mkdir -p server/src
```

```json
// server/package.json
{
  "name": "tick-bench-server",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "ws": "^8.16.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.10",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
// server/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

**Step 3: Create minimal server entry**

```typescript
// server/src/index.ts
import { WebSocketServer } from 'ws';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server running on ws://localhost:${PORT}`);

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.on('close', () => console.log('Client disconnected'));
});
```

**Step 4: Install dependencies and verify server starts**

```bash
cd server && npm install
npm run dev
```

Expected: Server starts, logs "WebSocket server running on ws://localhost:8080"

**Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): initialize WebSocket server project"
```

---

## Task 2: Add Message Generator

**Files:**
- Create: `server/src/generator.ts`
- Modify: `server/src/index.ts`

**Step 1: Create price generator module**

```typescript
// server/src/generator.ts
export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'];
const prices: Map<string, number> = new Map([
  ['BTC', 50000],
  ['ETH', 3000],
  ['SOL', 100],
  ['DOGE', 0.1],
  ['XRP', 0.5],
]);

export function generateTick(): TickMessage {
  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const currentPrice = prices.get(symbol)!;
  
  // Random walk: -0.1% to +0.1%
  const change = currentPrice * (Math.random() - 0.5) * 0.002;
  const newPrice = Math.max(0.0001, currentPrice + change);
  prices.set(symbol, newPrice);
  
  return {
    symbol,
    price: Number(newPrice.toFixed(6)),
    ts: Date.now(),
  };
}
```

**Step 2: Integrate generator into server**

Replace `server/src/index.ts` with:

```typescript
// server/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { generateTick } from './generator.js';

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

let messagesPerSecond = 100;
let intervalId: ReturnType<typeof setInterval> | null = null;

console.log(`WebSocket server running on ws://localhost:${PORT}`);

function broadcast() {
  const message = JSON.stringify(generateTick());
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function startBroadcast() {
  if (intervalId) return;
  const intervalMs = 1000 / messagesPerSecond;
  intervalId = setInterval(broadcast, intervalMs);
  console.log(`Broadcasting at ${messagesPerSecond} msg/sec`);
}

function stopBroadcast() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  startBroadcast();
  
  ws.on('close', () => {
    console.log('Client disconnected');
    if (wss.clients.size === 0) {
      stopBroadcast();
    }
  });
});
```

**Step 3: Test server broadcasts messages**

```bash
npm run dev
```

In another terminal, test with wscat or browser console:
```bash
npx wscat -c ws://localhost:8080
```

Expected: Receive JSON messages like `{"symbol":"BTC","price":50012.34,"ts":1706745600000}`

**Step 4: Commit**

```bash
git add server/
git commit -m "feat(server): add price tick generator with broadcast"
```

---

## Task 3: Add Rate Configuration

**Files:**
- Create: `server/src/config.ts`
- Modify: `server/src/index.ts`

**Step 1: Create config module with HTTP endpoint**

```typescript
// server/src/config.ts
import { createServer, IncomingMessage, ServerResponse } from 'http';

export interface ServerConfig {
  rate: number;
  rampEnabled: boolean;
  rampPercent: number;
  rampIntervalSec: number;
}

const config: ServerConfig = {
  rate: 100,
  rampEnabled: false,
  rampPercent: 10,
  rampIntervalSec: 5,
};

type ConfigChangeCallback = (config: ServerConfig) => void;
let onConfigChange: ConfigChangeCallback | null = null;

export function setConfigChangeCallback(cb: ConfigChangeCallback) {
  onConfigChange = cb;
}

export function getConfig(): ServerConfig {
  return { ...config };
}

export function startConfigServer(port: number) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/config') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const updates = JSON.parse(body);
            Object.assign(config, updates);
            onConfigChange?.(config);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(config));
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`Config server running on http://localhost:${port}`);
  });
}
```

**Step 2: Integrate config into main server**

Replace `server/src/index.ts` with:

```typescript
// server/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { generateTick } from './generator.js';
import { startConfigServer, setConfigChangeCallback, getConfig, ServerConfig } from './config.js';

const WS_PORT = 8080;
const HTTP_PORT = 8081;

const wss = new WebSocketServer({ port: WS_PORT });

let intervalId: ReturnType<typeof setInterval> | null = null;
let rampIntervalId: ReturnType<typeof setInterval> | null = null;

console.log(`WebSocket server running on ws://localhost:${WS_PORT}`);

function broadcast() {
  const message = JSON.stringify(generateTick());
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function startBroadcast() {
  stopBroadcast();
  const config = getConfig();
  const intervalMs = 1000 / config.rate;
  intervalId = setInterval(broadcast, intervalMs);
  console.log(`Broadcasting at ${config.rate} msg/sec`);

  if (config.rampEnabled) {
    rampIntervalId = setInterval(() => {
      const current = getConfig();
      const newRate = Math.floor(current.rate * (1 + current.rampPercent / 100));
      setConfigChangeCallback(() => {}); // Temporarily disable to avoid recursion
      Object.assign(current, { rate: newRate });
      console.log(`Ramped to ${newRate} msg/sec`);
      restartBroadcast();
    }, config.rampIntervalSec * 1000);
  }
}

function stopBroadcast() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  if (rampIntervalId) {
    clearInterval(rampIntervalId);
    rampIntervalId = null;
  }
}

function restartBroadcast() {
  if (wss.clients.size > 0) {
    startBroadcast();
  }
}

setConfigChangeCallback((config: ServerConfig) => {
  console.log('Config updated:', config);
  restartBroadcast();
});

wss.on('connection', (ws) => {
  console.log('Client connected');
  startBroadcast();
  
  ws.on('close', () => {
    console.log('Client disconnected');
    if (wss.clients.size === 0) {
      stopBroadcast();
    }
  });
});

startConfigServer(HTTP_PORT);
```

**Step 3: Test config endpoint**

```bash
npm run dev
```

In another terminal:
```bash
# Get config
curl http://localhost:8081/config

# Set rate to 500
curl -X POST http://localhost:8081/config -H "Content-Type: application/json" -d '{"rate": 500}'
```

Expected: Config returns JSON, rate updates reflected in broadcast interval.

**Step 4: Commit**

```bash
git add server/
git commit -m "feat(server): add HTTP config endpoint for rate control"
```

---

## Task 4: Initialize React Client

**Files:**
- Create: `client/` (via Vite scaffolding)
- Modify: `client/src/App.tsx`

**Step 1: Create Vite React project**

```bash
cd /Users/ccc/Documents/playground/tauri-tick-bench
npm create vite@latest client -- --template react-ts
cd client
npm install
```

**Step 2: Verify dev server runs**

```bash
npm run dev
```

Expected: Vite dev server starts, shows default React app at http://localhost:5173

**Step 3: Clean up default App.tsx**

Replace `client/src/App.tsx` with:

```tsx
// client/src/App.tsx
function App() {
  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Tick Bench</h1>
      <p>WebSocket throughput benchmark</p>
    </div>
  );
}

export default App;
```

**Step 4: Remove unused files**

```bash
rm client/src/App.css client/src/index.css
```

Update `client/src/main.tsx`:

```tsx
// client/src/main.tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

**Step 5: Commit**

```bash
git add client/
git commit -m "feat(client): initialize React client with Vite"
```

---

## Task 5: Add WebSocket Hook

**Files:**
- Create: `client/src/hooks/useWebSocket.ts`
- Modify: `client/src/App.tsx`

**Step 1: Create WebSocket hook**

```typescript
// client/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';

export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

export interface WebSocketState {
  connected: boolean;
  lastTick: TickMessage | null;
  messageCount: number;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastTick: null,
    messageCount: 0,
  });
  const messageCountRef = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    ws.onmessage = (event) => {
      const tick: TickMessage = JSON.parse(event.data);
      messageCountRef.current++;
      setState((s) => ({
        ...s,
        lastTick: tick,
        messageCount: messageCountRef.current,
      }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [url]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { ...state, connect, disconnect };
}
```

**Step 2: Use hook in App**

Replace `client/src/App.tsx` with:

```tsx
// client/src/App.tsx
import { useWebSocket } from './hooks/useWebSocket';

const WS_URL = 'ws://localhost:8080';

function App() {
  const { connected, lastTick, messageCount, connect, disconnect } = useWebSocket(WS_URL);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Tick Bench</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={connect} disabled={connected}>
          Connect
        </button>
        <button onClick={disconnect} disabled={!connected} style={{ marginLeft: '10px' }}>
          Disconnect
        </button>
        <span style={{ marginLeft: '20px' }}>
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <strong>Messages received:</strong> {messageCount}
      </div>

      {lastTick && (
        <div>
          <strong>Last tick:</strong>
          <pre>{JSON.stringify(lastTick, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
```

**Step 3: Test WebSocket connection**

1. Start server: `cd server && npm run dev`
2. Start client: `cd client && npm run dev`
3. Open http://localhost:5173
4. Click "Connect"

Expected: Status shows connected, message count increases, last tick displays.

**Step 4: Commit**

```bash
git add client/
git commit -m "feat(client): add WebSocket hook with connection UI"
```

---

## Task 6: Add Metrics Collector

**Files:**
- Create: `client/src/metrics/collector.ts`
- Modify: `client/src/hooks/useWebSocket.ts`
- Modify: `client/src/App.tsx`

**Step 1: Create metrics collector**

```typescript
// client/src/metrics/collector.ts
export interface MetricsSnapshot {
  messagesPerSecond: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  totalMessages: number;
  elapsedSeconds: number;
}

export class MetricsCollector {
  private startTime: number = 0;
  private messageTimestamps: number[] = [];
  private latencies: number[] = [];
  private totalMessages: number = 0;
  private lastSecondMessages: number = 0;
  private lastSecondTime: number = 0;

  start() {
    this.startTime = Date.now();
    this.lastSecondTime = this.startTime;
    this.messageTimestamps = [];
    this.latencies = [];
    this.totalMessages = 0;
    this.lastSecondMessages = 0;
  }

  recordMessage(serverTimestamp: number) {
    const now = Date.now();
    this.totalMessages++;
    this.messageTimestamps.push(now);
    this.latencies.push(now - serverTimestamp);

    // Keep only last 1000 latencies for percentile calc
    if (this.latencies.length > 1000) {
      this.latencies = this.latencies.slice(-1000);
    }
  }

  snapshot(): MetricsSnapshot {
    const now = Date.now();
    
    // Calculate messages in last second
    const oneSecondAgo = now - 1000;
    const recentMessages = this.messageTimestamps.filter((t) => t > oneSecondAgo);
    const messagesPerSecond = recentMessages.length;

    // Keep only recent timestamps
    this.messageTimestamps = recentMessages;

    // Calculate latency stats
    const sortedLatencies = [...this.latencies].sort((a, b) => a - b);
    const avgLatencyMs = sortedLatencies.length > 0
      ? sortedLatencies.reduce((a, b) => a + b, 0) / sortedLatencies.length
      : 0;
    const p99Index = Math.floor(sortedLatencies.length * 0.99);
    const p99LatencyMs = sortedLatencies[p99Index] || 0;

    return {
      messagesPerSecond,
      avgLatencyMs: Math.round(avgLatencyMs * 100) / 100,
      p99LatencyMs,
      totalMessages: this.totalMessages,
      elapsedSeconds: Math.floor((now - this.startTime) / 1000),
    };
  }

  reset() {
    this.start();
  }
}
```

**Step 2: Integrate metrics into WebSocket hook**

Replace `client/src/hooks/useWebSocket.ts` with:

```typescript
// client/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { MetricsCollector, MetricsSnapshot } from '../metrics/collector';

export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

export interface WebSocketState {
  connected: boolean;
  lastTick: TickMessage | null;
  metrics: MetricsSnapshot | null;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const metricsRef = useRef<MetricsCollector>(new MetricsCollector());
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastTick: null,
    metrics: null,
  });

  // Update metrics display at 1Hz
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setState((s) => ({
          ...s,
          metrics: metricsRef.current.snapshot(),
        }));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    metricsRef.current.start();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
    };

    ws.onmessage = (event) => {
      const tick: TickMessage = JSON.parse(event.data);
      metricsRef.current.recordMessage(tick.ts);
      setState((s) => ({
        ...s,
        lastTick: tick,
      }));
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [url]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const resetMetrics = useCallback(() => {
    metricsRef.current.reset();
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { ...state, connect, disconnect, resetMetrics };
}
```

**Step 3: Display metrics in App**

Replace `client/src/App.tsx` with:

```tsx
// client/src/App.tsx
import { useWebSocket } from './hooks/useWebSocket';

const WS_URL = 'ws://localhost:8080';

function App() {
  const { connected, lastTick, metrics, connect, disconnect, resetMetrics } = useWebSocket(WS_URL);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Tick Bench</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={connect} disabled={connected}>
          Connect
        </button>
        <button onClick={disconnect} disabled={!connected} style={{ marginLeft: '10px' }}>
          Disconnect
        </button>
        <button onClick={resetMetrics} style={{ marginLeft: '10px' }}>
          Reset Metrics
        </button>
        <span style={{ marginLeft: '20px' }}>
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      {metrics && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px',
          color: '#fff'
        }}>
          <h2 style={{ margin: '0 0 15px 0' }}>Metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Messages/sec</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.messagesPerSecond}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Messages</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.totalMessages.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.avgLatencyMs}ms</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>P99 Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.p99LatencyMs}ms</div>
            </div>
          </div>
          <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
            Running for {metrics.elapsedSeconds}s
          </div>
        </div>
      )}

      {lastTick && (
        <div>
          <strong>Last tick:</strong> {lastTick.symbol} ${lastTick.price.toFixed(4)}
        </div>
      )}
    </div>
  );
}

export default App;
```

**Step 4: Test metrics collection**

1. Start server: `cd server && npm run dev`
2. Start client: `cd client && npm run dev`
3. Open http://localhost:5173
4. Click "Connect"

Expected: Metrics panel shows msg/sec (~100), latency values, total count increasing.

**Step 5: Commit**

```bash
git add client/
git commit -m "feat(client): add metrics collector with live display"
```

---

## Task 7: Add Server Rate Control UI

**Files:**
- Create: `client/src/components/ConfigPanel.tsx`
- Modify: `client/src/App.tsx`

**Step 1: Create config panel component**

```tsx
// client/src/components/ConfigPanel.tsx
import { useState, useEffect } from 'react';

const CONFIG_URL = 'http://localhost:8081/config';

interface ServerConfig {
  rate: number;
  rampEnabled: boolean;
  rampPercent: number;
  rampIntervalSec: number;
}

export function ConfigPanel() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [rateInput, setRateInput] = useState('100');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      const res = await fetch(CONFIG_URL);
      const data = await res.json();
      setConfig(data);
      setRateInput(String(data.rate));
    } catch (e) {
      console.error('Failed to fetch config:', e);
    }
  }

  async function updateRate(newRate: number) {
    setLoading(true);
    try {
      const res = await fetch(CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: newRate }),
      });
      const data = await res.json();
      setConfig(data);
      setRateInput(String(data.rate));
    } catch (e) {
      console.error('Failed to update config:', e);
    }
    setLoading(false);
  }

  const presetRates = [100, 500, 1000, 5000, 10000, 50000];

  return (
    <div style={{ 
      backgroundColor: '#2a2a2a', 
      padding: '20px', 
      borderRadius: '8px',
      marginBottom: '20px',
      color: '#fff'
    }}>
      <h2 style={{ margin: '0 0 15px 0' }}>Server Config</h2>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>
          Messages per second:
        </label>
        <input
          type="number"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          style={{ 
            padding: '8px', 
            marginRight: '10px',
            backgroundColor: '#333',
            border: '1px solid #555',
            color: '#fff',
            borderRadius: '4px'
          }}
        />
        <button 
          onClick={() => updateRate(Number(rateInput))}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#4a9eff',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          {loading ? 'Updating...' : 'Set Rate'}
        </button>
      </div>

      <div>
        <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>
          Presets:
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {presetRates.map((rate) => (
            <button
              key={rate}
              onClick={() => updateRate(rate)}
              disabled={loading}
              style={{
                padding: '6px 12px',
                backgroundColor: config?.rate === rate ? '#4a9eff' : '#444',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              {rate >= 1000 ? `${rate / 1000}k` : rate}
            </button>
          ))}
        </div>
      </div>

      {config && (
        <div style={{ marginTop: '15px', color: '#888', fontSize: '12px' }}>
          Current rate: {config.rate} msg/sec
        </div>
      )}
    </div>
  );
}
```

**Step 2: Add ConfigPanel to App**

Replace `client/src/App.tsx` with:

```tsx
// client/src/App.tsx
import { useWebSocket } from './hooks/useWebSocket';
import { ConfigPanel } from './components/ConfigPanel';

const WS_URL = 'ws://localhost:8080';

function App() {
  const { connected, lastTick, metrics, connect, disconnect, resetMetrics } = useWebSocket(WS_URL);

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'monospace',
      backgroundColor: '#121212',
      minHeight: '100vh',
      color: '#fff'
    }}>
      <h1 style={{ marginBottom: '20px' }}>Tick Bench</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={connect} 
          disabled={connected}
          style={{
            padding: '10px 20px',
            backgroundColor: connected ? '#333' : '#22c55e',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: connected ? 'default' : 'pointer',
            marginRight: '10px'
          }}
        >
          Connect
        </button>
        <button 
          onClick={disconnect} 
          disabled={!connected}
          style={{
            padding: '10px 20px',
            backgroundColor: !connected ? '#333' : '#ef4444',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: !connected ? 'default' : 'pointer',
            marginRight: '10px'
          }}
        >
          Disconnect
        </button>
        <button 
          onClick={resetMetrics}
          style={{
            padding: '10px 20px',
            backgroundColor: '#333',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Reset Metrics
        </button>
        <span style={{ marginLeft: '20px' }}>
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      <ConfigPanel />

      {metrics && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <h2 style={{ margin: '0 0 15px 0' }}>Metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Messages/sec</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.messagesPerSecond}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Messages</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.totalMessages.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.avgLatencyMs}ms</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>P99 Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.p99LatencyMs}ms</div>
            </div>
          </div>
          <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
            Running for {metrics.elapsedSeconds}s
          </div>
        </div>
      )}

      {lastTick && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '15px', 
          borderRadius: '8px'
        }}>
          <strong>Last tick:</strong> {lastTick.symbol} ${lastTick.price.toFixed(4)}
        </div>
      )}
    </div>
  );
}

export default App;
```

**Step 3: Update index.html for dark mode**

Replace `client/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tick Bench</title>
    <style>
      body {
        margin: 0;
        background-color: #121212;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 4: Test full flow**

1. Start server: `cd server && npm run dev`
2. Start client: `cd client && npm run dev`
3. Open http://localhost:5173
4. Click "Connect"
5. Use preset buttons to change rate
6. Watch metrics update

Expected: Rate changes reflected in server logs and client msg/sec metric.

**Step 5: Commit**

```bash
git add client/
git commit -m "feat(client): add server config panel with rate presets"
```

---

## Phase 1 Complete

At this point you have:
- WebSocket server with configurable message rate
- React client with connection controls
- Live metrics display (msg/sec, latency)
- Rate control via HTTP API and UI presets

**Next steps (Phase 2):**
- Wrap client in Tauri
- Compare web vs Tauri JS mode performance
