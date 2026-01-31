// client/src/components/ConfigPanel.tsx
import { useState, useEffect } from 'react';

const CONFIG_URL = 'http://localhost:8081/config';

interface ServerConfig {
  rate: number;
  rampEnabled: boolean;
  rampPercent: number;
  rampIntervalSec: number;
}

export function ConfigPanel() {
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [rateInput, setRateInput] = useState('100');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig();
  }, []);

  async function fetchConfig() {
    try {
      setError(null);
      const res = await fetch(CONFIG_URL);
      const data = await res.json();
      setConfig(data);
      setRateInput(String(data.rate));
    } catch (e) {
      console.error('Failed to fetch config:', e);
      setError('Failed to fetch config from server');
    }
  }

  function validateRate(value: string): number | null {
    const num = Number(value);
    if (isNaN(num)) {
      setError('Rate must be a valid number');
      return null;
    }
    if (num <= 0) {
      setError('Rate must be greater than zero');
      return null;
    }
    return num;
  }

  async function updateRate(newRate: number) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(CONFIG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate: newRate }),
      });
      const data = await res.json();
      setConfig(data);
      setRateInput(String(data.rate));
    } catch (e) {
      console.error('Failed to update config:', e);
      setError('Failed to update config on server');
    }
    setLoading(false);
  }

  function handleSetRate() {
    const validatedRate = validateRate(rateInput);
    if (validatedRate !== null) {
      updateRate(validatedRate);
    }
  }

  const presetRates = [100, 500, 1000, 5000, 10000, 50000];

  return (
    <div style={{ 
      backgroundColor: '#2a2a2a', 
      padding: '20px', 
      borderRadius: '8px',
      marginBottom: '20px',
      color: '#fff'
    }}>
      <h2 style={{ margin: '0 0 15px 0' }}>Server Config</h2>
      
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>
          Messages per second:
        </label>
        <input
          type="number"
          value={rateInput}
          onChange={(e) => setRateInput(e.target.value)}
          style={{ 
            padding: '8px', 
            marginRight: '10px',
            backgroundColor: '#333',
            border: '1px solid #555',
            color: '#fff',
            borderRadius: '4px'
          }}
        />
        <button 
          onClick={handleSetRate}
          disabled={loading}
          style={{
            padding: '8px 16px',
            backgroundColor: loading ? '#666' : '#4a9eff',
            border: 'none',
            borderRadius: '4px',
            color: loading ? '#999' : '#fff',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1
          }}
        >
          {loading ? 'Updating...' : 'Set Rate'}
        </button>
      </div>

      {error && (
        <div style={{
          marginBottom: '15px',
          padding: '10px',
          backgroundColor: '#4a2020',
          border: '1px solid #ff4444',
          borderRadius: '4px',
          color: '#ff6666',
          fontSize: '14px'
        }}>
          {error}
        </div>
      )}

      <div>
        <label style={{ display: 'block', marginBottom: '5px', color: '#888' }}>
          Presets:
        </label>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {presetRates.map((rate) => (
            <button
              key={rate}
              onClick={() => updateRate(rate)}
              disabled={loading}
              style={{
                padding: '6px 12px',
                backgroundColor: loading ? '#555' : (config?.rate === rate ? '#4a9eff' : '#444'),
                border: 'none',
                borderRadius: '4px',
                color: loading ? '#888' : '#fff',
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1
              }}
            >
              {rate >= 1000 ? `${rate / 1000}k` : rate}
            </button>
          ))}
        </div>
      </div>

      {config && (
        <div style={{ marginTop: '15px', color: '#888', fontSize: '12px' }}>
          Current rate: {config.rate} msg/sec
        </div>
      )}
    </div>
  );
}
