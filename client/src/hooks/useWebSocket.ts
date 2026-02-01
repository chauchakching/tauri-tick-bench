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

// Determine client ID based on environment
function getClientId(): string {
  // Check multiple ways to detect Tauri
  const isTauri = '__TAURI__' in window || 
                  '__TAURI_INTERNALS__' in window ||
                  navigator.userAgent.includes('Tauri');
  if (!isTauri) return 'browser-js';
  return 'tauri-js';
}

export function useWebSocket(url: string, autoConnect: boolean = true) {
  const wsRef = useRef<WebSocket | null>(null);
  const metricsRef = useRef<MetricsCollector>(new MetricsCollector());
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastTick: null,
    metrics: null,
  });

  // Send stats to server
  const sendStats = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) return;
    const snapshot = metricsRef.current.snapshot();
    if (!snapshot) return;
    
    const statsMsg = {
      type: 'stats',
      clientId: getClientId(),
      messagesPerSec: snapshot.messagesPerSecond,
      totalMessages: snapshot.totalMessages,
      avgLatencyMs: snapshot.avgLatencyMs,
      p99LatencyMs: snapshot.p99LatencyMs,
    };
    wsRef.current.send(JSON.stringify(statsMsg));
  }, []);

  // Update metrics display at 1Hz and send stats to server
  useEffect(() => {
    const interval = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setState((s) => ({
          ...s,
          metrics: metricsRef.current.snapshot(),
        }));
        sendStats();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [sendStats]);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

    metricsRef.current.start();
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setState((s) => ({ ...s, connected: true }));
      // Send identify message
      const identifyMsg = { type: 'identify', clientId: getClientId() };
      ws.send(JSON.stringify(identifyMsg));
    };

    ws.onclose = () => {
      setState((s) => ({ ...s, connected: false }));
      wsRef.current = null;
      
      // Auto-reconnect with backoff
      if (autoConnect) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      }
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
        // Ignore parse errors (might be control messages)
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [url, autoConnect]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const resetMetrics = useCallback(() => {
    metricsRef.current.reset();
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    if (autoConnect) {
      connect();
    }
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [autoConnect, connect]);

  return { ...state, connect, disconnect, resetMetrics };
}
