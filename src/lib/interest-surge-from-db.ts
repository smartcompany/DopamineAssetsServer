import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchKrStockNameFromNaver } from "./kr-stock";

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
type CandidateRow = InterestSurgeItemDto & { _symbolPreferred: boolean };

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

const DEFAULT_TOP_N = 10;
const MAX_TOP_N = 50;

function normalizeInterestSymbol(category: string, symbol: string): string {
  const s = symbol.trim().toUpperCase();
  if (category === "crypto") {
    const m = s.match(/^([A-Z0-9]{1,20})-USD$/);
    if (m) return m[1];
  }
  return symbol.trim();
}

function resolveInterestSurgeLocale(
  locale: string | undefined,
): "ko" | "en" {
  const raw = typeof locale === "string" ? locale.trim().toLowerCase() : "";
  return raw.startsWith("ko") ? "ko" : "en";
}

async function applyInterestSurgeLocaleName(
  items: InterestSurgeItemDto[],
  locale: "ko" | "en",
): Promise<InterestSurgeItemDto[]> {
  if (locale !== "ko") return items;
  const out = [...items];
  for (let i = 0; i < out.length; i++) {
    const it = out[i]!;
    if (it.category !== "kr_stock") continue;
    try {
      const ko = await fetchKrStockNameFromNaver(it.symbol);
      if (ko && ko.trim()) {
        out[i] = { ...it, name: ko.trim() };
      }
    } catch (e) {
      console.error("[interest-surge] kr_stock ko name failed", it.symbol, e);
    }
  }
  return out;
}

/**
 * `dopamine_interest_asset_scores` → 점수 내림차순 최대 10개, 전일 대비 델타(있을 때만).
 */
export async function fetchInterestSurgeFromDb(
  supabase: SupabaseClient,
  locale?: string,
  limit: number = DEFAULT_TOP_N,
): Promise<{ snapshotDate: string; items: InterestSurgeItemDto[] }> {
  const { data: rows, error } = await supabase
    .from("dopamine_interest_asset_scores")
    .select("symbol,name,category,score_history");

  if (error) {
    throw new Error(error.message);
  }

  const byNormalized = new Map<string, CandidateRow>();

  for (const row of rows ?? []) {
    const symbolRaw = typeof row.symbol === "string" ? row.symbol.trim() : "";
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const category = typeof row.category === "string" ? row.category.trim() : "";
    if (!symbolRaw || !name || !category) continue;

    const hist = parseHistory(row.score_history);
    if (hist.length === 0) continue;

    const latest = hist[hist.length - 1]!;
    const prevDate = previousIsoDate(latest.date);
    const yEntry = prevDate ? hist.find((e) => e.date === prevDate) : undefined;
    const scoreDelta =
      yEntry != null && Number.isFinite(yEntry.score)
        ? Math.round((latest.score - yEntry.score) * 1000) / 1000
        : null;

    const symbol = normalizeInterestSymbol(category, symbolRaw);
    const next: CandidateRow = {
      rank: 0,
      symbol,
      name,
      category,
      score: latest.score,
      scoreDelta,
      snapshotDate: latest.date,
      _symbolPreferred: symbolRaw.toUpperCase() === symbol.toUpperCase(),
    };
    const key = `${category}|${symbol.toUpperCase()}`;
    const prev = byNormalized.get(key);
    if (!prev) {
      byNormalized.set(key, next);
      continue;
    }
    if (!prev._symbolPreferred && next._symbolPreferred) {
      byNormalized.set(key, next);
      continue;
    }
    if (next.score > prev.score) {
      byNormalized.set(key, next);
    }
  }

  const candidates = [...byNormalized.values()];
  candidates.sort((a, b) => b.score - a.score);
  const topN = Math.min(MAX_TOP_N, Math.max(1, Math.floor(limit)));
  const slice = candidates.slice(0, topN);
  const localeBucket = resolveInterestSurgeLocale(locale);
  const localized = await applyInterestSurgeLocaleName(
    slice.map((item, i) => ({
      rank: i + 1,
      symbol: item.symbol,
      name: item.name,
      category: item.category,
      score: item.score,
      scoreDelta: item.scoreDelta,
      snapshotDate: item.snapshotDate,
    })),
    localeBucket,
  );
  const items = localized.map((item, i) => ({ ...item, rank: i + 1 }));

  const snapshotDate =
    items.length > 0
      ? items.reduce((max, it) => (it.snapshotDate > max ? it.snapshotDate : max), items[0]!.snapshotDate)
      : new Date().toISOString().slice(0, 10);

  return { snapshotDate, items };
}
