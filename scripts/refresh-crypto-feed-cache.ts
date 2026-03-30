/**
 * GitHub Actions에서 실행: Bybit(러너 IP) → Supabase upsert.
 * 사용: cd server && npx tsx scripts/refresh-crypto-feed-cache.ts
 *
 * env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_KEY
 */
import { createClient } from "@supabase/supabase-js";

import { CRYPTO_FEED_CACHE_ID } from "../src/lib/crypto-feed-cache-constants";
import { fetchBybitSpotAllTickerRows } from "../src/lib/bybit-spot";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_KEY?.trim();
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_KEY",
    );
    process.exit(1);
  }

  console.log("[refresh-crypto-feed-cache] fetching Bybit spot tickers...");
  const items = await fetchBybitSpotAllTickerRows();
  console.log(`[refresh-crypto-feed-cache] rows=${items.length}`);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const updatedAt = new Date().toISOString();
  const { error } = await supabase.from("dopamine_crypto_feed_cache").upsert(
    {
      id: CRYPTO_FEED_CACHE_ID,
      items,
      updated_at: updatedAt,
    },
    { onConflict: "id" },
  );

  if (error) {
    console.error("[refresh-crypto-feed-cache] upsert failed", error);
    process.exit(1);
  }

  console.log("[refresh-crypto-feed-cache] ok", updatedAt);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
