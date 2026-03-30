import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { RankedAssetDto } from "@/lib/types";

import { CRYPTO_FEED_CACHE_ID } from "./crypto-feed-cache-constants";

export { CRYPTO_FEED_CACHE_ID };

/**
 * GitHub Actions가 `fetchBybitSpotAllTickerRows` 결과를 Supabase에 넣은 스냅샷.
 * Vercel에서는 Bybit을 직접 호출하지 않고 이것만 읽는다.
 */
export async function fetchCachedCryptoRowsFromSupabase(): Promise<{
  rows: RankedAssetDto[];
  cacheUpdatedAt: string | null;
}> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dopamine_crypto_feed_cache")
      .select("items, updated_at")
      .eq("id", CRYPTO_FEED_CACHE_ID)
      .maybeSingle();

    if (error) {
      console.error("[crypto-feed-cache] supabase", error);
      return { rows: [], cacheUpdatedAt: null };
    }
    if (!data?.items) {
      return { rows: [], cacheUpdatedAt: null };
    }
    const raw = data.items;
    if (!Array.isArray(raw)) {
      return { rows: [], cacheUpdatedAt: null };
    }
    const rows = raw as RankedAssetDto[];
    const updated =
      typeof data.updated_at === "string" ? data.updated_at : null;
    return { rows, cacheUpdatedAt: updated };
  } catch (e) {
    console.error("[crypto-feed-cache]", e);
    return { rows: [], cacheUpdatedAt: null };
  }
}
