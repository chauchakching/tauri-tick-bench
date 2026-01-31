// server/src/generator.ts
export interface TickMessage {
  symbol: string;
  price: number;
  ts: number;
}

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'DOGE', 'XRP'];
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
