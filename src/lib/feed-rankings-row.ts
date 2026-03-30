import { computeChangeFromDailyBars, dopamineScore } from "./feed-metrics";
import type { FeedUniverseEntry, RankedAssetDto } from "./types";
import { fetchYahooDailyBars } from "./yahoo-chart";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Yahoo 일봉 → 등락률·도파민 점수 (랭킹 API와 배치 리프레시 공통).
 */
export async function buildRankedRowFromYahooDaily(
  entry: FeedUniverseEntry,
): Promise<RankedAssetDto | null> {
  try {
    const bars = await fetchYahooDailyBars(entry.symbol, 21);
    const m = computeChangeFromDailyBars(bars);
    if (!m) return null;
    const score = dopamineScore(m.priceChangePct, m.volumeChangePct);
    const row: RankedAssetDto = {
      symbol: entry.symbol,
      name: entry.name,
      assetClass: entry.assetClass,
      priceChangePct: round2(m.priceChangePct),
      volumeChangePct: round2(m.volumeChangePct),
      dopamineScore: round2(score),
    };
    if (entry.commodityKind) {
      row.commodityKind = entry.commodityKind;
    }
    return row;
  } catch (e) {
    console.error(`[feed] skip ${entry.symbol}`, e);
    return null;
  }
}
