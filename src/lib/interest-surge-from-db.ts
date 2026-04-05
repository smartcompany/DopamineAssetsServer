import type { SupabaseClient } from "@supabase/supabase-js";

export type InterestSurgeItemDto = {
  rank: number;
  symbol: string;
  name: string;
  category: string;
  score: number;
  scoreDelta: number | null;
  snapshotDate: string;
};

type HistoryEntry = { date: string; score: number; rank: number };

function previousIsoDate(ymd: string): string {
  const parts = ymd.split("-").map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return "";
  }
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function parseHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
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
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

const TOP_N = 10;

/**
 * `dopamine_interest_asset_scores` → 점수 내림차순 최대 10개, 전일 대비 델타(있을 때만).
 */
export async function fetchInterestSurgeFromDb(
  supabase: SupabaseClient,
): Promise<{ snapshotDate: string; items: InterestSurgeItemDto[] }> {
  const { data: rows, error } = await supabase
    .from("dopamine_interest_asset_scores")
    .select("symbol,name,category,score_history");

  if (error) {
    throw new Error(error.message);
  }

  const candidates: InterestSurgeItemDto[] = [];

  for (const row of rows ?? []) {
    const symbol = typeof row.symbol === "string" ? row.symbol.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "";
    if (!symbol || !name || !category) continue;

    const hist = parseHistory(row.score_history);
    if (hist.length === 0) continue;

    const latest = hist[hist.length - 1]!;
    const prevDate = previousIsoDate(latest.date);
    const yEntry = prevDate ? hist.find((e) => e.date === prevDate) : undefined;
    const scoreDelta =
      yEntry != null && Number.isFinite(yEntry.score)
        ? Math.round((latest.score - yEntry.score) * 1000) / 1000
        : null;

    candidates.push({
      rank: 0,
      symbol,
      name,
      category,
      score: latest.score,
      scoreDelta,
      snapshotDate: latest.date,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const slice = candidates.slice(0, TOP_N);
  const items = slice.map((item, i) => ({ ...item, rank: i + 1 }));

  const snapshotDate =
    items.length > 0
      ? items.reduce((max, it) => (it.snapshotDate > max ? it.snapshotDate : max), items[0]!.snapshotDate)
      : new Date().toISOString().slice(0, 10);

  return { snapshotDate, items };
}
