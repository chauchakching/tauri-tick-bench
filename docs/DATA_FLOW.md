# Tick Bench Data Flow Architecture

This document explains the complete data flow from message generation to client processing, including all buffering layers and their impact on benchmark results.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER (Node.js)                                │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Generate   │───▶│   Broadcast  │───▶│  ws library  │                   │
│  │    Tick      │    │    Loop      │    │   .send()    │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                            │
│         ▼                   ▼                   ▼                            │
│   [Message Cache]    [setImmediate]      [Node.js Buffer]                   │
│    (1ms refresh)      (yields to          (internal queue)                  │
│                       event loop)                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OS KERNEL (TCP)                                    │
│                                                                              │
│  [Server Send Buffer] ──────▶ Network ──────▶ [Client Receive Buffer]       │
│    (SO_SNDBUF ~128KB)                           (SO_RCVBUF ~128KB)          │
│                                                                              │
│  TCP Flow Control: If receive buffer fills, sender is told to slow down     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │  WebSocket   │───▶│    Parse     │───▶│   Process    │                   │
│  │   onmessage  │    │   Message    │    │   & Render   │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│         │                   │                   │                            │
│         ▼                   ▼                   ▼                            │
│  [Event Queue]        [JSON/Binary]      [React setState]                   │
│   (browser/Rust)       decode             (triggers re-render)              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Server Message Generation

### Message Formats

| Format | Size | Generation |
|--------|------|------------|
| **JSON** | ~50 bytes variable | `JSON.stringify({ symbol, price, ts })` |
| **Binary** | 20 bytes fixed | `u32 symbol + f64 price + i64 ts` (little-endian) |

### Broadcast Modes (ws-server.ts)

The server selects broadcast mode based on target rate:

```
Rate ≤ 1,000/s     → setInterval(broadcast, 1000/rate)
                     One message per interval tick

Rate 1,001-10,000  → setInterval(broadcastBatch, 1ms)
                     Batch mode: ceil(rate/1000) messages per 1ms tick

Rate > 10,000      → setImmediate loop (high-frequency mode)
                     Continuous loop, calculates messages to send based on elapsed nanoseconds
```

### High-Frequency Mode Detail

```javascript
function startHighFrequencyBroadcast(targetRate) {
  const nsPerMessage = 1_000_000_000 / targetRate;  // e.g., 2000ns for 500k/s
  let lastSendTime = process.hrtime.bigint();

  function tick() {
    const now = process.hrtime.bigint();
    const elapsed = Number(now - lastSendTime);
    const messagesToSend = Math.floor(elapsed / nsPerMessage);

    if (messagesToSend > 0) {
      const message = getSerializedTick();  // Cached, refreshed every 1ms
      for (let i = 0; i < messagesToSend; i++) {
        broadcastBuffer(message);           // Same message reused in burst
      }
      lastSendTime = now;
    }

    setImmediate(tick);  // ⚠️ YIELDS TO EVENT LOOP
  }
  setImmediate(tick);
}
```

**Key behaviors:**
- `setImmediate` yields control to the Node.js event loop between iterations
- Message is cached for 1ms, so bursts within 1ms send identical timestamps
- Event loop contention (I/O, timers) reduces actual send rate

### Message Caching

```javascript
let cachedMessage: Buffer | null = null;
let cachedTimestamp = 0;

function getSerializedTick(): Buffer {
  const now = Date.now();
  if (!cachedMessage || now - cachedTimestamp >= 1) {  // Refresh every 1ms
    cachedMessage = isBinary ? generateTickBinary() : Buffer.from(JSON.stringify(generateTick()));
    cachedTimestamp = now;
  }
  return cachedMessage;  // ⚠️ SAME BUFFER REUSED
}
```

**Impact on benchmark:**
- At 500k/s, ~500 messages share the same timestamp within each 1ms window
- Latency calculations may be skewed by this batching

---

## 2. Server-Side Buffering

### ws Library Behavior

When `client.send(message)` is called:

```
Your Code                ws Library                    OS Kernel
    │                         │                            │
    │  client.send(msg)       │                            │
    │────────────────────────▶│                            │
    │                         │  socket.write(msg)         │
    │                         │───────────────────────────▶│
    │                         │                            │  [Send Buffer]
    │  returns immediately    │                            │  (SO_SNDBUF)
    │◀────────────────────────│                            │
    │                         │                            │
```

**Critical insight:** `send()` returns immediately after pushing to the OS buffer. It does NOT wait for:
- The message to be transmitted over the network
- The client to receive the message
- Any acknowledgment

### What "Server Rate" Actually Measures

```javascript
function broadcastBuffer(message: Buffer) {
  wss.clients.forEach((client) => {
    client.send(message);
    messagesSentThisSecond++;  // ⚠️ COUNTS BUFFERED, NOT DELIVERED
  });
}
```

The server telemetry counts messages **pushed to OS buffer**, not messages **delivered to client**.

---

## 3. Network Layer (TCP)

### Buffer Sizes (typical defaults)

| Buffer | Size | Messages at 50B | Messages at 20B |
|--------|------|-----------------|-----------------|
| Server Send Buffer | ~128KB | ~2,600 | ~6,400 |
| Client Receive Buffer | ~128KB | ~2,600 | ~6,400 |

### TCP Flow Control

```
                    TCP Sliding Window
    ┌─────────────────────────────────────────────┐
    │                                             │
    │  Server ──▶ [Window Size: N bytes] ──▶ Client
    │                                             │
    │  If client's receive buffer fills up:       │
    │  • Client advertises Window = 0             │
    │  • Server stops sending (blocks or buffers) │
    │  • Server's send buffer fills up            │
    │  • send() starts blocking/failing           │
    └─────────────────────────────────────────────┘
```

**With slow client (JS at ~28k/s):**
- Client processes slowly, but still reads from OS buffer
- Messages accumulate in JavaScript event queue (not TCP buffer)
- Server can keep pushing to TCP buffer freely
- Server reports high "send" rate (actually buffering rate)

**With fast client (Rust at ~290k/s):**
- Client drains messages as fast as they arrive
- Server's actual throughput is limited by real network I/O
- Server reports lower but more accurate rate

---

## 4. Client Processing

### JavaScript Client (browser-js, tauri-js)

```javascript
ws.onmessage = (event) => {
  // 1. Parse message (JSON or Binary)
  let tick = event.data instanceof ArrayBuffer 
    ? decodeBinaryTick(event.data)    // DataView operations
    : JSON.parse(event.data);          // JSON parsing

  // 2. Record metrics
  metricsRef.current.recordMessage(tick.ts);  // Array operations

  // 3. Update React state - TRIGGERS RE-RENDER
  setState((s) => ({ ...s, lastTick: tick }));  // ⚠️ EXPENSIVE
};
```

**Bottlenecks:**
1. **JSON.parse()** - String tokenization and object creation
2. **setState()** - Schedules React re-render for EVERY message
3. **Event loop** - Each message is a separate event, blocks other work

**Why ~28k/s limit:**
- React's reconciliation cannot keep up with 500k state updates/second
- Event queue grows unboundedly, causing latency to increase over time
- Binary format doesn't help because setState() is the real bottleneck

### Rust Client (tauri-rust)

```rust
// Read messages - optimized for high throughput
while state.running.load(Ordering::Relaxed) {
    match read.next().await {
        Some(Ok(msg)) => {
            match &msg {
                Message::Text(text) | Message::Binary(data) => {
                    // Count EVERY message
                    let count = state.total_messages.fetch_add(1, Ordering::Relaxed);
                    state.messages_this_second.fetch_add(1, Ordering::Relaxed);

                    // Only parse every 1000th message
                    if count % 1000 == 0 {
                        // Parse and calculate latency
                    }
                }
            }
        }
    }
}
```

**Optimizations:**
1. **Atomic counters** - Lock-free counting with `Ordering::Relaxed`
2. **Sampling** - Only parses every 1000th message to reduce overhead
3. **No UI updates per message** - Emits metrics at 1Hz, not per-message
4. **Tight async loop** - No React, no JS event queue

**Why ~290k/s:**
- Native tokio async runtime is much faster than JS event loop
- Atomic operations are nearly free
- Skipping parse 999/1000 times eliminates decode overhead
- UI updates are decoupled (1Hz emit to frontend)

---

## 5. Metrics Collection

### Server-Side Telemetry

```javascript
// Reset every second
setInterval(() => {
  const elapsed = (now - lastTelemetryTime) / 1000;
  const actualRate = Math.round(messagesSentThisSecond / elapsed);
  messagesSentThisSecond = 0;  // Reset counter
}, 1000);
```

**Measures:** Messages pushed to `client.send()` per second (buffered, not delivered)

### Client-Side Metrics

**JavaScript (MetricsCollector):**
```javascript
recordMessage(serverTimestamp: number) {
  this.totalMessages++;
  this.messageTimestamps.push(now);        // Array for rate calculation
  this.latencies.push(now - serverTimestamp);  // Array for latency

  // Keep only last 1000 latencies
  if (this.latencies.length > 1000) {
    this.latencies = this.latencies.slice(-1000);
  }
}

snapshot(): MetricsSnapshot {
  // Filter timestamps from last second for rate
  const recentMessages = this.messageTimestamps.filter((t) => t > oneSecondAgo);
  const messagesPerSecond = recentMessages.length;  // ⚠️ ACTUAL PROCESSED RATE
}
```

**Rust (Atomic counters):**
```rust
// Simple atomic swap every second
let msg_per_sec = metrics_state.messages_this_second.swap(0, Ordering::SeqCst);
```

**Measures:** Messages actually received and counted by client per second

---

## 6. Why Results Differ

### Observed Results (Binary format, 500k/s target)

| Client | Server Reports | Client Reports | Latency |
|--------|----------------|----------------|---------|
| browser-js | ~480k/s | ~28k/s | ~10 seconds |
| tauri-js | ~480k/s | ~27k/s | ~10 seconds |
| tauri-rust | ~290k/s | ~290k/s | ~1-2ms |

### Explanation

**JS Clients (browser-js, tauri-js):**
```
Server pushes 480k/s to buffer
        │
        ▼
    [OS Buffers] fill up but don't overflow (TCP flow control)
        │
        ▼
    [JS Event Queue] accumulates messages faster than processed
        │
        ▼
    Client processes 28k/s (setState bottleneck)
        │
        ▼
    Backlog grows: 480k - 28k = 452k messages/sec accumulating
        │
        ▼
    After 10s: ~4.5M messages in queue → 10+ second latency
```

**Rust Client:**
```
Server pushes to buffer
        │
        ▼
    Rust client drains buffer immediately (290k/s processing)
        │
        ▼
    TCP flow control kicks in - server can't push faster than client reads
        │
        ▼
    Server rate drops to match client (~290k/s)
        │
        ▼
    No backlog → latency stays low (1-2ms)
```

### Why Server Rate Drops with Fast Client

The Node.js `ws` library and OS TCP stack create backpressure:

1. When client reads slowly → server's send buffer stays partially full → `send()` returns instantly
2. When client reads fast → server's send buffer drains → `send()` may need to wait for socket write
3. The `setImmediate` loop shares the event loop with I/O completion callbacks
4. More I/O activity (ACKs, buffer draining) = less time for broadcast loop

---

## 7. Benchmark Accuracy Considerations

### What the Benchmark Measures

| Metric | What It Actually Represents |
|--------|----------------------------|
| Server Rate | Messages pushed to OS buffer per second |
| Client Rate | Messages processed by application per second |
| Latency | Time from message generation to client processing |
| Efficiency | Client Rate / Server Rate (can be misleading) |

### Caveats

1. **Server rate with slow clients is inflated** - Measures buffering speed, not delivery
2. **Message cache skews timestamps** - Up to 500 messages share same timestamp per ms
3. **Rust samples latency** - Only measures every 1000th message
4. **JS latency includes queue time** - Not just network latency

### More Accurate Benchmark Would Need

1. **Delivery confirmation** - Server counts ACKed messages, not buffered
2. **Unique timestamps** - Each message has its own timestamp
3. **Consistent measurement** - All clients use same sampling strategy
4. **Steady state** - Wait for system to stabilize before measuring

---

## 8. Summary

```
┌────────────────────────────────────────────────────────────────────┐
│                     MESSAGE JOURNEY                                 │
├────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. GENERATION                                                      │
│     generateTick() → cached for 1ms → same message in bursts       │
│                                                                     │
│  2. SERVER BUFFER                                                   │
│     client.send() → ws internal buffer → OS send buffer            │
│     ⚠️ "Server rate" counts here (inflated with slow clients)      │
│                                                                     │
│  3. NETWORK                                                         │
│     TCP send buffer → wire → TCP receive buffer                    │
│     Flow control prevents overflow but allows buffering            │
│                                                                     │
│  4. CLIENT BUFFER                                                   │
│     OS receive buffer → WebSocket library → Event queue            │
│     JS: queue grows unboundedly                                    │
│     Rust: drains immediately                                       │
│                                                                     │
│  5. PROCESSING                                                      │
│     Parse message → Record metrics → Update UI                     │
│     JS: setState() per message (bottleneck)                        │
│     Rust: atomic counters, sampled parsing, 1Hz UI                 │
│                                                                     │
│  6. MEASUREMENT                                                     │
│     "Client rate" = messages processed per second (accurate)       │
│     Latency = now - message.timestamp (includes queue time)        │
│                                                                     │
└────────────────────────────────────────────────────────────────────┘
```

The key insight: **With slow clients, the server rate is a measure of buffering speed, not throughput. The Rust client reveals the true system throughput by consuming fast enough to create backpressure.**
