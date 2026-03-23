import type { DailyBar } from "./yahoo-chart";

/** 스펙 §2.1: 전일 봉 대비 최근 봉(당일·최종 세션) 종가·거래량 변화율 */
export function computeChangeFromDailyBars(bars: DailyBar[]): {
  priceChangePct: number;
  volumeChangePct: number;
} | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2]!;
  const curr = bars[bars.length - 1]!;
  if (!(prev.close > 0) || !(curr.close > 0)) return null;

  const priceChangePct = ((curr.close - prev.close) / prev.close) * 100;

  const pv = prev.volume;
  const cv = curr.volume;
  let volumeChangePct = 0;
  if (pv > 0 && Number.isFinite(cv)) {
    volumeChangePct = ((cv - pv) / pv) * 100;
  }

  return { priceChangePct, volumeChangePct };
}

export function dopamineScore(
  priceChangePct: number,
  volumeChangePct: number,
): number {
  return priceChangePct * 0.6 + volumeChangePct * 0.4;
}
