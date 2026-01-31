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
