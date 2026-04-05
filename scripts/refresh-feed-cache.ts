/**
 * GitHub Actions: CoinGecko·Yahoo·네이버 → Supabase `dopamine_feed_cache` upsert.
 * 사용: cd server && npm run refresh-feed-cache
 *
 * 데이터가 없거나(빈 배열) 해당 구간에서 오류가 나면 그 id는 upsert 하지 않고 이전 캐시를 유지합니다.
 *
 * env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY
 * 관심 자산 DB 동기화(선택): CRON_API_BASE_URL + CRON_SECRET(Bearer, 프로덕션 API refresh용)
 */
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchCoinGeckoMarketRowsForCache } from "../src/lib/coingecko-markets";
import { FEED_CACHE_ID } from "../src/lib/feed-cache-constants";
import { buildRankedRowFromYahooDaily } from "../src/lib/feed-rankings-row";
import { FEED_UNIVERSE } from "../src/lib/feed-universe";
import {
  enrichKrStockRowsDisplayNamesFromYahooAndNaver,
  fetchKrStockRowsFromNaver,
} from "../src/lib/kr-stock";
import { fetchYahooDayMovers } from "../src/lib/yahoo-screener";
import { computeAllThemesRows } from "../src/lib/themes-service";
import { THEME_DEFINITIONS } from "../src/lib/theme-definitions";
import { getThemeAverageOhlcBars } from "../src/lib/theme-chart-service";
import type { RankedAssetDto } from "../src/lib/types";
import { THEME_CACHE_ID } from "../src/lib/theme-cache-constants";
import { syncInterestAssetScoresToSupabase } from "../src/lib/interest-assets-supabase-sync";

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

const STORE_GAINERS_N = 50;
const STORE_LOSERS_N = 50;

function pickGainersLosersForStore(rows: RankedAssetDto[]): RankedAssetDto[] {
  const gainers = rows
    .filter((r) => r.priceChangePct > 0)
    .sort((a, b) => {
      const d = b.priceChangePct - a.priceChangePct;
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    })
    .slice(0, STORE_GAINERS_N);

  const losers = rows
    .filter((r) => r.priceChangePct < 0)
    .sort((a, b) => {
      const d = a.priceChangePct - b.priceChangePct; // more negative first
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    })
    .slice(0, STORE_LOSERS_N);

  return [...gainers, ...losers];
}

async function upsertRankedFeedIfHasData(
  supabase: SupabaseClient,
  id: string,
  items: RankedAssetDto[],
): Promise<void> {
  if (items.length === 0) {
    console.warn(
      `[refresh-feed-cache] skip upsert dopamine_feed_cache id=${id} reason=no_items`,
    );
    return;
  }
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
    console.error(
      `[refresh-feed-cache] skip upsert dopamine_feed_cache id=${id} reason=supabase_error`,
      error,
    );
    return;
  }
  console.log(
    `[refresh-feed-cache] upserted dopamine_feed_cache id=${id} rows=${items.length} at ${updatedAt}`,
  );
}

async function upsertThemeCacheIfHasData(
  supabase: SupabaseClient,
  items: Awaited<ReturnType<typeof computeAllThemesRows>>,
): Promise<void> {
  if (items.length === 0) {
    console.warn(
      "[refresh-feed-cache] skip upsert dopamine_theme_cache reason=no_items",
    );
    return;
  }
  const themeUpdatedAt = new Date().toISOString();
  const { error } = await supabase.from("dopamine_theme_cache").upsert(
    {
      id: THEME_CACHE_ID,
      items,
      updated_at: themeUpdatedAt,
    },
    { onConflict: "id" },
  );
  if (error) {
    console.error(
      "[refresh-feed-cache] skip upsert dopamine_theme_cache reason=supabase_error",
      error,
    );
    return;
  }
  console.log(
    `[refresh-feed-cache] upserted dopamine_theme_cache rows=${items.length} at ${themeUpdatedAt}`,
  );
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

  console.log("[refresh-feed-cache] crypto (CoinGecko)…");
  try {
    const cryptoRows = await fetchCoinGeckoMarketRowsForCache({
      maxPages: 1,
    });
    const cryptoStore = pickGainersLosersForStore(cryptoRows);
    console.log(
      `[refresh-feed-cache] crypto store pre=${cryptoRows.length} store=${cryptoStore.length}`,
    );
    await upsertRankedFeedIfHasData(supabase, FEED_CACHE_ID.crypto, cryptoStore);
  } catch (e) {
    console.error(
      "[refresh-feed-cache] crypto section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] kr_stock (Naver)…");
  try {
    const krRows = await fetchKrStockRowsFromNaver();
    const krStore = pickGainersLosersForStore(krRows);
    console.log(
      `[refresh-feed-cache] kr_stock store pre=${krRows.length} store=${krStore.length}`,
    );
    console.log(
      "[refresh-feed-cache] kr_stock enrich name=Yahoo, nameKo=Naver (per symbol)…",
    );
    await enrichKrStockRowsDisplayNamesFromYahooAndNaver(krStore);
    await upsertRankedFeedIfHasData(supabase, FEED_CACHE_ID.kr_stock, krStore);
  } catch (e) {
    console.error(
      "[refresh-feed-cache] kr_stock section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] us_screener (Yahoo)…");
  try {
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
    const usScreenerRows = [...bySym.values()];
    const usScreenerStore = pickGainersLosersForStore(usScreenerRows);
    console.log(
      `[refresh-feed-cache] us_screener store pre=${usScreenerRows.length} store=${usScreenerStore.length}`,
    );
    await upsertRankedFeedIfHasData(
      supabase,
      FEED_CACHE_ID.us_screener,
      usScreenerStore,
    );
  } catch (e) {
    console.error(
      "[refresh-feed-cache] us_screener section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] us_universe (Yahoo daily)…");
  try {
    const usEntries = FEED_UNIVERSE.filter((e) => e.assetClass === "us_stock");
    const usUniverseRows: RankedAssetDto[] = [];
    for (const entry of usEntries) {
      const row = await buildRankedRowFromYahooDaily(entry);
      if (row) usUniverseRows.push(row);
      await sleep(75);
    }
    const usUniverseStore = pickGainersLosersForStore(usUniverseRows);
    console.log(
      `[refresh-feed-cache] us_universe store pre=${usUniverseRows.length} store=${usUniverseStore.length}`,
    );
    await upsertRankedFeedIfHasData(
      supabase,
      FEED_CACHE_ID.us_universe,
      usUniverseStore,
    );
  } catch (e) {
    console.error(
      "[refresh-feed-cache] us_universe section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] commodity (Yahoo daily)…");
  try {
    const commodityEntries = FEED_UNIVERSE.filter(
      (e) => e.assetClass === "commodity",
    );
    const commodityRows: RankedAssetDto[] = [];
    for (const entry of commodityEntries) {
      const row = await buildRankedRowFromYahooDaily(entry);
      if (row) commodityRows.push(row);
      await sleep(75);
    }
    const commodityStore = pickGainersLosersForStore(commodityRows);
    console.log(
      `[refresh-feed-cache] commodity store pre=${commodityRows.length} store=${commodityStore.length}`,
    );
    await upsertRankedFeedIfHasData(
      supabase,
      FEED_CACHE_ID.commodity,
      commodityStore,
    );
  } catch (e) {
    console.error(
      "[refresh-feed-cache] commodity section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] themes (Yahoo daily)…");
  try {
    const themeRows = await computeAllThemesRows();
    await upsertThemeCacheIfHasData(supabase, themeRows);
  } catch (e) {
    console.error(
      "[refresh-feed-cache] themes section failed, skip upsert",
      e,
    );
  }

  console.log("[refresh-feed-cache] interest assets (OpenAI / deployed API → Supabase)…");
  try {
    await syncInterestAssetScoresToSupabase(supabase);
  } catch (e) {
    console.error(
      "[refresh-feed-cache] interest assets sync failed, skip",
      e,
    );
  }

  console.log("[refresh-feed-cache] theme charts 3mo (Yahoo OHLC)…");
  const RANGE_DAYS_3MO = 92;
  for (const def of THEME_DEFINITIONS) {
    try {
      await getThemeAverageOhlcBars(def.id, RANGE_DAYS_3MO);
    } catch (e) {
      console.error(
        `[refresh-feed-cache] theme chart warm-up failed themeId=${def.id}`,
        e,
      );
    }
    await sleep(200);
  }

  console.log("[refresh-feed-cache] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
