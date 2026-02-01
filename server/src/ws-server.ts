// server/src/ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { generateTick } from './generator.js';
import { setConfigChangeCallback, setStatsCallbacks, getConfig, updateConfig, ServerConfig } from './config.js';

let wss: WebSocketServer;

let intervalId: ReturnType<typeof setInterval> | null = null;
let rampIntervalId: ReturnType<typeof setInterval> | null = null;
let telemetryIntervalId: ReturnType<typeof setInterval> | null = null;

// Server-side telemetry
let messagesSentThisSecond = 0;
let lastTelemetryTime = Date.now();
let lastActualRate = 0; // Track actual rate for API

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
const clientIdBySocket: Map<WebSocket, string> = new Map();

function broadcast() {
  const message = JSON.stringify(generateTick());
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
      messagesSentThisSecond++;
    }
  });
}

// For high rates (>1000/sec), send multiple messages per tick
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
    lastActualRate = actualRate; // Store for API
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
  
  // For rates > 1000, batch messages per interval tick
  // setInterval min resolution is ~1ms, so max 1000 ticks/sec
  const MAX_TICKS_PER_SEC = 1000;
  
  if (config.rate <= MAX_TICKS_PER_SEC) {
    // Simple mode: one message per interval
    const intervalMs = 1000 / config.rate;
    intervalId = setInterval(broadcast, intervalMs);
  } else {
    // Batch mode: multiple messages per 1ms tick
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
    // Ignore parse errors - might be other message types
  }
}

export function startWsServer(wsPort: number, httpPort: number) {
  wss = new WebSocketServer({ port: wsPort });
  
  console.log(`WebSocket server running on ws://localhost:${wsPort}`);

  setConfigChangeCallback((config: ServerConfig) => {
    console.log('Config updated:', config);
    restartBroadcast();
  });

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

  // Register stats callbacks for HTTP API
  setStatsCallbacks(
    () => ({ 
      clients: Object.fromEntries(clientStats),
      actualRate: lastActualRate,
      targetRate: getConfig().rate,
    }),
    () => clientStats.clear()
  );
}
