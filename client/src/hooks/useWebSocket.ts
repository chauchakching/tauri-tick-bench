// client/src/hooks/useWebSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';

export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

export interface WebSocketState {
  connected: boolean;
  lastTick: TickMessage | null;
  messageCount: number;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [state, setState] = useState<WebSocketState>({
    connected: false,
    lastTick: null,
    messageCount: 0,
  });
  const messageCountRef = useRef(0);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;

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
        messageCountRef.current++;
        setState((s) => ({
          ...s,
          lastTick: tick,
          messageCount: messageCountRef.current,
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
    messageCountRef.current = 0;
    setState({ connected: false, lastTick: null, messageCount: 0 });
  }, []);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  return { ...state, connect, disconnect };
}
