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

  start() {
    this.startTime = Date.now();
    this.messageTimestamps = [];
    this.latencies = [];
    this.totalMessages = 0;
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
