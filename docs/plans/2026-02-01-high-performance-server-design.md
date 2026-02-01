# High-Performance Server Design

**Date:** 2026-02-01  
**Goal:** Maximize server throughput to find tauri-rust client's true ceiling

## Context

The current Node.js server caps at ~186k msg/sec due to:
- Single-threaded execution
- `setInterval` timer resolution (~4ms minimum)
- JSON serialization per message
- Individual `send()` calls per client

The tauri-rust client processes at 100% efficiency (186k/s), so the server is the bottleneck.

## Approach

Two-phase optimization, starting with pure Node.js, escalating to native bindings if needed.

### Phase 1: Optimized `ws` Library

**Optimizations:**

1. **Replace `setInterval` with tight loop** - Use `setImmediate` + `process.hrtime.bigint()` for nanosecond precision rate limiting

2. **Pre-serialize messages** - Generate JSON once, broadcast same Buffer to all clients

3. **Disable Nagle's algorithm** - `socket.setNoDelay(true)` for lower latency

**Implementation:**

```typescript
// Pre-generate and cache serialized message
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

// High-frequency broadcast with precise timing
function startHighFrequencyBroadcast(targetRate: number) {
  const nsPerMessage = 1_000_000_000 / targetRate;
  let lastSendTime = process.hrtime.bigint();
  
  function tick() {
    const now = process.hrtime.bigint();
    const elapsed = Number(now - lastSendTime);
    const messagesToSend = Math.floor(elapsed / nsPerMessage);
    
    if (messagesToSend > 0) {
      const message = getSerializedTick();
      for (let i = 0; i < messagesToSend; i++) {
        broadcast(message);
      }
      lastSendTime = now;
    }
    
    setImmediate(tick);
  }
  
  setImmediate(tick);
}
```

**Expected:** 300-500k msg/sec

### Phase 2: uWebSockets.js

If Phase 1 hits a ceiling, switch to `uWebSockets.js` (C++ bindings, 10-100x faster).

**Key changes:**

1. Different API - no `ws` compatibility
2. Built-in pub/sub for efficient broadcast (single syscall)
3. Combined HTTP + WebSocket on same port

**Implementation:**

```typescript
import uWS from 'uWebSockets.js';

const app = uWS.App();

app.ws('/*', {
  open: (ws) => {
    ws.subscribe('ticks');
    startBroadcast();
  },
  message: (ws, message) => {
    handleClientMessage(ws, Buffer.from(message).toString());
  },
  close: (ws) => {
    // cleanup
  }
});

// Efficient broadcast via pub/sub
function broadcast(message: Buffer) {
  app.publish('ticks', message, true);
}
```

**Expected:** 1-3M msg/sec

## File Structure

```
server/
├── src/
│   ├── index.ts          # Entry point - picks implementation
│   ├── ws-server.ts      # Phase 1: Optimized ws
│   ├── uws-server.ts     # Phase 2: uWebSockets.js
│   ├── config.ts         # Shared config
│   └── generator.ts      # Unchanged
```

**Running:**

```bash
# Phase 1 - optimized ws
npm run dev

# Phase 2 - uWebSockets.js
SERVER_MODE=uws npm run dev
```

## Success Criteria

| Implementation | Target Rate | Improvement |
|----------------|-------------|-------------|
| Phase 1 (optimized ws) | > 300k/s | 1.5x |
| Phase 2 (uWebSockets.js) | > 1M/s | 5x+ |

Ultimate goal: Server no longer bottleneck for tauri-rust client.

## Risks

- uWebSockets.js has different error handling semantics
- May need benchmark script updates for new server modes
- Client stats reporting unchanged (same message format)
