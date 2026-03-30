import { computeChangeFromDailyBars } from "./feed-metrics";
import { inferAssetClassForThemeSymbol } from "./theme-community-pairs";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  THEME_DEFINITIONS,
  themeDisplayName,
  type ThemeDefinition,
  type ThemeLocale,
} from "./theme-definitions";
import type { AssetClass, ThemeItemDto } from "./types";
import { fetchYahooDailyBars } from "./yahoo-chart";
import { THEME_CACHE_ID } from "./theme-cache-constants";

const CACHE_TTL_MS = 60_000;
const MAX_ITEMS_PER_KIND = 15;
const YAHOO_BAR_DAYS = 12;
const SYMBOL_FETCH_CONCURRENCY = 5;

type ThemeKind = "hot" | "crashed" | "emerging";

/** 로케일과 무관한 집계 결과 — 이름은 응답 시 [themeDisplayName]으로 붙인다. */
type ThemeComputedRow = {
  id: string;
  avgChangePct: number;
  volumeLiftPct: number;
  symbolCount: number;
  themeScore: number;
  symbols: string[];
  detailSymbol: string;
  detailAssetClass: AssetClass;
};

let cache: { at: number; rows: ThemeComputedRow[] } | null = null;

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

async function aggregateTheme(def: ThemeDefinition): Promise<ThemeComputedRow | null> {
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
  const leadSym = def.symbols[0]?.trim() ?? "";
  const detailAssetClass: AssetClass = inferAssetClassForThemeSymbol(
    leadSym.length > 0 ? leadSym : "SPY",
  );

  return {
    id: def.id,
    avgChangePct: round2(avgChangePct),
    volumeLiftPct: round2(volumeLiftPct),
    symbolCount,
    themeScore: round2(themeScore(avgChangePct, volumeLiftPct, symbolCount)),
    symbols: [...def.symbols],
    detailSymbol: leadSym.length > 0 ? leadSym : "SPY",
    detailAssetClass,
  };
}

export async function computeAllThemesRows(): Promise<ThemeComputedRow[]> {
  const out: ThemeComputedRow[] = [];
  for (const def of THEME_DEFINITIONS) {
    const row = await aggregateTheme(def);
    if (row) out.push(row);
  }
  return out;
}

function toThemeItemDto(row: ThemeComputedRow, locale: ThemeLocale): ThemeItemDto {
  const def = THEME_DEFINITIONS.find((d) => d.id === row.id);
  const name = def ? themeDisplayName(def, locale) : row.id;
  return {
    id: row.id,
    name,
    avgChangePct: row.avgChangePct,
    volumeLiftPct: row.volumeLiftPct,
    symbolCount: row.symbolCount,
    themeScore: row.themeScore,
    symbols: row.symbols,
    detailSymbol: row.detailSymbol,
    detailAssetClass: row.detailAssetClass,
  };
}

function pickHot(rows: ThemeComputedRow[]): ThemeComputedRow[] {
  const positive = rows.filter((r) => r.avgChangePct > 0);
  const pool = positive.length > 0 ? positive : rows;
  return [...pool].sort((a, b) => b.themeScore - a.themeScore).slice(0, MAX_ITEMS_PER_KIND);
}

function pickCrashed(rows: ThemeComputedRow[]): ThemeComputedRow[] {
  const negative = rows.filter((r) => r.avgChangePct < 0);
  const pool = negative.length > 0 ? negative : rows;
  return [...pool].sort((a, b) => a.avgChangePct - b.avgChangePct).slice(0, MAX_ITEMS_PER_KIND);
}

function pickEmerging(rows: ThemeComputedRow[]): ThemeComputedRow[] {
  return [...rows]
    .sort((a, b) => b.volumeLiftPct - a.volumeLiftPct)
    .slice(0, MAX_ITEMS_PER_KIND);
}

export async function getThemes(
  kind: ThemeKind,
  locale: ThemeLocale,
): Promise<{ kind: ThemeKind; locale: ThemeLocale; items: ThemeItemDto[] }> {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    try {
      const supabase = getSupabaseAdmin();
      const { data, error } = await supabase
        .from("dopamine_theme_cache")
        .select("items, updated_at")
        .eq("id", THEME_CACHE_ID)
        .maybeSingle();

      if (!error && data?.items && Array.isArray(data.items)) {
        cache = { at: now, rows: data.items as ThemeComputedRow[] };
      } else {
        const rows = await computeAllThemesRows();
        cache = { at: now, rows };

        // best-effort: 백그라운드 잡이 실패했을 때도 다음 호출에 부담이 덜 가도록 저장
        try {
          await supabase.from("dopamine_theme_cache").upsert(
            {
              id: THEME_CACHE_ID,
              items: rows,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        } catch {}
      }
    } catch (e) {
      console.error("[themes] computeAllThemes failed", e);
      return { kind, locale, items: [] };
    }
  }

  const rows = cache!.rows;
  const picked =
    kind === "hot" ? pickHot(rows) : kind === "crashed" ? pickCrashed(rows) : pickEmerging(rows);

  const items = picked.map((r) => toThemeItemDto(r, locale));
  return { kind, locale, items };
}
