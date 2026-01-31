// server/src/index.ts
import { WebSocketServer, WebSocket } from 'ws';
import { generateTick } from './generator.js';
import { startConfigServer, setConfigChangeCallback, getConfig, updateConfig, ServerConfig } from './config.js';

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
