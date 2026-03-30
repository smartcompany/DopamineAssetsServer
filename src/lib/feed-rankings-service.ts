import { FEED_CACHE_ID } from "./feed-cache-constants";
import { fetchFeedCacheRows } from "./feed-cache";
import { clampLimit, resolveAssetClasses } from "./feed-query";
import type { RankedAssetDto } from "./types";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: FeedRankingsResponse }>();

export type FeedRankingsResponse = {
  asOf: string;
  volumeBasis: string;
  items: RankedAssetDto[];
};

function cacheKey(direction: string, searchParams: URLSearchParams): string {
  return `${direction}?${searchParams.toString()}`;
}

function parseSource(raw: string | null): "universe" | "yahoo_us" {
  if (raw === "yahoo_us") return "yahoo_us";
  return "universe";
}

function finalizeRankings(
  direction: "up" | "down",
  rows: RankedAssetDto[],
  limit: number,
): RankedAssetDto[] {
  const filtered =
    direction === "up"
      ? rows.filter((r) => r.priceChangePct > 0)
      : rows.filter((r) => r.priceChangePct < 0);

  if (direction === "up") {
    filtered.sort((a, b) => {
      const d = b.priceChangePct - a.priceChangePct;
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    });
  } else {
    filtered.sort((a, b) => {
      const d = a.priceChangePct - b.priceChangePct;
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    });
  }

  return filtered.slice(0, limit);
}

/**
 * 랭킹은 Supabase `dopamine_feed_cache`만 사용한다 (GitHub Actions가 주기 갱신).
 * 요청당 서드파티(Yahoo·네이버·CoinGecko) 호출 없음.
 */
export async function getFeedRankings(
  direction: "up" | "down",
  searchParams: URLSearchParams,
): Promise<FeedRankingsResponse> {
  const key = cacheKey(direction, searchParams);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.body;
  }

  const limit = clampLimit(searchParams.get("limit"));
  const source = parseSource(searchParams.get("source"));
  const include = searchParams.get("include");
  const exclude = searchParams.get("exclude");

  let classes;
  try {
    classes = resolveAssetClasses(include, exclude);
  } catch (e) {
    throw e;
  }

  let rows: RankedAssetDto[] = [];
  const basisParts: string[] = [];

  if (source === "yahoo_us") {
    if (classes.has("us_stock")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.us_screener);
      rows = [...rows, ...r];
      basisParts.push("supabase_us_screener");
    }
    if (classes.has("crypto")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.crypto);
      rows = [...rows, ...r];
      basisParts.push("supabase_crypto_coingecko");
    }
    if (classes.has("kr_stock")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.kr_stock);
      rows = [...rows, ...r];
      basisParts.push("supabase_kr_naver");
    }
    if (classes.has("commodity")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.commodity);
      rows = [...rows, ...r];
      basisParts.push("supabase_commodity_yahoo");
    }
  } else {
    if (classes.has("us_stock")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.us_universe);
      rows = [...rows, ...r];
      basisParts.push("supabase_us_universe_yahoo");
    }
    if (classes.has("crypto")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.crypto);
      rows = [...rows, ...r];
      basisParts.push("supabase_crypto_coingecko");
    }
    if (classes.has("kr_stock")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.kr_stock);
      rows = [...rows, ...r];
      basisParts.push("supabase_kr_naver");
    }
    if (classes.has("commodity")) {
      const { rows: r } = await fetchFeedCacheRows(FEED_CACHE_ID.commodity);
      rows = [...rows, ...r];
      basisParts.push("supabase_commodity_yahoo");
    }
  }

  const items = finalizeRankings(direction, rows, limit);

  const body: FeedRankingsResponse = {
    asOf: new Date().toISOString(),
    volumeBasis: basisParts.join(";") || "supabase_feed_cache",
    items,
  };

  cache.set(key, { at: Date.now(), body });
  return body;
}
