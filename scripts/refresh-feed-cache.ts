/**
 * GitHub Actions: CoinGecko·Yahoo·네이버 → Supabase `dopamine_feed_cache` upsert.
 * 사용: cd server && npm run refresh-feed-cache
 *
 * env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY
 */
import { createClient } from "@supabase/supabase-js";

import { fetchCoinGeckoMarketRowsForCache } from "../src/lib/coingecko-markets";
import { FEED_CACHE_ID } from "../src/lib/feed-cache-constants";
import { buildRankedRowFromYahooDaily } from "../src/lib/feed-rankings-row";
import { FEED_UNIVERSE } from "../src/lib/feed-universe";
import { fetchKrStockRowsFromNaver } from "../src/lib/kr-stock";
import { fetchYahooDayMovers } from "../src/lib/yahoo-screener";
import { computeAllThemesRows } from "../src/lib/themes-service";
import { THEME_DEFINITIONS } from "../src/lib/theme-definitions";
import { getThemeAverageOhlcBars } from "../src/lib/theme-chart-service";
import type { RankedAssetDto } from "../src/lib/types";
import { THEME_CACHE_ID } from "../src/lib/theme-cache-constants";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_KEY?.trim();
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_KEY",
    );
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const upsert = async (id: string, items: RankedAssetDto[]) => {
    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from("dopamine_feed_cache").upsert(
      {
        id,
        items,
        updated_at: updatedAt,
      },
      { onConflict: "id" },
    );
    if (error) {
      console.error(`[refresh-feed-cache] upsert failed id=${id}`, error);
      process.exit(1);
    }
    console.log(`[refresh-feed-cache] ${id} rows=${items.length} at ${updatedAt}`);
  };

  console.log("[refresh-feed-cache] crypto (CoinGecko)…");
  const cryptoRows = await fetchCoinGeckoMarketRowsForCache();
  await upsert(FEED_CACHE_ID.crypto, cryptoRows);

  console.log("[refresh-feed-cache] kr_stock (Naver)…");
  const krRows = await fetchKrStockRowsFromNaver();
  await upsert(FEED_CACHE_ID.kr_stock, krRows);

  console.log("[refresh-feed-cache] us_screener (Yahoo)…");
  const gainers = await fetchYahooDayMovers("gainers", 50);
  const losers = await fetchYahooDayMovers("losers", 50);
  const bySym = new Map<string, RankedAssetDto>();
  for (const r of [...gainers, ...losers]) {
    const prev = bySym.get(r.symbol);
    if (
      !prev ||
      Math.abs(r.priceChangePct) > Math.abs(prev.priceChangePct)
    ) {
      bySym.set(r.symbol, r);
    }
  }
  await upsert(FEED_CACHE_ID.us_screener, [...bySym.values()]);

  console.log("[refresh-feed-cache] us_universe (Yahoo daily)…");
  const usEntries = FEED_UNIVERSE.filter((e) => e.assetClass === "us_stock");
  const usUniverseRows: RankedAssetDto[] = [];
  for (const entry of usEntries) {
    const row = await buildRankedRowFromYahooDaily(entry);
    if (row) usUniverseRows.push(row);
    await sleep(75);
  }
  await upsert(FEED_CACHE_ID.us_universe, usUniverseRows);

  console.log("[refresh-feed-cache] commodity (Yahoo daily)…");
  const commodityEntries = FEED_UNIVERSE.filter(
    (e) => e.assetClass === "commodity",
  );
  const commodityRows: RankedAssetDto[] = [];
  for (const entry of commodityEntries) {
    const row = await buildRankedRowFromYahooDaily(entry);
    if (row) commodityRows.push(row);
    await sleep(75);
  }
  await upsert(FEED_CACHE_ID.commodity, commodityRows);

  console.log("[refresh-feed-cache] themes (Yahoo daily)…");
  const themeRows = await computeAllThemesRows();
  const themeUpdatedAt = new Date().toISOString();
  const { error: themeUpsertError } = await supabase
    .from("dopamine_theme_cache")
    .upsert(
      {
        id: THEME_CACHE_ID,
        items: themeRows,
        updated_at: themeUpdatedAt,
      },
      { onConflict: "id" },
    );
  if (themeUpsertError) {
    console.error("[refresh-feed-cache] theme upsert failed", themeUpsertError);
    process.exit(1);
  }

  console.log("[refresh-feed-cache] theme charts 3mo (Yahoo OHLC)…");
  // UI 기본이 '3mo'이므로, 먼저 3mo만 워밍업.
  // (1mo/1y는 요청 시 캐시가 생길 때까지 on-demand 계산될 수 있음)
  const RANGE_DAYS_3MO = 92;
  for (const def of THEME_DEFINITIONS) {
    await getThemeAverageOhlcBars(def.id, RANGE_DAYS_3MO);
    await sleep(200);
  }

  console.log("[refresh-feed-cache] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
