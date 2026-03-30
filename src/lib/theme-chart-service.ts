import { THEME_DEFINITIONS } from "./theme-definitions";
import { fetchYahooOhlcBars, type OhlcBar } from "./yahoo-chart";
import { getSupabaseAdmin } from "./supabase-admin";
import { themeChartCacheId } from "./theme-cache-constants";

function dayKeyUtc(t: number): string {
  return new Date(t * 1000).toISOString().slice(0, 10);
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

/**
 * 구성 종목 각각을 구간 첫 유효 종가 기준 지수 100으로 두고,
 * 같은 캘린더 일(UTC)에 대해 가용 종목들의 지수를 평균한 합성 시리즈.
 */
export async function getThemeAverageOhlcBars(
  themeId: string,
  rangeDays: number,
): Promise<OhlcBar[]> {
  const cacheId = themeChartCacheId(themeId, rangeDays);
  try {
    const supabase = getSupabaseAdmin();
    const { data } = await supabase
      .from("dopamine_theme_chart_cache")
      .select("items")
      .eq("id", cacheId)
      .maybeSingle();
    if (data?.items && Array.isArray(data.items)) {
      return data.items as OhlcBar[];
    }
  } catch (e) {
    // 캐시 조회 실패해도 차트 계산은 계속 진행 (요청 UX 우선)
    console.error("[theme-chart-cache] read failed", e);
  }

  const def = THEME_DEFINITIONS.find((d) => d.id === themeId);
  if (!def) return [];

  const barsPerSymbol = await parallelMapLimit(def.symbols, 5, async (sym) => {
    try {
      return await fetchYahooOhlcBars(sym.trim(), rangeDays);
    } catch {
      return [] as OhlcBar[];
    }
  });

  const series = barsPerSymbol.filter((b) => b.length > 0);
  if (series.length === 0) return [];

  const normByDay = new Map<string, number[]>();

  for (const bars of series) {
    const base = bars[0]?.c;
    if (!base || base <= 0 || !Number.isFinite(base)) continue;
    for (const b of bars) {
      if (b.c <= 0 || !Number.isFinite(b.c)) continue;
      const k = dayKeyUtc(b.t);
      const idx = (b.c / base) * 100;
      const arr = normByDay.get(k);
      if (arr) arr.push(idx);
      else normByDay.set(k, [idx]);
    }
  }

  const days = [...normByDay.keys()].sort();
  const out: OhlcBar[] = [];
  for (const d of days) {
    const arr = normByDay.get(d)!;
    const avg = arr.reduce((s, x) => s + x, 0) / arr.length;
    const t = Math.floor(new Date(`${d}T12:00:00.000Z`).getTime() / 1000);
    out.push({ t, o: avg, h: avg, l: avg, c: avg, v: 0 });
  }

  // best-effort: 캐시 저장
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("dopamine_theme_chart_cache").upsert(
      {
        id: cacheId,
        items: out,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  } catch {}

  return out;
}
