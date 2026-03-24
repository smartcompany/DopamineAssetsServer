import { computeChangeFromDailyBars } from "./feed-metrics";
import { THEME_DEFINITIONS, type ThemeDefinition } from "./theme-definitions";
import type { ThemeItemDto } from "./types";
import { fetchYahooDailyBars } from "./yahoo-chart";

const CACHE_TTL_MS = 90_000;
const MAX_ITEMS_PER_KIND = 15;
const YAHOO_BAR_DAYS = 12;
const SYMBOL_FETCH_CONCURRENCY = 5;

type ThemeKind = "hot" | "crashed" | "emerging";

let cache: { at: number; rows: ThemeItemDto[] } | null = null;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function themeScore(avgChangePct: number, volumeLiftPct: number, symbolCount: number): number {
  return avgChangePct + volumeLiftPct + symbolCount;
}

async function parallelMapLimit<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  if (n === 0) return [];
  const results = new Array<R>(n);
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await mapper(items[i]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, n) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function fetchSymbolDayMetrics(
  symbol: string,
): Promise<{ priceChangePct: number; volumeChangePct: number } | null> {
  try {
    const bars = await fetchYahooDailyBars(symbol, YAHOO_BAR_DAYS);
    return computeChangeFromDailyBars(bars);
  } catch (e) {
    console.warn(`[themes] skip symbol ${symbol}`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function aggregateTheme(def: ThemeDefinition): Promise<ThemeItemDto | null> {
  const metrics = await parallelMapLimit(def.symbols, SYMBOL_FETCH_CONCURRENCY, (sym) =>
    fetchSymbolDayMetrics(sym),
  );

  const ok = metrics.filter((m): m is NonNullable<typeof m> => m != null);
  if (ok.length === 0) {
    console.warn(`[themes] no data for theme ${def.id}`);
    return null;
  }

  const avgChangePct = ok.reduce((s, m) => s + m.priceChangePct, 0) / ok.length;
  const volumeLiftPct = ok.reduce((s, m) => s + m.volumeChangePct, 0) / ok.length;
  const symbolCount = ok.length;

  return {
    id: def.id,
    name: def.name,
    avgChangePct: round2(avgChangePct),
    volumeLiftPct: round2(volumeLiftPct),
    symbolCount,
    themeScore: round2(themeScore(avgChangePct, volumeLiftPct, symbolCount)),
  };
}

async function computeAllThemes(): Promise<ThemeItemDto[]> {
  const out: ThemeItemDto[] = [];
  for (const def of THEME_DEFINITIONS) {
    const row = await aggregateTheme(def);
    if (row) out.push(row);
  }
  return out;
}

function pickHot(rows: ThemeItemDto[]): ThemeItemDto[] {
  const positive = rows.filter((r) => r.avgChangePct > 0);
  const pool = positive.length > 0 ? positive : rows;
  return [...pool].sort((a, b) => b.themeScore - a.themeScore).slice(0, MAX_ITEMS_PER_KIND);
}

function pickCrashed(rows: ThemeItemDto[]): ThemeItemDto[] {
  const negative = rows.filter((r) => r.avgChangePct < 0);
  const pool = negative.length > 0 ? negative : rows;
  return [...pool].sort((a, b) => a.avgChangePct - b.avgChangePct).slice(0, MAX_ITEMS_PER_KIND);
}

function pickEmerging(rows: ThemeItemDto[]): ThemeItemDto[] {
  return [...rows]
    .sort((a, b) => b.volumeLiftPct - a.volumeLiftPct)
    .slice(0, MAX_ITEMS_PER_KIND);
}

export async function getThemes(kind: ThemeKind): Promise<{ kind: ThemeKind; items: ThemeItemDto[] }> {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    try {
      const rows = await computeAllThemes();
      cache = { at: now, rows };
    } catch (e) {
      console.error("[themes] computeAllThemes failed", e);
      return { kind, items: [] };
    }
  }

  const rows = cache!.rows;
  const items =
    kind === "hot" ? pickHot(rows) : kind === "crashed" ? pickCrashed(rows) : pickEmerging(rows);

  return { kind, items };
}
