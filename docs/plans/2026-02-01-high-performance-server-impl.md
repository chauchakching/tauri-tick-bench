# High-Performance Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Maximize server throughput to find tauri-rust client's true ceiling

**Architecture:** Two-phase approach - first optimize the existing `ws` library with tight loops and pre-serialization, then optionally switch to uWebSockets.js if Phase 1 hits a ceiling.

**Tech Stack:** Node.js, TypeScript, ws library, uWebSockets.js (Phase 2)

---

## Task 1: Refactor Server into Modular Structure

**Files:**

- Create: `server/src/ws-server.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/config.ts`

**Step 1: Extract server logic to ws-server.ts**

Create `server/src/ws-server.ts` with the current server implementation (copy from index.ts):

```typescript
// server/src/ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { generateTick } from './generator.js';
import { setConfigChangeCallback, setStatsCallbacks, getConfig, updateConfig, ServerConfig } from './config.js';

export function startWsServer(wsPort: number, httpPort: number) {
  const wss = new WebSocketServer({ port: wsPort });

  let intervalId: ReturnType<typeof setInterval> | null = null;
  let rampIntervalId: ReturnType<typeof setInterval> | null = null;
  let telemetryIntervalId: ReturnType<typeof setInterval> | null = null;

  let messagesSentThisSecond = 0;
  let lastTelemetryTime = Date.now();
  let lastActualRate = 0;

  interface ClientStats {
    clientId: string;
    lastUpdate: number;
    messagesPerSec: number;
    totalMessages: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
  }

  const clientStats: Map<string, ClientStats> = new Map();
  const clientIdBySocket: Map<WebSocket, string> = new Map();

  console.log(`WebSocket server running on ws://localhost:${wsPort}`);

  function broadcast() {
    const message = JSON.stringify(generateTick());
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        messagesSentThisSecond++;
      }
    });
  }

  function broadcastBatch(messagesPerTick: number) {
    for (let i = 0; i < messagesPerTick; i++) {
      const message = JSON.stringify(generateTick());
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          messagesSentThisSecond++;
        }
      });
    }
  }

  function startTelemetry() {
    if (telemetryIntervalId) return;
    telemetryIntervalId = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTelemetryTime) / 1000;
      const actualRate = Math.round(messagesSentThisSecond / elapsed);
      lastActualRate = actualRate;
      const targetRate = getConfig().rate;
      
      let output = `[Stats] Rate: ${targetRate.toLocaleString()}/s | Server actual: ${actualRate.toLocaleString()}/s\n`;
      
      const clientTypes = ['browser-js', 'tauri-js', 'tauri-rust'];
      for (const clientId of clientTypes) {
        const stats = clientStats.get(clientId);
        if (stats && (now - stats.lastUpdate) < 5000) {
          output += `        ${clientId.padEnd(12)}: ${stats.messagesPerSec.toLocaleString().padStart(8)} msg/s, lat: ${stats.avgLatencyMs.toFixed(1)}ms avg`;
          if (stats.p99LatencyMs > 0) {
            output += ` / ${stats.p99LatencyMs.toFixed(1)}ms p99`;
          }
          output += '\n';
        } else {
          output += `        ${clientId.padEnd(12)}: (not connected)\n`;
        }
      }
      
      console.log(output.trimEnd());
      messagesSentThisSecond = 0;
      lastTelemetryTime = now;
    }, 1000);
  }

  function stopTelemetry() {
    if (telemetryIntervalId) {
      clearInterval(telemetryIntervalId);
      telemetryIntervalId = null;
    }
  }

  function startBroadcast() {
    stopBroadcast();
    const config = getConfig();
    
    const MAX_TICKS_PER_SEC = 1000;
    
    if (config.rate <= MAX_TICKS_PER_SEC) {
      const intervalMs = 1000 / config.rate;
      intervalId = setInterval(broadcast, intervalMs);
    } else {
      const messagesPerTick = Math.ceil(config.rate / MAX_TICKS_PER_SEC);
      intervalId = setInterval(() => broadcastBatch(messagesPerTick), 1);
    }
    
    console.log(`Broadcasting at ${config.rate} msg/sec`);
    startTelemetry();

    if (config.rampEnabled) {
      rampIntervalId = setInterval(() => {
        const current = getConfig();
        const newRate = Math.floor(current.rate * (1 + current.rampPercent / 100));
        updateConfig({ rate: newRate });
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
    stopTelemetry();
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

  interface IdentifyMessage {
    type: 'identify';
    clientId: string;
  }

  interface StatsMessage {
    type: 'stats';
    clientId: string;
    messagesPerSec: number;
    totalMessages: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
  }

  type ClientMessage = IdentifyMessage | StatsMessage;

  function handleClientMessage(ws: WebSocket, data: string) {
    try {
      const msg: ClientMessage = JSON.parse(data);
      
      if (msg.type === 'identify') {
        clientIdBySocket.set(ws, msg.clientId);
        console.log(`Client identified as: ${msg.clientId}`);
      } else if (msg.type === 'stats') {
        clientStats.set(msg.clientId, {
          clientId: msg.clientId,
          lastUpdate: Date.now(),
          messagesPerSec: msg.messagesPerSec,
          totalMessages: msg.totalMessages,
          avgLatencyMs: msg.avgLatencyMs,
          p99LatencyMs: msg.p99LatencyMs,
        });
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  wss.on('connection', (ws) => {
    console.log('Client connected');
    startBroadcast();
    
    ws.on('message', (data) => {
      handleClientMessage(ws, data.toString());
    });
    
    ws.on('close', () => {
      const clientId = clientIdBySocket.get(ws);
      if (clientId) {
        console.log(`Client disconnected: ${clientId}`);
        clientIdBySocket.delete(ws);
      } else {
        console.log('Client disconnected');
      }
      if (wss.clients.size === 0) {
        stopBroadcast();
      }
    });
  });

  setStatsCallbacks(
    () => ({ 
      clients: Object.fromEntries(clientStats),
      actualRate: lastActualRate,
      targetRate: getConfig().rate,
    }),
    () => clientStats.clear()
  );
}
```

**Step 2: Update index.ts to use the module**

Replace `server/src/index.ts`:

```typescript
// server/src/index.ts
import { startConfigServer } from './config.js';
import { startWsServer } from './ws-server.js';

const WS_PORT = 8080;
const HTTP_PORT = 8081;

startConfigServer(HTTP_PORT);
startWsServer(WS_PORT, HTTP_PORT);
```

**Step 3: Verify server still works**

Run: `cd server && npm run dev`
Expected: Server starts, can connect with client

**Step 4: Commit**

```bash
git add server/src/ws-server.ts server/src/index.ts
git commit -m "refactor: extract ws server to separate module"
```

---

## Task 2: Add High-Frequency Broadcast Mode

**Files:**

- Modify: `server/src/ws-server.ts`

**Step 1: Add pre-serialized message caching**

Add at the top of `startWsServer` function, after the variable declarations:

```typescript
  // Pre-serialized message cache
  let cachedMessage: Buffer | null = null;
  let cachedTimestamp = 0;

  function getSerializedTick(): Buffer {
    const now = Date.now();
    // Regenerate every 1ms to keep timestamps fresh
    if (!cachedMessage || now - cachedTimestamp >= 1) {
      cachedMessage = Buffer.from(JSON.stringify(generateTick()));
      cachedTimestamp = now;
    }
    return cachedMessage;
  }
```

**Step 2: Add high-frequency broadcast function**

Add after `broadcastBatch`:

```typescript
  // High-frequency mode state
  let highFreqRunning = false;

  function broadcastBuffer(message: Buffer) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
        messagesSentThisSecond++;
      }
    });
  }

  function startHighFrequencyBroadcast(targetRate: number) {
    const nsPerMessage = 1_000_000_000 / targetRate;
    let lastSendTime = process.hrtime.bigint();
    highFreqRunning = true;

    function tick() {
      if (!highFreqRunning) return;
      
      const now = process.hrtime.bigint();
      const elapsed = Number(now - lastSendTime);
      const messagesToSend = Math.floor(elapsed / nsPerMessage);
      
      if (messagesToSend > 0) {
        const message = getSerializedTick();
        for (let i = 0; i < messagesToSend; i++) {
          broadcastBuffer(message);
        }
        lastSendTime = now;
      }
      
      setImmediate(tick);
    }
    
    setImmediate(tick);
  }

  function stopHighFrequencyBroadcast() {
    highFreqRunning = false;
  }
```

**Step 3: Update startBroadcast to use high-frequency mode for high rates**

Replace the `startBroadcast` function:

```typescript
  function startBroadcast() {
    stopBroadcast();
    const config = getConfig();
    
    // Use high-frequency mode for rates > 10000
    const HIGH_FREQ_THRESHOLD = 10000;
    
    if (config.rate > HIGH_FREQ_THRESHOLD) {
      console.log(`Broadcasting at ${config.rate} msg/sec (high-frequency mode)`);
      startHighFrequencyBroadcast(config.rate);
    } else if (config.rate <= 1000) {
      const intervalMs = 1000 / config.rate;
      intervalId = setInterval(broadcast, intervalMs);
      console.log(`Broadcasting at ${config.rate} msg/sec`);
    } else {
      const messagesPerTick = Math.ceil(config.rate / 1000);
      intervalId = setInterval(() => broadcastBatch(messagesPerTick), 1);
      console.log(`Broadcasting at ${config.rate} msg/sec (batch mode)`);
    }
    
    startTelemetry();

    if (config.rampEnabled) {
      rampIntervalId = setInterval(() => {
        const current = getConfig();
        const newRate = Math.floor(current.rate * (1 + current.rampPercent / 100));
        updateConfig({ rate: newRate });
        console.log(`Ramped to ${newRate} msg/sec`);
        restartBroadcast();
      }, config.rampIntervalSec * 1000);
    }
  }
```

**Step 4: Update stopBroadcast to stop high-frequency mode**

Replace `stopBroadcast`:

```typescript
  function stopBroadcast() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (rampIntervalId) {
      clearInterval(rampIntervalId);
      rampIntervalId = null;
    }
    stopHighFrequencyBroadcast();
    stopTelemetry();
  }
```

**Step 5: Test the optimization**

Run: `cd server && npm run dev`
Then in another terminal: `curl -X POST http://localhost:8081/config -H "Content-Type: application/json" -d '{"rate": 500000}'`
Expected: Server reports higher actual rate than before (~300k+ vs ~186k)

**Step 6: Commit**

```bash
git add server/src/ws-server.ts
git commit -m "feat: add high-frequency broadcast mode with pre-serialization"
```

---

## Task 3: Run Benchmark and Measure Improvement

**Files:**

- None (testing only)

**Step 1: Run benchmark at 500k target**

Run: `npm run benchmark -- --mode tauri-rust --rate 500000 --duration 15`

**Step 2: Record results**

Note the server actual rate. Compare to baseline (~186k/s).

**Step 3: Decide on Phase 2**

If server rate < 400k/s, proceed to Task 4 (uWebSockets.js).
If server rate >= 400k/s, Phase 1 is sufficient - skip to Task 5.

---

## Task 4: Add uWebSockets.js Implementation (Phase 2)

**Files:**

- Create: `server/src/uws-server.ts`
- Modify: `server/src/index.ts`
- Modify: `server/package.json`

**Step 1: Install uWebSockets.js**

Run: `cd server && npm install uWebSockets.js`

**Step 2: Create uws-server.ts**

```typescript
// server/src/uws-server.ts
import uWS from 'uWebSockets.js';
import { generateTick } from './generator.js';
import { getConfig, updateConfig, ServerConfig } from './config.js';

export function startUwsServer(port: number) {
  const app = uWS.App();
  
  let highFreqRunning = false;
  let rampIntervalId: ReturnType<typeof setInterval> | null = null;
  let telemetryIntervalId: ReturnType<typeof setInterval> | null = null;
  
  let messagesSentThisSecond = 0;
  let lastTelemetryTime = Date.now();
  let lastActualRate = 0;

  interface ClientStats {
    clientId: string;
    lastUpdate: number;
    messagesPerSec: number;
    totalMessages: number;
    avgLatencyMs: number;
    p99LatencyMs: number;
  }

  const clientStats: Map<string, ClientStats> = new Map();
  let connectedClients = 0;

  // Pre-serialized message cache
  let cachedMessage: Buffer | null = null;
  let cachedTimestamp = 0;

  function getSerializedTick(): Buffer {
    const now = Date.now();
    if (!cachedMessage || now - cachedTimestamp >= 1) {
      cachedMessage = Buffer.from(JSON.stringify(generateTick()));
      cachedTimestamp = now;
    }
    return cachedMessage;
  }

  function startTelemetry() {
    if (telemetryIntervalId) return;
    telemetryIntervalId = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - lastTelemetryTime) / 1000;
      const actualRate = Math.round(messagesSentThisSecond / elapsed);
      lastActualRate = actualRate;
      const targetRate = getConfig().rate;
      
      let output = `[Stats] Rate: ${targetRate.toLocaleString()}/s | Server actual: ${actualRate.toLocaleString()}/s\n`;
      
      const clientTypes = ['browser-js', 'tauri-js', 'tauri-rust'];
      for (const clientId of clientTypes) {
        const stats = clientStats.get(clientId);
        if (stats && (now - stats.lastUpdate) < 5000) {
          output += `        ${clientId.padEnd(12)}: ${stats.messagesPerSec.toLocaleString().padStart(8)} msg/s, lat: ${stats.avgLatencyMs.toFixed(1)}ms avg`;
          if (stats.p99LatencyMs > 0) {
            output += ` / ${stats.p99LatencyMs.toFixed(1)}ms p99`;
          }
          output += '\n';
        } else {
          output += `        ${clientId.padEnd(12)}: (not connected)\n`;
        }
      }
      
      console.log(output.trimEnd());
      messagesSentThisSecond = 0;
      lastTelemetryTime = now;
    }, 1000);
  }

  function stopTelemetry() {
    if (telemetryIntervalId) {
      clearInterval(telemetryIntervalId);
      telemetryIntervalId = null;
    }
  }

  function startHighFrequencyBroadcast(targetRate: number) {
    const nsPerMessage = 1_000_000_000 / targetRate;
    let lastSendTime = process.hrtime.bigint();
    highFreqRunning = true;

    function tick() {
      if (!highFreqRunning) return;
      
      const now = process.hrtime.bigint();
      const elapsed = Number(now - lastSendTime);
      const messagesToSend = Math.floor(elapsed / nsPerMessage);
      
      if (messagesToSend > 0) {
        const message = getSerializedTick();
        for (let i = 0; i < messagesToSend; i++) {
          app.publish('ticks', message, true);
          messagesSentThisSecond++;
        }
        lastSendTime = now;
      }
      
      setImmediate(tick);
    }
    
    setImmediate(tick);
  }

  function stopHighFrequencyBroadcast() {
    highFreqRunning = false;
  }

  function startBroadcast() {
    stopBroadcast();
    const config = getConfig();
    
    console.log(`Broadcasting at ${config.rate} msg/sec (uWS high-frequency mode)`);
    startHighFrequencyBroadcast(config.rate);
    startTelemetry();

    if (config.rampEnabled) {
      rampIntervalId = setInterval(() => {
        const current = getConfig();
        const newRate = Math.floor(current.rate * (1 + current.rampPercent / 100));
        updateConfig({ rate: newRate });
        console.log(`Ramped to ${newRate} msg/sec`);
        restartBroadcast();
      }, config.rampIntervalSec * 1000);
    }
  }

  function stopBroadcast() {
    if (rampIntervalId) {
      clearInterval(rampIntervalId);
      rampIntervalId = null;
    }
    stopHighFrequencyBroadcast();
    stopTelemetry();
  }

  function restartBroadcast() {
    if (connectedClients > 0) {
      startBroadcast();
    }
  }

  // WebSocket handler
  app.ws('/*', {
    open: (ws) => {
      ws.subscribe('ticks');
      connectedClients++;
      console.log('Client connected');
      startBroadcast();
    },
    message: (ws, message, isBinary) => {
      try {
        const data = Buffer.from(message).toString();
        const msg = JSON.parse(data);
        
        if (msg.type === 'identify') {
          console.log(`Client identified as: ${msg.clientId}`);
        } else if (msg.type === 'stats') {
          clientStats.set(msg.clientId, {
            clientId: msg.clientId,
            lastUpdate: Date.now(),
            messagesPerSec: msg.messagesPerSec,
            totalMessages: msg.totalMessages,
            avgLatencyMs: msg.avgLatencyMs,
            p99LatencyMs: msg.p99LatencyMs,
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    },
    close: (ws) => {
      connectedClients--;
      console.log('Client disconnected');
      if (connectedClients === 0) {
        stopBroadcast();
      }
    }
  });

  // HTTP endpoints
  app.get('/config', (res, req) => {
    res.writeHeader('Access-Control-Allow-Origin', '*');
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(getConfig()));
  });

  app.options('/*', (res, req) => {
    res.writeHeader('Access-Control-Allow-Origin', '*');
    res.writeHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.writeHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.end();
  });

  app.post('/config', (res, req) => {
    res.writeHeader('Access-Control-Allow-Origin', '*');
    
    let body = '';
    res.onData((chunk, isLast) => {
      body += Buffer.from(chunk).toString();
      if (isLast) {
        try {
          const updates = JSON.parse(body);
          Object.assign(getConfig(), updates);
          updateConfig(updates);
          restartBroadcast();
          res.writeHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(getConfig()));
        } catch {
          res.writeStatus('400');
          res.end('Invalid JSON');
        }
      }
    });
    
    res.onAborted(() => {
      console.log('Request aborted');
    });
  });

  app.get('/stats', (res, req) => {
    res.writeHeader('Access-Control-Allow-Origin', '*');
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      serverRate: lastActualRate,
      targetRate: getConfig().rate,
      clients: Object.fromEntries(clientStats),
    }));
  });

  app.del('/stats', (res, req) => {
    res.writeHeader('Access-Control-Allow-Origin', '*');
    clientStats.clear();
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cleared: true }));
  });

  app.listen(port, (token) => {
    if (token) {
      console.log(`uWebSockets.js server running on ws://localhost:${port}`);
      console.log(`Config API on http://localhost:${port}/config`);
    } else {
      console.log('Failed to start server');
    }
  });
}
```

**Step 3: Update index.ts to support both modes**

```typescript
// server/src/index.ts
import { startConfigServer } from './config.js';

const WS_PORT = 8080;
const HTTP_PORT = 8081;
const USE_UWS = process.env.SERVER_MODE === 'uws';

if (USE_UWS) {
  // uWebSockets.js mode - combined WS + HTTP on single port
  const { startUwsServer } = await import('./uws-server.js');
  startUwsServer(WS_PORT);
} else {
  // Standard ws mode - separate WS and HTTP ports
  const { startWsServer } = await import('./ws-server.js');
  startConfigServer(HTTP_PORT);
  startWsServer(WS_PORT, HTTP_PORT);
}
```

**Step 4: Add npm scripts**

Add to `server/package.json` scripts:

```json
"dev:uws": "SERVER_MODE=uws tsx src/index.ts"
```

**Step 5: Test uWebSockets.js mode**

Run: `cd server && npm run dev:uws`
Expected: Server starts on port 8080 with both WS and HTTP

**Step 6: Commit**

```bash
git add server/src/uws-server.ts server/src/index.ts server/package.json
git commit -m "feat: add uWebSockets.js server implementation"
```

---

## Task 5: Final Benchmark Comparison

**Files:**

- None (testing only)

**Step 1: Benchmark ws mode**

Run: `npm run benchmark -- --mode tauri-rust --rate 1000000 --duration 15`
Record: Server actual rate

**Step 2: Benchmark uws mode**

Start server: `cd server && npm run dev:uws`
Run: `npm run benchmark -- --mode tauri-rust --rate 1000000 --duration 15`
Record: Server actual rate

**Step 3: Document results**

Update BENCHMARK_REPORT.md with new server performance data.

**Step 4: Commit**

```bash
git add BENCHMARK_REPORT.md
git commit -m "docs: update benchmark report with optimized server results"
```
