// client/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { MetricsCollector } from '../metrics/collector';
import type { MetricsSnapshot } from '../metrics/collector';

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
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

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
      try {
        const tick: TickMessage = JSON.parse(event.data);
        metricsRef.current.recordMessage(tick.ts);
        setState((s) => ({
          ...s,
          lastTick: tick,
        }));
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
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
