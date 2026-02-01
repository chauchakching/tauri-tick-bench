#!/usr/bin/env npx tsx
// scripts/run-benchmark.ts
// Automated benchmark runner for tick-bench

import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer, { Browser } from 'puppeteer';

const execAsync = promisify(exec);

// Puppeteer browser instance
let browser: Browser | null = null;

// Parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const config = {
    modes: ['browser-js', 'tauri-js', 'tauri-rust'] as string[],
    rate: 500_000,
    duration: 10,
    serverMode: 'ws' as 'ws' | 'uws',
    browserMode: 'headless' as 'headless' | 'default',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--mode' || arg === '-m') {
      const mode = args[++i];
      if (mode === 'all') {
        config.modes = ['browser-js', 'tauri-js', 'tauri-rust'];
      } else if (['browser-js', 'tauri-js', 'tauri-rust', 'browser', 'tauri'].includes(mode)) {
        if (mode === 'browser') config.modes = ['browser-js'];
        else if (mode === 'tauri') config.modes = ['tauri-js', 'tauri-rust'];
        else config.modes = [mode];
      } else {
        console.error(`Unknown mode: ${mode}`);
        process.exit(1);
      }
    } else if (arg === '--rate' || arg === '-r') {
      config.rate = parseInt(args[++i], 10);
    } else if (arg === '--duration' || arg === '-d') {
      config.duration = parseInt(args[++i], 10);
    } else if (arg === '--server-mode' || arg === '-s') {
      const mode = args[++i];
      if (mode === 'ws' || mode === 'uws') {
        config.serverMode = mode;
      } else {
        console.error(`Unknown server mode: ${mode}. Use 'ws' or 'uws'`);
        process.exit(1);
      }
    } else if (arg === '--browser' || arg === '-b') {
      const mode = args[++i];
      if (mode === 'headless' || mode === 'default') {
        config.browserMode = mode;
      } else {
        console.error(`Unknown browser mode: ${mode}. Use 'headless' or 'default'`);
        process.exit(1);
      }
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage: npx tsx scripts/run-benchmark.ts [options]

Options:
  -m, --mode <mode>      Mode to test: browser-js, tauri-js, tauri-rust, browser, tauri, all
                         (default: all)
  -s, --server-mode <m>  Server mode: ws or uws (default: ws)
  -b, --browser <mode>   Browser mode: headless (Chromium) or default (your browser)
                         (default: headless)
  -r, --rate <number>    Target message rate per second (default: 500000)
  -d, --duration <sec>   Test duration in seconds (default: 10)
  -h, --help             Show this help

Examples:
  npx tsx scripts/run-benchmark.ts --mode tauri-rust --rate 500000 --duration 15
  npx tsx scripts/run-benchmark.ts -m browser -b default   # Use your default browser
  npx tsx scripts/run-benchmark.ts --server-mode uws -m browser
  npm run benchmark -- --mode tauri-rust
`);
      process.exit(0);
    }
  }

  return config;
}

const ARGS = parseArgs();

const CONFIG = {
  testDurationSec: ARGS.duration,
  serverWsPort: 8080,
  serverHttpPort: 8081,
  clientDevPort: 5173,
  messageRate: ARGS.rate,
  modes: ARGS.modes,
  serverMode: ARGS.serverMode,
  browserMode: ARGS.browserMode,
};

interface ClientStats {
  messagesPerSec: number;
  totalMessages: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

interface ServerStats {
  serverRate: number;
  targetRate: number;
  clients: Record<string, ClientStats>;
}

interface TestResult {
  mode: string;
  clientMsgPerSec: number;
  serverActualRate: number;
  totalMessages: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  efficiency: number;
}

interface BenchmarkResults {
  timestamp: string;
  config: typeof CONFIG;
  results: TestResult[];
}

// Track child processes for cleanup
const childProcesses: ChildProcess[] = [];

// Helper to wait
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Check if port is in use
async function isPortInUse(port: number): Promise<boolean> {
  try {
    await execAsync(`lsof -i :${port} | grep LISTEN`);
    return true;
  } catch {
    return false;
  }
}

// Kill process on port and wait until it's free
async function killPort(port: number): Promise<void> {
  try {
    await execAsync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`);
  } catch {
    // Ignore - port might not be in use
  }
  // Wait until port is actually free
  for (let i = 0; i < 20; i++) {
    if (!await isPortInUse(port)) return;
    await sleep(100);
  }
}

// Get the HTTP stats port based on server mode
function getStatsPort(): number {
  return CONFIG.serverMode === 'uws' ? CONFIG.serverWsPort : CONFIG.serverHttpPort;
}

// Fetch stats from server
async function fetchServerStats(): Promise<ServerStats | null> {
  try {
    const res = await fetch(`http://localhost:${getStatsPort()}/stats`);
    return await res.json();
  } catch {
    return null;
  }
}

// Clear stats on server
async function clearStats(): Promise<void> {
  try {
    await fetch(`http://localhost:${getStatsPort()}/stats`, { method: 'DELETE' });
  } catch {}
}

// Set message rate
async function setRate(rate: number): Promise<void> {
  await fetch(`http://localhost:${getStatsPort()}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate }),
  });
}

// Wait for server HTTP API to be ready
async function waitForServerReady(timeoutMs: number = 30000): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const stats = await fetchServerStats();
    if (stats !== null) return true;
    await sleep(200);
  }
  return false;
}

// Wait for client to connect (server reports it in stats)
async function waitForClient(clientId: string, timeoutMs: number = 120000): Promise<boolean> {
  const startTime = Date.now();
  process.stdout.write('   Waiting for connection');
  while (Date.now() - startTime < timeoutMs) {
    const stats = await fetchServerStats();
    if (stats?.clients[clientId]) {
      process.stdout.write(' ✓\n');
      return true;
    }
    process.stdout.write('.');
    await sleep(500);
  }
  process.stdout.write(' ✗\n');
  return false;
}

// Run the actual benchmark test - called once client is connected
async function runTest(clientId: string, durationSec: number): Promise<TestResult | null> {
  // Clear stats to start fresh
  await clearStats();
  
  console.log(`   Running test for ${durationSec}s...`);
  
  // Collect server rates during test
  const serverRates: number[] = [];
  for (let i = 0; i < durationSec; i++) {
    await sleep(1000);
    const stats = await fetchServerStats();
    if (stats?.serverRate) {
      serverRates.push(stats.serverRate);
    }
    // Show progress
    const clientStats = stats?.clients[clientId];
    if (clientStats) {
      process.stdout.write(`\r   [${i + 1}/${durationSec}s] Client: ${clientStats.messagesPerSec.toLocaleString()}/s, Server: ${stats?.serverRate?.toLocaleString() || '?'}/s    `);
    }
  }
  console.log(''); // New line after progress
  
  // Get final stats
  const finalStats = await fetchServerStats();
  const clientStats = finalStats?.clients[clientId];
  
  if (!clientStats || serverRates.length === 0) {
    return null;
  }
  
  const avgServerRate = Math.round(serverRates.reduce((a, b) => a + b, 0) / serverRates.length);
  const efficiency = avgServerRate > 0 ? (clientStats.messagesPerSec / avgServerRate * 100) : 0;
  
  return {
    mode: clientId,
    clientMsgPerSec: clientStats.messagesPerSec,
    serverActualRate: avgServerRate,
    totalMessages: clientStats.totalMessages,
    avgLatencyMs: clientStats.avgLatencyMs,
    p99LatencyMs: clientStats.p99LatencyMs,
    efficiency,
  };
}

// Start server and wait for it to be ready
async function startServer(): Promise<ChildProcess> {
  console.log(`📡 Starting server (${CONFIG.serverMode} mode)...`);
  
  await killPort(CONFIG.serverWsPort);
  if (CONFIG.serverMode === 'ws') {
    await killPort(CONFIG.serverHttpPort);
  }
  
  const command = CONFIG.serverMode === 'uws' ? 'dev:uws' : 'dev';
  const server = spawn('npm', ['run', command], {
    cwd: path.join(process.cwd(), 'server'),
    stdio: 'pipe',
    shell: true,
  });
  childProcesses.push(server);
  
  // Wait for HTTP API to respond
  if (!await waitForServerReady()) {
    throw new Error('Server failed to start');
  }
  
  console.log('   Server ready');
  return server;
}

// Start Vite and wait for it
async function startVite(): Promise<ChildProcess> {
  console.log('⚡ Starting Vite...');
  
  await killPort(CONFIG.clientDevPort);
  
  const vite = spawn('npm', ['run', 'dev'], {
    cwd: path.join(process.cwd(), 'client'),
    stdio: 'pipe',
    shell: true,
  });
  childProcesses.push(vite);
  
  // Wait for port to be listening
  for (let i = 0; i < 60; i++) {
    if (await isPortInUse(CONFIG.clientDevPort)) {
      console.log('   Vite ready');
      return vite;
    }
    await sleep(500);
  }
  
  throw new Error('Vite failed to start');
}

// Close Puppeteer browser
async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch {}
    browser = null;
  }
}

// Run browser test
async function runBrowserTest(): Promise<TestResult | null> {
  const browserLabel = CONFIG.browserMode === 'headless' ? 'browser-js (headless)' : 'browser-js (default)';
  console.log(`\n🌐 Testing: ${browserLabel}`);
  
  // Ensure Vite is running
  if (!await isPortInUse(CONFIG.clientDevPort)) {
    await startVite();
  }
  
  const url = `http://localhost:${CONFIG.clientDevPort}`;
  
  if (CONFIG.browserMode === 'headless') {
    // Headless Chromium via Puppeteer
    console.log(`   Launching headless Chromium...`);
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      
      const page = await browser.newPage();
      console.log(`   Opening ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (e) {
      console.log(`   ❌ Failed to launch browser: ${e}`);
      return null;
    }
  } else {
    // Default browser via macOS `open` command
    console.log(`   Opening in default browser: ${url}`);
    await execAsync(`open "${url}"`);
  }
  
  // Wait for client to connect to server
  if (!await waitForClient('browser-js', 30000)) {
    console.log('   ❌ Client did not connect');
    if (CONFIG.browserMode === 'headless') {
      await closeBrowser();
    }
    return null;
  }
  
  // Run test immediately after connection
  const result = await runTest('browser-js', CONFIG.testDurationSec);
  
  // Close browser
  if (CONFIG.browserMode === 'headless') {
    await closeBrowser();
  } else {
    // Close browser tab (macOS) - best effort
    try {
      await execAsync(`osascript -e 'tell application "System Events" to keystroke "w" using command down'`);
    } catch {}
  }
  
  if (result) {
    console.log(`   Result: ${result.clientMsgPerSec.toLocaleString()}/s (${result.efficiency.toFixed(1)}% efficiency)`);
  }
  
  return result;
}

// Run Tauri test
async function runTauriTest(mode: 'js' | 'rust'): Promise<TestResult | null> {
  const clientId = mode === 'rust' ? 'tauri-rust' : 'tauri-js';
  console.log(`\n🖥️  Testing: ${clientId}`);
  
  // Kill Vite - tauri:dev starts its own
  await killPort(CONFIG.clientDevPort);
  
  // Start Tauri
  console.log(`   Starting Tauri (mode=${mode})...`);
  const tauri = spawn('npm', ['run', 'tauri:dev'], {
    cwd: path.join(process.cwd(), 'client'),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, TICK_BENCH_MODE: mode, CI: '' },
  });
  childProcesses.push(tauri);
  
  // Wait for client to connect (includes build time)
  if (!await waitForClient(clientId, 180000)) { // 3 min for build
    console.log('   ❌ Client did not connect');
    tauri.kill('SIGTERM');
    return null;
  }
  
  // Run test immediately after connection
  const result = await runTest(clientId, CONFIG.testDurationSec);
  
  // Cleanup Tauri
  console.log('   Closing Tauri...');
  tauri.kill('SIGTERM');
  try {
    await execAsync('pkill -f "target/debug/app" 2>/dev/null');
    await execAsync('pkill -f "tauri dev" 2>/dev/null');
  } catch {}
  await killPort(CONFIG.clientDevPort);
  
  if (result) {
    console.log(`   Result: ${result.clientMsgPerSec.toLocaleString()}/s (${result.efficiency.toFixed(1)}% efficiency)`);
  }
  
  return result;
}

// Print results
function printResults(results: TestResult[]): void {
  console.log('\n' + '='.repeat(85));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(85));
  console.log(`Target rate: ${CONFIG.messageRate.toLocaleString()}/s`);
  console.log(`Test duration: ${CONFIG.testDurationSec}s per test`);
  console.log('');
  
  console.log(
    'Mode'.padEnd(15) +
    'Client'.padStart(12) +
    'Server'.padStart(12) +
    'Efficiency'.padStart(12) +
    'Avg Lat'.padStart(12) +
    'P99 Lat'.padStart(12)
  );
  console.log('-'.repeat(75));
  
  for (const r of results) {
    console.log(
      r.mode.padEnd(15) +
      `${r.clientMsgPerSec.toLocaleString()}/s`.padStart(12) +
      `${r.serverActualRate.toLocaleString()}/s`.padStart(12) +
      `${r.efficiency.toFixed(1)}%`.padStart(12) +
      `${r.avgLatencyMs.toFixed(1)}ms`.padStart(12) +
      `${r.p99LatencyMs.toFixed(1)}ms`.padStart(12)
    );
  }
  console.log('='.repeat(85));
  
  // Analysis
  console.log('\nAnalysis:');
  for (const r of results) {
    if (r.efficiency >= 95) {
      console.log(`  ${r.mode}: ✅ Keeping up with server (${r.efficiency.toFixed(1)}%)`);
    } else if (r.efficiency >= 50) {
      console.log(`  ${r.mode}: ⚠️  Partial bottleneck (${r.efficiency.toFixed(1)}%)`);
    } else {
      console.log(`  ${r.mode}: ❌ Client is bottleneck (${r.efficiency.toFixed(1)}%)`);
    }
  }
  
  // Server bottleneck check
  const avgServerRate = results.reduce((sum, r) => sum + r.serverActualRate, 0) / results.length;
  const serverEfficiency = (avgServerRate / CONFIG.messageRate) * 100;
  if (serverEfficiency < 50) {
    console.log(`\n  ⚠️  Server bottleneck: ${avgServerRate.toLocaleString()}/s (${serverEfficiency.toFixed(1)}% of target)`);
  }
}

// Save results
function saveResults(results: BenchmarkResults): void {
  const resultsDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }
  
  const filename = `benchmark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(resultsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Results saved to: ${filepath}`);
}

// Cleanup
async function cleanup() {
  console.log('\n🧹 Cleaning up...');
  
  // Close Puppeteer browser
  await closeBrowser();
  
  for (const proc of childProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }
  
  try { await execAsync('pkill -f "target/debug/app" 2>/dev/null'); } catch {}
  try { await execAsync('pkill -f "tauri dev" 2>/dev/null'); } catch {}
  try { await execAsync('pkill -f "tsx watch" 2>/dev/null'); } catch {}
  
  await killPort(CONFIG.serverWsPort);
  if (CONFIG.serverMode === 'ws') {
    await killPort(CONFIG.serverHttpPort);
  }
  await killPort(CONFIG.clientDevPort);
  
  console.log('   Done');
}

// Signal handlers
process.on('SIGINT', async () => {
  console.log('\n\nInterrupted!');
  await cleanup();
  process.exit(130);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(143);
});

// Main
async function main() {
  console.log('🚀 Tick Bench Benchmark');
  console.log(`   Target: ${CONFIG.messageRate.toLocaleString()}/s`);
  console.log(`   Duration: ${CONFIG.testDurationSec}s`);
  console.log(`   Modes: ${CONFIG.modes.join(', ')}`);
  console.log(`   Server: ${CONFIG.serverMode}`);
  if (CONFIG.modes.includes('browser-js')) {
    console.log(`   Browser: ${CONFIG.browserMode}`);
  }
  
  try {
    // Start server
    await startServer();
    
    // Set rate
    await setRate(CONFIG.messageRate);
    console.log(`   Rate configured: ${CONFIG.messageRate.toLocaleString()}/s`);
    
    const results: TestResult[] = [];
    
    // Run tests
    for (const mode of CONFIG.modes) {
      let result: TestResult | null = null;
      
      if (mode === 'browser-js') {
        result = await runBrowserTest();
      } else if (mode === 'tauri-js') {
        result = await runTauriTest('js');
      } else if (mode === 'tauri-rust') {
        result = await runTauriTest('rust');
      }
      
      if (result) results.push(result);
    }
    
    // Output
    if (results.length > 0) {
      printResults(results);
      saveResults({
        timestamp: new Date().toISOString(),
        config: CONFIG,
        results,
      });
    } else {
      console.log('\n❌ No results collected');
    }
    
  } finally {
    await cleanup();
  }
}

main().catch(async (err) => {
  console.error('Error:', err);
  await cleanup();
  process.exit(1);
});
