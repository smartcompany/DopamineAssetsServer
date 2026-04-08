/**
 * 크립토 일봉: CoinGecko `/coins/{id}/ohlc`, 비면 `market_chart` 일별 종가 합성.
 */
import { fetchCryptoProfileFromCoinGecko } from "./coingecko-asset-detail";
import { parseCryptoPairFromRankingSymbol } from "./asset-detail-service";
import type { OhlcBar } from "./yahoo-chart";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const UA =
  "DopamineAssets/1.0 (asset-chart; +https://github.com/DopamineAssets)";
const HOT_CACHE_TTL_MS = 60_000;
const STALE_FALLBACK_TTL_MS = 30 * 60_000;

type CacheEntry = {
  bars: OhlcBar[];
  tsMs: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<OhlcBar[] | null>>();

function coingeckoOhlcDays(range: string): number {
  switch (range) {
    case "1mo":
      return 30;
    case "1y":
      return 365;
    case "3mo":
    default:
      return 90;
  }
}

export async function fetchCoinGeckoOhlcBarsForCryptoRankingSymbol(params: {
  rankingSymbol: string;
  /** 자산명(상세 화면) — 검색 정확도 향상 */
  displayName: string | null;
  range: string;
}): Promise<OhlcBar[] | null> {
  const { rankingSymbol, displayName, range } = params;
  const cacheKey = `${rankingSymbol.toUpperCase()}|${range}`;
  const now = Date.now();
  const cached = responseCache.get(cacheKey);
  if (cached && now - cached.tsMs <= HOT_CACHE_TTL_MS) {
    return cached.bars;
  }
  const pending = inFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<OhlcBar[] | null> => {
  const pair = parseCryptoPairFromRankingSymbol(rankingSymbol);
  if (!pair) return null;

  const profile = await fetchCryptoProfileFromCoinGecko({
    rankingSymbol,
    baseSymbolUpper: pair.base,
    displayName: displayName?.trim() ?? "",
  });
  if (!profile?.coinId) {
    console.warn("[coingecko-chart] no CoinGecko coinId", {
      rankingSymbol,
      base: pair.base,
      displayName: displayName?.trim() ?? "",
    });
    return null;
  }

  const days = coingeckoOhlcDays(range);
  const ohlcBars = await fetchCoinGeckoOhlcRaw(profile.coinId, days);
  if (ohlcBars && ohlcBars.length > 0) {
    responseCache.set(cacheKey, { bars: ohlcBars, tsMs: Date.now() });
    return ohlcBars;
  }

  console.warn("[coingecko-chart] OHLC empty, trying market_chart", profile.coinId);
  const marketBars = await fetchCoinGeckoMarketChartDailyBars(profile.coinId, days);
  if (marketBars && marketBars.length > 0) {
    responseCache.set(cacheKey, { bars: marketBars, tsMs: Date.now() });
    return marketBars;
  }

  const stale = responseCache.get(cacheKey);
  if (stale && Date.now() - stale.tsMs <= STALE_FALLBACK_TTL_MS) {
    console.warn("[coingecko-chart] using stale cached bars after upstream miss", {
      rankingSymbol,
      range,
      ageMs: Date.now() - stale.tsMs,
    });
    return stale.bars;
  }
  return null;
  })();

  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

async function fetchCoinGeckoOhlcRaw(
  coinId: string,
  days: number,
): Promise<OhlcBar[] | null> {
  const u = new URL(`${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}/ohlc`);
  u.searchParams.set("vs_currency", "usd");
  u.searchParams.set("days", String(days));

  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (res.status === 429) {
    console.warn("[coingecko-chart] 429 ohlc", coinId);
    return null;
  }
  if (!res.ok) {
    console.warn("[coingecko-chart] HTTP ohlc", res.status, u.toString());
    return null;
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const out: OhlcBar[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const tsMs = row[0];
    const oRaw = row[1];
    const h = row[2];
    const l = row[3];
    const c = row[4];
    if (typeof tsMs !== "number" || !Number.isFinite(tsMs)) continue;
    const o =
      typeof oRaw === "number" && Number.isFinite(oRaw) && oRaw > 0
        ? oRaw
        : typeof c === "number" && Number.isFinite(c) && c > 0
          ? c
          : null;
    if (
      o == null ||
      typeof h !== "number" ||
      typeof l !== "number" ||
      typeof c !== "number" ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      h <= 0 ||
      l <= 0 ||
      c <= 0
    ) {
      continue;
    }
    const t = Math.floor(tsMs / 1000);
    const high = Math.max(h, l, o, c);
    const low = Math.min(h, l, o, c);
    out.push({
      t,
      o,
      h: high,
      l: low,
      c,
      v: 0,
    });
  }

  return out.length > 0 ? out : null;
}

/** OHLC 미제공·빈 배열 시 일별 종가만으로 합성 캔들 (라인 차트에 가깝게). */
async function fetchCoinGeckoMarketChartDailyBars(
  coinId: string,
  days: number,
): Promise<OhlcBar[] | null> {
  const u = new URL(
    `${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}/market_chart`,
  );
  u.searchParams.set("vs_currency", "usd");
  u.searchParams.set("days", String(Math.min(Math.max(days, 1), 365)));
  u.searchParams.set("interval", "daily");

  const res = await fetch(u.toString(), {
    headers: { Accept: "application/json", "User-Agent": UA },
  });
  if (res.status === 429) {
    console.warn("[coingecko-chart] 429 market_chart", coinId);
    return null;
  }
  if (!res.ok) {
    console.warn("[coingecko-chart] HTTP market_chart", res.status, u.toString());
    return null;
  }

  const data = (await res.json()) as { prices?: unknown };
  const prices = data.prices;
  if (!Array.isArray(prices) || prices.length === 0) return null;

  const out: OhlcBar[] = [];
  for (const row of prices) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const tsMs = row[0];
    const p = row[1];
    if (typeof tsMs !== "number" || typeof p !== "number") continue;
    if (!Number.isFinite(tsMs) || !Number.isFinite(p) || p <= 0) continue;
    const t = Math.floor(tsMs / 1000);
    out.push({ t, o: p, h: p, l: p, c: p, v: 0 });
  }

  return out.length > 0 ? out : null;
}
