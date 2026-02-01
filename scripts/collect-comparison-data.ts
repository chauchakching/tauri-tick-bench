#!/usr/bin/env npx tsx
// scripts/collect-comparison-data.ts
// Runs 8 benchmarks (4 modes × 2 formats) and aggregates results

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// Configuration for the comparison run
const CONFIG = {
  serverMode: 'uws' as const,
  targetRate: 1_000_000,
  duration: 10,
};

// Test configurations to run
const TEST_CONFIGS: {
  mode: string;
  browserMode?: 'headless' | 'default';
  format: 'json' | 'binary';
  label: string;
}[] = [
  { mode: 'browser-js', browserMode: 'headless', format: 'json', label: 'browser-headless' },
  { mode: 'browser-js', browserMode: 'headless', format: 'binary', label: 'browser-headless' },
  { mode: 'browser-js', browserMode: 'default', format: 'json', label: 'browser-default' },
  { mode: 'browser-js', browserMode: 'default', format: 'binary', label: 'browser-default' },
  { mode: 'tauri-js', format: 'json', label: 'tauri-js' },
  { mode: 'tauri-js', format: 'binary', label: 'tauri-js' },
  { mode: 'tauri-rust', format: 'json', label: 'tauri-rust' },
  { mode: 'tauri-rust', format: 'binary', label: 'tauri-rust' },
];

// Output format
interface ComparisonResults {
  timestamp: string;
  server: 'uws';
  targetRate: number;
  duration: number;
  results: {
    mode: string;
    format: 'json' | 'binary';
    clientRate: number;
    serverRate: number;
    avgLatencyMs: number;
  }[];
}

// Helper to wait for user input
async function waitForEnter(message: string): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

// Run a single benchmark and return the result file path
async function runBenchmark(config: typeof TEST_CONFIGS[0]): Promise<string | null> {
  const args = [
    'tsx', 'scripts/run-benchmark.ts',
    '--mode', config.mode,
    '--server-mode', CONFIG.serverMode,
    '--rate', CONFIG.targetRate.toString(),
    '--duration', CONFIG.duration.toString(),
    '--format', config.format,
  ];

  // Add browser mode for browser tests
  if (config.browserMode) {
    args.push('--browser', config.browserMode);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running: ${config.label} + ${config.format}`);
  console.log(`Command: npx ${args.join(' ')}`);
  console.log('='.repeat(60));

  return new Promise((resolve) => {
    const proc = spawn('npx', args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`\n❌ Benchmark failed with code ${code}`);
        resolve(null);
        return;
      }

      // Find the most recent results file
      const resultsDir = path.join(process.cwd(), 'results');
      const files = fs.readdirSync(resultsDir)
        .filter(f => f.startsWith('benchmark-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length > 0) {
        resolve(path.join(resultsDir, files[0]));
      } else {
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      console.error(`\n❌ Failed to start benchmark: ${err.message}`);
      resolve(null);
    });
  });
}

// Parse a benchmark result file
function parseResultFile(filepath: string): { clientRate: number; serverRate: number; avgLatencyMs: number } | null {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);
    
    if (data.results && data.results.length > 0) {
      const result = data.results[0];
      return {
        clientRate: result.clientMsgPerSec,
        serverRate: result.serverActualRate,
        avgLatencyMs: result.avgLatencyMs,
      };
    }
  } catch (err) {
    console.error(`Failed to parse ${filepath}:`, err);
  }
  return null;
}

// Main
async function main() {
  console.log('🚀 Comparison Data Collection');
  console.log(`   Server: ${CONFIG.serverMode}`);
  console.log(`   Target rate: ${CONFIG.targetRate.toLocaleString()}/s`);
  console.log(`   Duration: ${CONFIG.duration}s per test`);
  console.log(`   Total tests: ${TEST_CONFIGS.length}`);
  console.log('');

  const results: ComparisonResults = {
    timestamp: new Date().toISOString(),
    server: 'uws',
    targetRate: CONFIG.targetRate,
    duration: CONFIG.duration,
    results: [],
  };

  // Track files before each run to identify new results
  const resultsDir = path.join(process.cwd(), 'results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  for (let i = 0; i < TEST_CONFIGS.length; i++) {
    const config = TEST_CONFIGS[i];
    
    // For browser-default mode, pause and ask user to focus the window
    if (config.browserMode === 'default') {
      console.log('\n' + '⚠️'.repeat(30));
      console.log('ATTENTION: Browser-default mode requires your default browser.');
      console.log('The benchmark will open your default browser.');
      console.log('Please be ready to focus the browser window for accurate results.');
      console.log('⚠️'.repeat(30));
      await waitForEnter('\nPress Enter when ready to start the test...');
    }

    const resultFile = await runBenchmark(config);
    
    if (resultFile) {
      const parsed = parseResultFile(resultFile);
      if (parsed) {
        results.results.push({
          mode: config.label,
          format: config.format,
          clientRate: parsed.clientRate,
          serverRate: parsed.serverRate,
          avgLatencyMs: parsed.avgLatencyMs,
        });
        console.log(`✅ Collected: ${config.label} + ${config.format} = ${parsed.clientRate.toLocaleString()}/s`);
      } else {
        console.log(`⚠️ Failed to parse results for ${config.label} + ${config.format}`);
      }
    } else {
      console.log(`⚠️ No results for ${config.label} + ${config.format}`);
    }

    // Brief pause between tests
    if (i < TEST_CONFIGS.length - 1) {
      console.log('\nWaiting 3s before next test...');
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Save aggregated results
  const dateStr = new Date().toISOString().split('T')[0];
  const outputFile = path.join(resultsDir, `comparison-${dateStr}.json`);
  fs.writeFileSync(outputFile, JSON.stringify(results, null, 2));
  
  console.log('\n' + '='.repeat(60));
  console.log('COLLECTION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total results: ${results.results.length}/${TEST_CONFIGS.length}`);
  console.log(`Output: ${outputFile}`);
  
  // Summary table
  if (results.results.length > 0) {
    console.log('\nSummary:');
    console.log('-'.repeat(50));
    console.log('Mode'.padEnd(20) + 'Format'.padEnd(10) + 'Client Rate');
    console.log('-'.repeat(50));
    for (const r of results.results) {
      console.log(
        r.mode.padEnd(20) +
        r.format.padEnd(10) +
        `${r.clientRate.toLocaleString()}/s`
      );
    }
    console.log('-'.repeat(50));
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
