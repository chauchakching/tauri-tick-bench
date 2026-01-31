// client/src/App.tsx
import { useWebSocket } from './hooks/useWebSocket';

const WS_URL = 'ws://localhost:8080';

function App() {
  const { connected, lastTick, metrics, connect, disconnect, resetMetrics } = useWebSocket(WS_URL);

  return (
    <div style={{ padding: '20px', fontFamily: 'monospace' }}>
      <h1>Tick Bench</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button onClick={connect} disabled={connected}>
          Connect
        </button>
        <button onClick={disconnect} disabled={!connected} style={{ marginLeft: '10px' }}>
          Disconnect
        </button>
        <button onClick={resetMetrics} style={{ marginLeft: '10px' }}>
          Reset Metrics
        </button>
        <span style={{ marginLeft: '20px' }}>
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      {metrics && (
        <div style={{ 
          backgroundColor: '#1a1a1a', 
          padding: '20px', 
          borderRadius: '8px',
          marginBottom: '20px',
          color: '#fff'
        }}>
          <h2 style={{ margin: '0 0 15px 0' }}>Metrics</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Messages/sec</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.messagesPerSecond}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Total Messages</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.totalMessages.toLocaleString()}</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>Avg Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.avgLatencyMs}ms</div>
            </div>
            <div>
              <div style={{ color: '#888', fontSize: '12px' }}>P99 Latency</div>
              <div style={{ fontSize: '24px', fontWeight: 'bold' }}>{metrics.p99LatencyMs}ms</div>
            </div>
          </div>
          <div style={{ marginTop: '10px', color: '#888', fontSize: '12px' }}>
            Running for {metrics.elapsedSeconds}s
          </div>
        </div>
      )}

      {lastTick && (
        <div>
          <strong>Last tick:</strong> {lastTick.symbol} ${lastTick.price.toFixed(4)}
        </div>
      )}
    </div>
  );
}

export default App;
