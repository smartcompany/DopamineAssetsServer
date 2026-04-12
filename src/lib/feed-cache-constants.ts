/** Supabase `dopamine_feed_cache.id` — GitHub Actions가 채우고 Vercel은 읽기만 */

export const FEED_CACHE_ID = {
  crypto: "crypto",
  kr_stock: "kr_stock",
  us_screener: "us_screener",
  us_universe: "us_universe",
  jp_stock: "jp_stock",
  cn_stock: "cn_stock",
  commodity: "commodity",
} as const;

export type FeedCacheId = (typeof FEED_CACHE_ID)[keyof typeof FEED_CACHE_ID];
