// server/src/config.ts
import { createServer, IncomingMessage, ServerResponse } from 'http';

export interface ServerConfig {
  rate: number;
  rampEnabled: boolean;
  rampPercent: number;
  rampIntervalSec: number;
}

const config: ServerConfig = {
  rate: 100,
  rampEnabled: false,
  rampPercent: 10,
  rampIntervalSec: 5,
};

type ConfigChangeCallback = (config: ServerConfig) => void;
let onConfigChange: ConfigChangeCallback | null = null;

export function setConfigChangeCallback(cb: ConfigChangeCallback) {
  onConfigChange = cb;
}

// Stats callbacks for HTTP endpoints
type StatsGetter = () => unknown;
type StatsClearer = () => void;
let getStats: StatsGetter | null = null;
let clearStats: StatsClearer | null = null;

export function setStatsCallbacks(getter: StatsGetter, clearer: StatsClearer) {
  getStats = getter;
  clearStats = clearer;
}

export function getConfig(): ServerConfig {
  return { ...config };
}

export function updateConfig(updates: Partial<ServerConfig>) {
  Object.assign(config, updates);
}

export function startConfigServer(port: number) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/config') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
      } else if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const updates = JSON.parse(body);
            Object.assign(config, updates);
            onConfigChange?.(config);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(config));
          } catch {
            res.writeHead(400);
            res.end('Invalid JSON');
          }
        });
      }
    } else if (req.url === '/stats') {
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const stats = getStats ? getStats() : {};
        res.end(JSON.stringify({ serverRate: config.rate, clients: stats }));
      } else if (req.method === 'DELETE') {
        clearStats?.();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ cleared: true }));
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    console.log(`Config server running on http://localhost:${port}`);
  });
}
