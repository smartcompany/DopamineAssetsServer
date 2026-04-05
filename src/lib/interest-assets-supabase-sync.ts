import type { SupabaseClient } from "@supabase/supabase-js";

import type { InterestAssetsPayload } from "@/lib/interest-assets-openai";

export type InterestScoreHistoryEntry = {
  date: string;
  score: number;
  rank: number;
};

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
 * OpenAI 관심 자산 페이로드를 `dopamine_interest_asset_scores`에 반영.
 * 동일 `date`가 이미 있으면 해당 항목만 새 점수·순위로 교체.
 */
export async function persistInterestAssetsPayloadToSupabase(
  supabase: SupabaseClient,
  payload: InterestAssetsPayload,
): Promise<{ rowCount: number; date: string }> {
  const { date, assets } = payload;
  if (assets.length === 0) {
    throw new Error("interest_persist_empty_assets");
  }

  const symbols = assets.map((a) => a.symbol);
  const { data: existingRows, error: selErr } = await supabase
    .from("dopamine_interest_asset_scores")
    .select("symbol, score_history")
    .in("symbol", symbols);

  if (selErr) {
    throw new Error(`interest_persist_select: ${selErr.message}`);
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
    throw new Error(`interest_persist_upsert: ${upErr.message}`);
  }

  console.log(
    `[interest-assets-persist] dopamine_interest_asset_scores date=${date} rows=${upsertRows.length} at ${updatedAt}`,
  );

  return { rowCount: upsertRows.length, date };
}
