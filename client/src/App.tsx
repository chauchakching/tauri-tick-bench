// client/src/App.tsx
import { useWebSocket } from './hooks/useWebSocket';

const WS_URL = 'ws://localhost:8080';

function App() {
  const { connected, lastTick, messageCount, connect, disconnect } = useWebSocket(WS_URL);

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
        <span style={{ marginLeft: '20px' }}>
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </span>
      </div>

      <div style={{ marginBottom: '20px' }}>
        <strong>Messages received:</strong> {messageCount}
      </div>

      {lastTick && (
        <div>
          <strong>Last tick:</strong>
          <pre>{JSON.stringify(lastTick, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

export default App;
