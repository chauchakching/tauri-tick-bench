// server/src/uws-server.ts
import uWS from 'uWebSockets.js';
import { generateTick } from './generator.js';
import { getConfig, updateConfig } from './config.js';

// WebSocket user data type
interface WsUserData {
  clientId: string | null;
}

let app: uWS.TemplatedApp;

let intervalId: ReturnType<typeof setInterval> | null = null;
let rampIntervalId: ReturnType<typeof setInterval> | null = null;
let telemetryIntervalId: ReturnType<typeof setInterval> | null = null;

// Server-side telemetry
let messagesSentThisSecond = 0;
let lastTelemetryTime = Date.now();
let lastActualRate = 0;

// Client stats collection
interface ClientStats {
  clientId: string;
  lastUpdate: number;
  messagesPerSec: number;
  totalMessages: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

const clientStats: Map<string, ClientStats> = new Map();

// Track connected clients count
let connectedClients = 0;

// Pre-serialized message cache
let cachedMessage: ArrayBuffer | null = null;
let cachedTimestamp = 0;

function getSerializedTick(): ArrayBuffer {
  const now = Date.now();
  // Regenerate every 1ms to keep timestamps fresh
  if (!cachedMessage || now - cachedTimestamp >= 1) {
    const json = JSON.stringify(generateTick());
    const encoder = new TextEncoder();
    cachedMessage = encoder.encode(json).buffer;
    cachedTimestamp = now;
  }
  return cachedMessage;
}

// High-frequency mode state
let highFreqRunning = false;

function broadcastPubSub() {
  const message = JSON.stringify(generateTick());
  // Use pub/sub - single syscall to broadcast to all subscribers
  app.publish('ticks', message, false); // false = text (not binary)
  messagesSentThisSecond++;
}

function broadcastBatchPubSub(messagesPerTick: number) {
  for (let i = 0; i < messagesPerTick; i++) {
    const message = JSON.stringify(generateTick());
    app.publish('ticks', message, false);
    messagesSentThisSecond++;
  }
}

function broadcastBufferPubSub(message: ArrayBuffer) {
  app.publish('ticks', message, true); // true = binary
  messagesSentThisSecond++;
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
        broadcastBufferPubSub(message);
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

function startTelemetry() {
  if (telemetryIntervalId) return;
  telemetryIntervalId = setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastTelemetryTime) / 1000;
    const actualRate = Math.round(messagesSentThisSecond / elapsed);
    lastActualRate = actualRate;
    const targetRate = getConfig().rate;
    
    // Build stats output
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
  
  // Use high-frequency mode for rates > 10000
  const HIGH_FREQ_THRESHOLD = 10000;
  
  if (config.rate > HIGH_FREQ_THRESHOLD) {
    console.log(`Broadcasting at ${config.rate} msg/sec (high-frequency mode)`);
    startHighFrequencyBroadcast(config.rate);
  } else if (config.rate <= 1000) {
    const intervalMs = 1000 / config.rate;
    intervalId = setInterval(broadcastPubSub, intervalMs);
    console.log(`Broadcasting at ${config.rate} msg/sec`);
  } else {
    const messagesPerTick = Math.ceil(config.rate / 1000);
    intervalId = setInterval(() => broadcastBatchPubSub(messagesPerTick), 1);
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

function restartBroadcast() {
  if (connectedClients > 0) {
    startBroadcast();
  }
}

// Handle incoming messages from clients
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

function handleClientMessage(ws: uWS.WebSocket<WsUserData>, data: ArrayBuffer) {
  try {
    const decoder = new TextDecoder();
    const msg: ClientMessage = JSON.parse(decoder.decode(data));
    
    if (msg.type === 'identify') {
      ws.getUserData().clientId = msg.clientId;
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
    // Ignore parse errors - might be other message types
  }
}

// CORS headers helper
function setCorsHeaders(res: uWS.HttpResponse) {
  res.writeHeader('Access-Control-Allow-Origin', '*');
  res.writeHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.writeHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// Read POST body helper
function readBody(res: uWS.HttpResponse, callback: (body: string) => void) {
  let buffer = '';
  
  res.onAborted(() => {
    // Request aborted, do nothing
  });
  
  res.onData((chunk, isLast) => {
    buffer += Buffer.from(chunk).toString();
    if (isLast) {
      callback(buffer);
    }
  });
}

export function startUwsServer(port: number) {
  app = uWS.App();
  
  // OPTIONS handler for CORS preflight
  app.options('/*', (res, req) => {
    setCorsHeaders(res);
    res.writeStatus('204 No Content');
    res.end();
  });
  
  // GET /config
  app.get('/config', (res, req) => {
    setCorsHeaders(res);
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(getConfig()));
  });
  
  // POST /config
  app.post('/config', (res, req) => {
    setCorsHeaders(res);
    
    readBody(res, (body) => {
      try {
        const updates = JSON.parse(body);
        const config = getConfig();
        Object.assign(config, updates);
        updateConfig(updates);
        restartBroadcast();
        res.writeHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(getConfig()));
      } catch {
        res.writeStatus('400 Bad Request');
        res.end('Invalid JSON');
      }
    });
  });
  
  // GET /stats
  app.get('/stats', (res, req) => {
    setCorsHeaders(res);
    res.writeHeader('Content-Type', 'application/json');
    const stats = {
      serverRate: lastActualRate,
      targetRate: getConfig().rate,
      clients: Object.fromEntries(clientStats),
    };
    res.end(JSON.stringify(stats));
  });
  
  // DELETE /stats
  app.del('/stats', (res, req) => {
    setCorsHeaders(res);
    clientStats.clear();
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ cleared: true }));
  });
  
  // WebSocket handler
  app.ws<WsUserData>('/*', {
    compression: uWS.DISABLED,
    maxPayloadLength: 16 * 1024,
    idleTimeout: 0,
    
    open: (ws) => {
      console.log('Client connected');
      ws.subscribe('ticks');
      connectedClients++;
      startBroadcast();
    },
    
    message: (ws, message, isBinary) => {
      handleClientMessage(ws, message);
    },
    
    close: (ws, code, message) => {
      const clientId = ws.getUserData().clientId;
      if (clientId) {
        console.log(`Client disconnected: ${clientId}`);
      } else {
        console.log('Client disconnected');
      }
      connectedClients--;
      if (connectedClients === 0) {
        stopBroadcast();
      }
    },
  });
  
  app.listen(port, (listenSocket) => {
    if (listenSocket) {
      console.log(`uWebSockets.js server running on ws://localhost:${port} (WS) and http://localhost:${port} (HTTP)`);
    } else {
      console.error(`Failed to listen on port ${port}`);
    }
  });
}
