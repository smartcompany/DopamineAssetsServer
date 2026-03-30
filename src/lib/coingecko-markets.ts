import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** 24h 거래대금(USD) 하한 — 무료 /markets 목록에서 잡음 완화 */
const DEFAULT_MIN_VOLUME_USD = 50_000;

/** 페이지 간 호출 간격 (무료 레이트리밋 완화) */
const PAGE_DELAY_MS = 2_000;

const STABLE_BASE_SYMBOLS = new Set([
  "usdt",
  "usdc",
  "dai",
  "busd",
  "tusd",
  "usdd",
  "fdusd",
  "pyusd",
  "gusd",
  "usde",
  "usdp",
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isStableLike(symbolLower: string): boolean {
  if (STABLE_BASE_SYMBOLS.has(symbolLower)) return true;
  if (symbolLower.endsWith("usdt") && symbolLower.length <= 8) {
    const base = symbolLower.replace(/usdt$/, "");
    if (STABLE_BASE_SYMBOLS.has(base)) return true;
  }
  return false;
}

type CoinGeckoMarketRow = {
  symbol?: string;
  name?: string;
  total_volume?: number | null;
  price_change_percentage_24h?: number | null;
};

/**
 * CoinGecko `/coins/markets` 여러 페이지(거래량순) → USDT 심볼 형태 `RankedAssetDto[]`.
 * 사전 코인 목록 없이 상위 유동성 코인에서 등락률을 채운다.
 */
export async function fetchCoinGeckoMarketRowsForCache(
  options?: {
    maxPages?: number;
    minVolumeUsd?: number;
  },
): Promise<RankedAssetDto[]> {
  const maxPages = options?.maxPages ?? 5;
  const minVolumeUsd = options?.minVolumeUsd ?? DEFAULT_MIN_VOLUME_USD;

  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent":
      "DopamineAssets/1.0 (feed-cache; +https://github.com/DopamineAssets)",
  };

  const all: CoinGeckoMarketRow[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`${COINGECKO_BASE}/coins/markets`);
    url.searchParams.set("vs_currency", "usd");
    url.searchParams.set("order", "volume_desc");
    url.searchParams.set("per_page", "250");
    url.searchParams.set("page", String(page));
    url.searchParams.set("sparkline", "false");

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status} page ${page}`);
    }
    const chunk = (await response.json()) as CoinGeckoMarketRow[];
    if (!Array.isArray(chunk) || chunk.length === 0) break;
    all.push(...chunk);
    if (page < maxPages) {
      await new Promise((r) => setTimeout(r, PAGE_DELAY_MS));
    }
  }

  const out: RankedAssetDto[] = [];

  for (const t of all) {
    const sym = t.symbol?.trim().toLowerCase();
    if (!sym || isStableLike(sym)) continue;

    const vol = t.total_volume ?? 0;
    if (!Number.isFinite(vol) || vol < minVolumeUsd) continue;

    const raw = t.price_change_percentage_24h;
    if (raw == null || !Number.isFinite(raw)) continue;

    const priceChangePct = raw;
    const volumeChangePct = 0;
    const score = dopamineScore(priceChangePct, volumeChangePct);
    const upper = sym.toUpperCase();

    out.push({
      symbol: `${upper}USDT`,
      name: typeof t.name === "string" && t.name.trim() !== "" ? t.name.trim() : upper,
      assetClass: "crypto",
      priceChangePct: round2(priceChangePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }

  return out;
}
