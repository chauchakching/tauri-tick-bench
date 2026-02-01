#!/usr/bin/env npx tsx
// scripts/run-benchmark.ts
// Automated benchmark runner for tick-bench

import { spawn, exec, ChildProcess } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

const CONFIG = {
  testDurationMs: 10_000,
  stabilizationMs: 2_000, // Wait for connection to stabilize
  serverWsPort: 8080,
  serverHttpPort: 8081,
  clientDevPort: 5173,
  messageRate: 500_000, // Messages per second to test
};

interface TestResult {
  mode: string;
  messagesPerSec: number;
  totalMessages: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
  serverActualRate: number;
}

interface BenchmarkResults {
  timestamp: string;
  config: typeof CONFIG;
  results: TestResult[];
}

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

// Kill process on port
async function killPort(port: number): Promise<void> {
  try {
    await execAsync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`);
    await sleep(500);
  } catch {
    // Ignore errors
  }
}

// Fetch stats from server
async function fetchStats(): Promise<Record<string, TestResult>> {
  const res = await fetch(`http://localhost:${CONFIG.serverHttpPort}/stats`);
  const data = await res.json();
  return data.clients || {};
}

// Clear stats on server
async function clearStats(): Promise<void> {
  await fetch(`http://localhost:${CONFIG.serverHttpPort}/stats`, { method: 'DELETE' });
}

// Set message rate
async function setRate(rate: number): Promise<void> {
  await fetch(`http://localhost:${CONFIG.serverHttpPort}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rate }),
  });
}

// Start server
async function startServer(): Promise<ChildProcess> {
  console.log('📡 Starting server...');
  
  // Kill any existing server
  await killPort(CONFIG.serverWsPort);
  await killPort(CONFIG.serverHttpPort);
  
  const server = spawn('npm', ['run', 'dev'], {
    cwd: path.join(process.cwd(), 'server'),
    stdio: 'pipe',
    shell: true,
  });
  
  // Wait for server to be ready
  let attempts = 0;
  while (attempts < 20) {
    if (await isPortInUse(CONFIG.serverWsPort)) {
      console.log('   Server ready');
      return server;
    }
    await sleep(500);
    attempts++;
  }
  
  throw new Error('Server failed to start');
}

// Start Vite dev server
async function startVite(): Promise<ChildProcess> {
  console.log('⚡ Starting Vite dev server...');
  
  const vite = spawn('npm', ['run', 'dev'], {
    cwd: path.join(process.cwd(), 'client'),
    stdio: 'pipe',
    shell: true,
  });
  
  // Wait for Vite to be ready
  let attempts = 0;
  while (attempts < 20) {
    if (await isPortInUse(CONFIG.clientDevPort)) {
      console.log('   Vite ready');
      return vite;
    }
    await sleep(500);
    attempts++;
  }
  
  throw new Error('Vite failed to start');
}


// Run browser test
async function runBrowserTest(): Promise<TestResult | null> {
  console.log('\n🌐 Testing: browser-js');
  
  // Clear previous stats
  await clearStats();
  
  // Open browser
  const url = `http://localhost:${CONFIG.clientDevPort}`;
  console.log(`   Opening ${url}`);
  await execAsync(`open "${url}"`);
  
  // Wait for connection + stabilization
  console.log(`   Waiting ${CONFIG.stabilizationMs}ms for stabilization...`);
  await sleep(CONFIG.stabilizationMs);
  
  // Clear stats again to start fresh measurement
  await clearStats();
  
  // Run test
  console.log(`   Running test for ${CONFIG.testDurationMs}ms...`);
  await sleep(CONFIG.testDurationMs);
  
  // Collect stats
  const stats = await fetchStats();
  const result = stats['browser-js'];
  
  // Close browser tab (macOS specific)
  try {
    await execAsync(`osascript -e 'tell application "System Events" to keystroke "w" using command down'`);
  } catch {
    console.log('   (Could not auto-close browser tab)');
  }
  
  if (result) {
    console.log(`   Result: ${result.messagesPerSec.toLocaleString()} msg/s`);
    return {
      mode: 'browser-js',
      messagesPerSec: result.messagesPerSec,
      totalMessages: result.totalMessages,
      avgLatencyMs: result.avgLatencyMs,
      p99LatencyMs: result.p99LatencyMs,
      serverActualRate: CONFIG.messageRate,
    };
  }
  
  console.log('   No stats collected');
  return null;
}

// Run Tauri test (dev mode)
async function runTauriTest(mode: 'js' | 'rust', vite: ChildProcess | null): Promise<TestResult | null> {
  const clientId = mode === 'rust' ? 'tauri-rust' : 'tauri-js';
  console.log(`\n🖥️  Testing: ${clientId}`);
  
  // Clear previous stats
  await clearStats();
  
  // Kill existing Vite if running (tauri:dev will start its own)
  if (vite) {
    vite.kill('SIGTERM');
    await killPort(CONFIG.clientDevPort);
    await sleep(1000);
  }
  
  // Run Tauri in dev mode with TICK_BENCH_MODE env var
  console.log(`   Starting Tauri dev (mode=${mode})...`);
  const tauri = spawn('npm', ['run', 'tauri:dev'], {
    cwd: path.join(process.cwd(), 'client'),
    stdio: 'pipe',
    shell: true,
    env: { ...process.env, TICK_BENCH_MODE: mode, CI: '' },
  });
  
  // Wait for Tauri to build and start (dev mode takes longer)
  const waitTime = CONFIG.stabilizationMs + 8000;
  console.log(`   Waiting ${waitTime}ms for app startup + stabilization...`);
  await sleep(waitTime);
  
  // Check if connected
  const preStats = await fetchStats();
  const connectedClients = Object.keys(preStats);
  console.log(`   Connected clients: ${connectedClients.length > 0 ? connectedClients.join(', ') : 'none'}`);
  if (preStats[clientId]) {
    console.log(`   Client ${clientId} connected ✓`);
  } else {
    console.log(`   Warning: ${clientId} not yet connected, waiting more...`);
    await sleep(5000);
    const retryStats = await fetchStats();
    console.log(`   After retry, clients: ${Object.keys(retryStats).join(', ') || 'none'}`);
  }
  
  // Clear stats to start fresh measurement
  await clearStats();
  
  // Run test
  console.log(`   Running test for ${CONFIG.testDurationMs}ms...`);
  await sleep(CONFIG.testDurationMs);
  
  // Collect stats
  const stats = await fetchStats();
  const result = stats[clientId];
  
  // Kill Tauri and related processes
  console.log('   Closing Tauri app...');
  tauri.kill('SIGTERM');
  try {
    await execAsync('pkill -f "target/debug/app"');
    await execAsync('pkill -f "tauri dev"');
  } catch {
    // Ignore
  }
  await killPort(CONFIG.clientDevPort);
  await sleep(1000);
  
  if (result) {
    console.log(`   Result: ${result.messagesPerSec.toLocaleString()} msg/s`);
    return {
      mode: clientId,
      messagesPerSec: result.messagesPerSec,
      totalMessages: result.totalMessages,
      avgLatencyMs: result.avgLatencyMs,
      p99LatencyMs: result.p99LatencyMs,
      serverActualRate: CONFIG.messageRate,
    };
  }
  
  console.log('   No stats collected');
  return null;
}

// Print results table
function printResults(results: TestResult[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log(`Target rate: ${CONFIG.messageRate.toLocaleString()} msg/sec`);
  console.log(`Test duration: ${CONFIG.testDurationMs / 1000}s per test`);
  console.log('');
  
  console.log('Mode'.padEnd(15) + 'Msg/sec'.padStart(12) + 'Avg Lat'.padStart(12) + 'P99 Lat'.padStart(12));
  console.log('-'.repeat(51));
  
  for (const r of results) {
    console.log(
      r.mode.padEnd(15) +
      r.messagesPerSec.toLocaleString().padStart(12) +
      `${r.avgLatencyMs.toFixed(1)}ms`.padStart(12) +
      `${r.p99LatencyMs.toFixed(1)}ms`.padStart(12)
    );
  }
  console.log('='.repeat(70));
}

// Save results to JSON
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

// Main
async function main() {
  console.log('🚀 Starting Tick Bench Benchmark');
  console.log(`   Rate: ${CONFIG.messageRate.toLocaleString()} msg/sec`);
  console.log(`   Duration: ${CONFIG.testDurationMs / 1000}s per test`);
  
  let server: ChildProcess | null = null;
  let vite: ChildProcess | null = null;
  
  try {
    // Start server
    server = await startServer();
    await sleep(1000);
    
    // Set rate
    await setRate(CONFIG.messageRate);
    console.log(`   Rate set to ${CONFIG.messageRate.toLocaleString()}`);
    
    // Start Vite (for browser test)
    vite = await startVite();
    await sleep(1000);
    
    const results: TestResult[] = [];
    
    // Run browser test
    const browserResult = await runBrowserTest();
    if (browserResult) results.push(browserResult);
    
    await sleep(2000);
    
    // Run Tauri JS test (will kill vite and start its own)
    const tauriJsResult = await runTauriTest('js', vite);
    vite = null; // vite was killed
    if (tauriJsResult) results.push(tauriJsResult);
    
    await sleep(2000);
    
    // Run Tauri Rust test
    const tauriRustResult = await runTauriTest('rust', null);
    if (tauriRustResult) results.push(tauriRustResult);
    
    // Print and save results
    if (results.length > 0) {
      printResults(results);
      
      const benchmarkResults: BenchmarkResults = {
        timestamp: new Date().toISOString(),
        config: CONFIG,
        results,
      };
      saveResults(benchmarkResults);
    } else {
      console.log('\n❌ No results collected');
    }
    
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    
    if (vite) {
      vite.kill('SIGTERM');
    }
    if (server) {
      server.kill('SIGTERM');
    }
    
    // Kill any remaining processes
    try {
      await execAsync('pkill -f "target/debug/app" 2>/dev/null');
      await execAsync('pkill -f "tauri dev" 2>/dev/null');
    } catch {}
    await killPort(CONFIG.serverWsPort);
    await killPort(CONFIG.serverHttpPort);
    await killPort(CONFIG.clientDevPort);
    
    console.log('   Done');
  }
}

main().catch(console.error);
