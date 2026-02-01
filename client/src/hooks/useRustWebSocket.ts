// client/src/hooks/useRustWebSocket.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface RustTickMessage {
  symbol: string;
  price: number;
  ts: number;
}

export interface RustMetrics {
  messages_per_sec: number;
  total_messages: number;
  avg_latency_ms: number;
  last_tick: RustTickMessage | null;
}

export interface RustWebSocketState {
  connected: boolean;
  lastTick: RustTickMessage | null;
  metrics: RustMetrics | null;
  error: string | null;
}

export function useRustWebSocket(url: string, autoConnect: boolean = false) {
  const [state, setState] = useState<RustWebSocketState>({
    connected: false,
    lastTick: null,
    metrics: null,
    error: null,
  });
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(autoConnect);

  const connect = useCallback(async () => {
    try {
      setState((s) => ({ ...s, error: null }));
      await invoke('connect_rust_ws', { url });
    } catch (e) {
      setState((s) => ({ ...s, error: String(e) }));
      // Auto-reconnect on failure
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connect();
        }, 2000);
      }
    }
  }, [url]);

  const disconnect = useCallback(async () => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    try {
      await invoke('disconnect_rust_ws');
    } catch (e) {
      console.error('Disconnect error:', e);
    }
  }, []);

  useEffect(() => {
    const unlisteners: UnlistenFn[] = [];

    const setupListeners = async () => {
      // Listen for connection events
      unlisteners.push(
        await listen('rust-ws-connected', () => {
          setState((s) => ({ ...s, connected: true, error: null }));
        })
      );

      unlisteners.push(
        await listen('rust-ws-disconnected', () => {
          setState((s) => ({ ...s, connected: false }));
          // Auto-reconnect on disconnect
          if (shouldReconnectRef.current) {
            reconnectTimeoutRef.current = setTimeout(() => {
              connect();
            }, 2000);
          }
        })
      );

      unlisteners.push(
        await listen<string>('rust-ws-error', (event) => {
          setState((s) => ({ ...s, error: event.payload, connected: false }));
        })
      );

      // Listen for metrics updates (1Hz from Rust)
      unlisteners.push(
        await listen<RustMetrics>('rust-ws-metrics', (event) => {
          setState((s) => ({
            ...s,
            metrics: event.payload,
            lastTick: event.payload.last_tick,
          }));
        })
      );
    };

    setupListeners();

    // Auto-connect on mount if enabled
    if (autoConnect) {
      shouldReconnectRef.current = true;
      connect();
    }

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [autoConnect, connect]);

  const resetMetrics = useCallback(async () => {
    try {
      await invoke('reset_rust_metrics');
      setState((s) => ({ ...s, metrics: null }));
    } catch (e) {
      console.error('Reset metrics error:', e);
    }
  }, []);

  return { ...state, connect, disconnect, resetMetrics };
}
