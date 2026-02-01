// client/src/App.tsx
import { useState, useEffect } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import { useRustWebSocket } from './hooks/useRustWebSocket';
import { ConfigPanel } from './components/ConfigPanel';

const WS_URL = 'ws://localhost:8080';

type WebSocketMode = 'js' | 'rust';

// Get initial mode from URL query param (for browser testing)
function getInitialModeFromUrl(): WebSocketMode | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  if (mode === 'rust') return 'rust';
  if (mode === 'js') return 'js';
  return null;
}

// Detect Tauri environment more reliably
function detectTauri(): boolean {
  return '__TAURI__' in window || 
         '__TAURI_INTERNALS__' in window ||
         navigator.userAgent.includes('Tauri');
}

function App() {
  const isTauri = detectTauri();
  const [wsMode, setWsMode] = useState<WebSocketMode>('js');
  const [modeInitialized, setModeInitialized] = useState(false);

  // Initialize mode from URL param or Tauri env var
  useEffect(() => {
    const initMode = async () => {
      // First check URL param (works for both browser and Tauri)
      const urlMode = getInitialModeFromUrl();
      if (urlMode) {
        setWsMode(urlMode);
        setModeInitialized(true);
        return;
      }

      // If in Tauri, check env var via command
      if (isTauri) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const envMode = await invoke<string>('get_test_mode');
          if (envMode === 'rust') {
            setWsMode('rust');
          }
        } catch (e) {
          console.error('Failed to get test mode:', e);
        }
      }
      setModeInitialized(true);
    };
    initMode();
  }, []);
  
  // Auto-connect is enabled once mode is initialized
  // For JS mode: JS WebSocket auto-connects
  // For Rust mode in Tauri: Rust WebSocket auto-connects
  const jsAutoConnect = modeInitialized && wsMode === 'js';
  const rustAutoConnect = modeInitialized && wsMode === 'rust' && isTauri;
  
  const jsWs = useWebSocket(WS_URL, jsAutoConnect);
  const rustWs = useRustWebSocket(WS_URL, rustAutoConnect);
  
  // Select active WebSocket based on mode
  const ws = wsMode === 'rust' && isTauri ? rustWs : jsWs;
  
  // Normalize metrics for display
  const metrics = wsMode === 'rust' && isTauri && rustWs.metrics ? {
    messagesPerSecond: rustWs.metrics.messages_per_sec,
    totalMessages: rustWs.metrics.total_messages,
    avgLatencyMs: Math.round(rustWs.metrics.avg_latency_ms * 100) / 100,
    p99LatencyMs: 0, // Not tracked in Rust version
    elapsedSeconds: 0, // Not tracked in Rust version
  } : jsWs.metrics;

  const lastTick = wsMode === 'rust' && isTauri ? rustWs.lastTick : jsWs.lastTick;
  const connected = ws.connected;

  const handleModeChange = async (newMode: WebSocketMode) => {
    // Disconnect current connection before switching
    if (wsMode === 'js') {
      await jsWs.disconnect();
    } else {
      await rustWs.disconnect();
    }
    setWsMode(newMode);
  };

  // When switching to a new mode, connect after a short delay
  useEffect(() => {
    if (wsMode === 'rust' && isTauri && !rustWs.connected) {
      const timer = setTimeout(() => {
        rustWs.connect();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [wsMode, isTauri, rustWs]);

  // Get mode badge info
  const getModeInfo = () => {
    if (!isTauri) return { label: 'Browser', color: '#2563eb' };
    if (wsMode === 'rust') return { label: 'Tauri Rust', color: '#f97316' };
    return { label: 'Tauri JS', color: '#7c3aed' };
  };
  
  const modeInfo = getModeInfo();

  return (
    <div style={{ 
      padding: '20px', 
      fontFamily: 'monospace',
      backgroundColor: '#121212',
      minHeight: '100vh',
      color: '#fff'
    }}>
      <h1 style={{ marginBottom: '20px', display: 'flex', alignItems: 'center' }}>
        Tick Bench
        <div style={{ 
          display: 'inline-block',
          padding: '4px 8px',
          backgroundColor: modeInfo.color,
          borderRadius: '4px',
          fontSize: '12px',
          marginLeft: '10px'
        }}>
          {modeInfo.label}
        </div>
      </h1>

      {/* Mode Selector - Only show in Tauri */}
      {isTauri && (
        <div style={{ 
          marginBottom: '20px',
          padding: '15px',
          backgroundColor: '#1a1a1a',
          borderRadius: '8px'
        }}>
          <div style={{ marginBottom: '10px', color: '#888', fontSize: '12px' }}>WebSocket Mode</div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => handleModeChange('js')}
              disabled={connected}
              style={{
                padding: '8px 16px',
                backgroundColor: wsMode === 'js' ? '#7c3aed' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: connected ? 'not-allowed' : 'pointer',
                opacity: connected ? 0.5 : 1,
              }}
            >
              JS WebSocket
            </button>
            <button
              onClick={() => handleModeChange('rust')}
              disabled={connected}
              style={{
                padding: '8px 16px',
                backgroundColor: wsMode === 'rust' ? '#f97316' : '#333',
                border: 'none',
                borderRadius: '4px',
                color: '#fff',
                cursor: connected ? 'not-allowed' : 'pointer',
                opacity: connected ? 0.5 : 1,
              }}
            >
              Rust WebSocket
            </button>
          </div>
          {connected && (
            <div style={{ marginTop: '8px', color: '#f97316', fontSize: '12px' }}>
              Disconnect to switch modes
            </div>
          )}
        </div>
      )}
      
      <div style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ 
          padding: '8px 12px',
          backgroundColor: connected ? '#166534' : '#7f1d1d',
          borderRadius: '4px',
          fontSize: '14px'
        }}>
          {connected ? '🟢 Connected' : '🔴 Connecting...'}
        </span>
        <button 
          onClick={ws.disconnect} 
          disabled={!connected}
          style={{
            padding: '10px 20px',
            backgroundColor: !connected ? '#333' : '#ef4444',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: !connected ? 'default' : 'pointer',
            opacity: !connected ? 0.5 : 1,
          }}
        >
          Disconnect
        </button>
        <button 
          onClick={ws.resetMetrics}
          style={{
            padding: '10px 20px',
            backgroundColor: '#333',
            border: 'none',
            borderRadius: '4px',
            color: '#fff',
            cursor: 'pointer'
          }}
        >
          Reset Metrics
        </button>
      </div>

      <ConfigPanel />

      {/* Error display for Rust mode */}
      {wsMode === 'rust' && rustWs.error && (
        <div style={{ 
          backgroundColor: '#7f1d1d', 
          padding: '15px', 
          borderRadius: '8px',
          marginBottom: '20px',
          color: '#fca5a5'
        }}>
          <strong>Error:</strong> {rustWs.error}
        </div>
      )}

      {metrics && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          <h2 style={{ margin: '0 0 15px 0' }}>Metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Messages/sec</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.messagesPerSecond.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Messages</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.totalMessages.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.avgLatencyMs}ms</div>
            </div>
            {wsMode === 'js' && (
              <div>
                <div style={{ color: '#888', fontSize: '12px' }}>P99 Latency</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.p99LatencyMs}ms</div>
              </div>
            )}
          </div>
          {wsMode === 'js' && metrics.elapsedSeconds > 0 && (
            <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
              Running for {metrics.elapsedSeconds}s
            </div>
          )}
        </div>
      )}

      {lastTick && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '15px', 
          borderRadius: '8px'
        }}>
          <strong>Last tick:</strong> {lastTick.symbol} ${lastTick.price.toFixed(4)}
        </div>
      )}
    </div>
  );
}

export default App;
