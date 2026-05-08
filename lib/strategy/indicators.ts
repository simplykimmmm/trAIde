type CandleLike = {
  high: number;
  low: number;
  close: number;
};

export type StrategyRegime = "TRENDING" | "RANGE_BOUND" | "HIGH_VOLATILITY" | "OVERSOLD_BOUNCE" | "UNCONFIRMED";

export type IndicatorSnapshot = {
  rsi2?: number;
  rsi14?: number;
  atrPct?: number;
  smaFast?: number;
  smaSlow?: number;
  trendPct?: number;
  regime: StrategyRegime;
};

export function buildIndicatorSnapshot(candles: CandleLike[]): IndicatorSnapshot {
  const closes = candles.map((candle) => candle.close).filter((close) => Number.isFinite(close) && close > 0);
  if (closes.length < 5) {
    return { regime: "UNCONFIRMED" };
  }

  const rsi2 = calculateRsi(closes, 2);
  const rsi14 = calculateRsi(closes, 14);
  const atr = calculateAtr(candles, Math.min(14, candles.length - 1));
  const last = closes[closes.length - 1];
  const smaFast = calculateSma(closes, Math.min(5, closes.length));
  const smaSlow = calculateSma(closes, Math.min(20, closes.length));
  const atrPct = atr && last > 0 ? atr / last : undefined;
  const trendPct = smaFast && smaSlow && smaSlow > 0 ? (smaFast - smaSlow) / smaSlow : undefined;

  return {
    rsi2: round(rsi2),
    rsi14: round(rsi14),
    atrPct: round(atrPct, 4),
    smaFast: round(smaFast),
    smaSlow: round(smaSlow),
    trendPct: round(trendPct, 4),
    regime: classifyRegime({ rsi2, rsi14, atrPct, trendPct }),
  };
}

function classifyRegime(snapshot: Omit<IndicatorSnapshot, "regime" | "smaFast" | "smaSlow">): StrategyRegime {
  if (typeof snapshot.atrPct === "number" && snapshot.atrPct >= 0.035) {
    return "HIGH_VOLATILITY";
  }

  if (typeof snapshot.rsi2 === "number" && snapshot.rsi2 <= 20) {
    return "OVERSOLD_BOUNCE";
  }

  if (typeof snapshot.trendPct === "number" && Math.abs(snapshot.trendPct) >= 0.003 && typeof snapshot.rsi14 === "number" && snapshot.rsi14 >= 45 && snapshot.rsi14 <= 75) {
    return "TRENDING";
  }

  if (typeof snapshot.atrPct === "number" && snapshot.atrPct < 0.02) {
    return "RANGE_BOUND";
  }

  return "UNCONFIRMED";
}

function calculateSma(values: number[], period: number): number | undefined {
  if (values.length < period || period <= 0) {
    return undefined;
  }

  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

function calculateRsi(closes: number[], period: number): number | undefined {
  if (closes.length <= period || period <= 0) {
    return undefined;
  }

  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let index = 1; index < slice.length; index += 1) {
    const delta = slice[index] - slice[index - 1];
    if (delta >= 0) {
      gains += delta;
    } else {
      losses += Math.abs(delta);
    }
  }

  if (losses === 0) {
    return 100;
  }

  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

function calculateAtr(candles: CandleLike[], period: number): number | undefined {
  if (candles.length <= period || period <= 0) {
    return undefined;
  }

  const recent = candles.slice(-(period + 1));
  const trueRanges: number[] = [];

  for (let index = 1; index < recent.length; index += 1) {
    const current = recent[index];
    const previous = recent[index - 1];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }

  return trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length;
}

function round(value: number | undefined, digits = 2): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Number(value.toFixed(digits));
}
