import type { FeedCacheId } from "./feed-cache-constants";
import { getSupabaseAdmin } from "./supabase-admin";
import type { RankedAssetDto } from "./types";

/**
 * GitHub Actions `refresh-feed-cache`가 Supabase에 넣은 스냅샷.
 * 요청 경로에서는 서드파티 API를 부르지 않고 이 테이블만 읽는다.
 */
export async function fetchFeedCacheRows(
  id: FeedCacheId,
): Promise<{ rows: RankedAssetDto[]; cacheUpdatedAt: string | null }> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("dopamine_feed_cache")
      .select("items, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[feed-cache] supabase", id, error);
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
    console.error("[feed-cache]", id, e);
    return { rows: [], cacheUpdatedAt: null };
  }
}
