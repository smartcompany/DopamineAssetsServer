import type { SupabaseClient } from "@supabase/supabase-js";

import type { InterestAssetCategory, InterestAssetsPayload } from "@/lib/interest-assets-openai";

export type InterestScoreHistoryEntry = {
  date: string;
  score: number;
  rank: number;
};

const ALLOWED: Set<InterestAssetCategory> = new Set([
  "stock_us",
  "stock_kr",
  "commodity",
  "crypto",
]);

function parseHistory(raw: unknown): InterestScoreHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: InterestScoreHistoryEntry[] = [];
  for (const x of raw) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date.trim() : "";
    const score =
      typeof o.score === "number" ? o.score : Number.parseFloat(String(o.score));
    const rank =
      typeof o.rank === "number" ? o.rank : Number.parseInt(String(o.rank), 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(score)) continue;
    if (!Number.isInteger(rank) || rank < 0) continue;
    out.push({ date, score, rank });
  }
  return out;
}

async function fetchPayloadFromDeployedApi(
  baseUrl: string,
  cronSecret: string | undefined,
): Promise<InterestAssetsPayload> {
  const root = baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = { Accept: "application/json" };
  const s = cronSecret?.trim();
  if (s) {
    headers.Authorization = `Bearer ${s}`;
  }
  const res = await fetch(`${root}/api/feed/interest-assets?refresh=1`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`interest_api_http_${res.status}: ${t.slice(0, 200)}`);
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (body.error) {
    throw new Error(`interest_api_error: ${String(body.error)}`);
  }
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const assets = body.assets;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(assets)) {
    throw new Error("interest_api_invalid_shape");
  }
  const normalized: InterestAssetsPayload = {
    date,
    assets: [],
  };
  for (const row of assets) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const symbol = typeof r.symbol === "string" ? r.symbol.trim() : "";
    const cat = typeof r.category === "string" ? r.category.trim() : "";
    const score =
      typeof r.score === "number" ? r.score : Number.parseFloat(String(r.score));
    const rank =
      typeof r.rank === "number" ? r.rank : Number.parseInt(String(r.rank), 10);
    if (
      !name ||
      !symbol ||
      !ALLOWED.has(cat as InterestAssetCategory) ||
      !Number.isFinite(score) ||
      !Number.isInteger(rank)
    ) {
      continue;
    }
    normalized.assets.push({
      rank,
      name,
      symbol,
      category: cat as InterestAssetCategory,
      score,
    });
  }
  if (normalized.assets.length === 0) {
    throw new Error("interest_api_empty_assets");
  }
  return normalized;
}

function mergeHistory(
  existing: InterestScoreHistoryEntry[],
  date: string,
  score: number,
  rank: number,
): InterestScoreHistoryEntry[] {
  const kept = existing.filter((e) => e.date !== date);
  kept.push({ date, score, rank });
  kept.sort((a, b) => a.date.localeCompare(b.date));
  return kept;
}

/**
 * 관심 자산 API 결과를 `dopamine_interest_asset_scores`에 반영.
 * 동일 `date`가 이미 있으면 해당 항목만 새 점수·순위로 교체.
 *
 * `CRON_API_BASE_URL`로 GET .../api/feed/interest-assets?refresh=1 만 호출.
 * 프로덕션에서는 API가 `CRON_SECRET`(Bearer)을 요구하므로, 동일 값을 환경에 두면 Authorization 헤더로 전달.
 */
export async function syncInterestAssetScoresToSupabase(
  supabase: SupabaseClient,
): Promise<void> {
  const base = process.env.CRON_API_BASE_URL?.trim();
  if (!base) {
    console.warn("[interest-assets-sync] skip: CRON_API_BASE_URL is not set");
    return;
  }

  let payload: InterestAssetsPayload;
  try {
    payload = await fetchPayloadFromDeployedApi(
      base,
      process.env.CRON_SECRET,
    );
  } catch (e) {
    console.error("[interest-assets-sync] fetch payload failed, skip db", e);
    return;
  }

  const { date, assets } = payload;
  if (assets.length === 0) {
    console.warn("[interest-assets-sync] skip: no assets");
    return;
  }

  const symbols = assets.map((a) => a.symbol);
  const { data: existingRows, error: selErr } = await supabase
    .from("dopamine_interest_asset_scores")
    .select("symbol, score_history")
    .in("symbol", symbols);

  if (selErr) {
    console.error(
      "[interest-assets-sync] select existing failed, skip",
      selErr,
    );
    return;
  }

  const historyBySymbol = new Map<string, InterestScoreHistoryEntry[]>();
  for (const row of existingRows ?? []) {
    const sym = row.symbol as string;
    historyBySymbol.set(sym, parseHistory(row.score_history));
  }

  const updatedAt = new Date().toISOString();
  const upsertRows = assets.map((a) => {
    const prev = historyBySymbol.get(a.symbol) ?? [];
    const score_history = mergeHistory(prev, date, a.score, a.rank);
    return {
      symbol: a.symbol,
      name: a.name,
      category: a.category,
      score_history,
      updated_at: updatedAt,
    };
  });

  const { error: upErr } = await supabase
    .from("dopamine_interest_asset_scores")
    .upsert(upsertRows, { onConflict: "symbol" });

  if (upErr) {
    console.error("[interest-assets-sync] upsert failed", upErr);
    return;
  }

  console.log(
    `[interest-assets-sync] upserted dopamine_interest_asset_scores date=${date} rows=${upsertRows.length} at ${updatedAt}`,
  );
}
