// server/src/generator.ts
export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

export const SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'] as const;
export type SymbolType = typeof SYMBOLS[number];

// Symbol to index mapping for binary encoding
export const SYMBOL_TO_INDEX: Record<SymbolType, number> = {
  'BTC': 0,
  'ETH': 1,
  'SOL': 2,
  'DOGE': 3,
  'XRP': 4,
};

// Index to symbol mapping for binary decoding
export const INDEX_TO_SYMBOL: Record<number, SymbolType> = {
  0: 'BTC',
  1: 'ETH',
  2: 'SOL',
  3: 'DOGE',
  4: 'XRP',
};

const prices: Map<string, number> = new Map([
  ['BTC', 50000],
  ['ETH', 3000],
  ['SOL', 100],
  ['DOGE', 0.1],
  ['XRP', 0.5],
]);

export function generateTick(): TickMessage {
  const symbol = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const currentPrice = prices.get(symbol)!;
  
  // Random walk: -0.1% to +0.1%
  const change = currentPrice * (Math.random() - 0.5) * 0.002;
  const newPrice = Math.max(0.0001, currentPrice + change);
  prices.set(symbol, newPrice);
  
  return {
    symbol,
    price: Number(newPrice.toFixed(6)),
    ts: Date.now(),
  };
}

/**
 * Binary tick format (20 bytes):
 * - Bytes 0-3: symbol as u32 little-endian (0=BTC, 1=ETH, 2=SOL, 3=DOGE, 4=XRP)
 * - Bytes 4-11: price as f64 little-endian
 * - Bytes 12-19: timestamp as i64 little-endian (BigInt)
 */
export const BINARY_TICK_SIZE = 20;

// Pre-allocate buffer for encoding
const encodeBuffer = Buffer.alloc(BINARY_TICK_SIZE);

export function generateTickBinary(): Buffer {
  const tick = generateTick();
  
  // Write symbol index (u32)
  encodeBuffer.writeUInt32LE(SYMBOL_TO_INDEX[tick.symbol as SymbolType], 0);
  // Write price (f64)
  encodeBuffer.writeDoubleLE(tick.price, 4);
  // Write timestamp (i64 as BigInt)
  encodeBuffer.writeBigInt64LE(BigInt(tick.ts), 12);
  
  // Return a copy (important for high-freq where we reuse the buffer)
  return Buffer.from(encodeBuffer);
}

// For high-frequency mode: encode directly into provided buffer
export function encodeTickInto(buffer: Buffer, offset: number = 0): void {
  const tick = generateTick();
  buffer.writeUInt32LE(SYMBOL_TO_INDEX[tick.symbol as SymbolType], offset);
  buffer.writeDoubleLE(tick.price, offset + 4);
  buffer.writeBigInt64LE(BigInt(tick.ts), offset + 12);
}

// Decode binary buffer to TickMessage (for testing/debugging)
export function decodeBinaryTick(buffer: Buffer): TickMessage {
  const symbolIndex = buffer.readUInt32LE(0);
  const price = buffer.readDoubleLE(4);
  const ts = Number(buffer.readBigInt64LE(12));
  
  return {
    symbol: INDEX_TO_SYMBOL[symbolIndex] || 'BTC',
    price,
    ts,
  };
}
