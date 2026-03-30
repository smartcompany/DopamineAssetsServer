import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

/** 24h 거래대금(USD) 하한 — 무료 /markets 목록에서 잡음 완화 */
const DEFAULT_MIN_VOLUME_USD = 50_000;

// 이 프로젝트에서는 CoinGecko를 "후보 1회"로만 가져오므로 page=1을 고정합니다.

/**
 * 429 시 재시도 횟수
 * - maxPages=1(=page=1 단일 호출) 기준으로 "진짜 1회 호출"을 목표로 1로 둠.
 *   (즉, 429면 추가 호출 없이 바로 실패/에러로 끝냄)
 */
const MAX_429_RETRIES = 1;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

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

async function fetchMarketsPageWithRetry(
  page: number,
  headers: HeadersInit,
): Promise<CoinGeckoMarketRow[]> {
  const url = new URL(`${COINGECKO_BASE}/coins/markets`);
  url.searchParams.set("vs_currency", "usd");
  // "gainers/losers"는 서버에서 별도 정렬 지원이 약해서,
  // 후보군 품질을 위해 페이지 1개는 시가총액 내림차순 상위 N만 가져온 뒤
  // 응답의 price_change_percentage_24h로 급등/급락을 정렬합니다.
  url.searchParams.set("order", "market_cap_desc");
  url.searchParams.set("per_page", "250");
  url.searchParams.set("page", String(page));
  url.searchParams.set("sparkline", "false");

  let backoffMs = 10_000;

  for (let attempt = 1; attempt <= MAX_429_RETRIES; attempt++) {
    const response = await fetch(url.toString(), { headers });

    if (response.status === 429) {
      const ra = response.headers.get("retry-after");
      const sec = ra ? Number.parseInt(ra, 10) : NaN;
      const wait =
        Number.isFinite(sec) && sec > 0
          ? sec * 1000
          : Math.min(backoffMs, 120_000);
      console.warn(
        `[coingecko] 429 page ${page} attempt ${attempt}/${MAX_429_RETRIES} wait ${wait}ms`,
      );
      if (attempt === MAX_429_RETRIES) {
        throw new Error(`CoinGecko HTTP 429 page ${page} after retries`);
      }
      await sleep(wait);
      backoffMs *= 2;
      continue;
    }

    if (!response.ok) {
      throw new Error(`CoinGecko HTTP ${response.status} page ${page}`);
    }

    const chunk = (await response.json()) as CoinGeckoMarketRow[];
    return Array.isArray(chunk) ? chunk : [];
  }

  return [];
}

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
  const minVolumeUsd = options?.minVolumeUsd ?? DEFAULT_MIN_VOLUME_USD;

  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent":
      "DopamineAssets/1.0 (feed-cache; +https://github.com/DopamineAssets)",
  };

  const all: CoinGeckoMarketRow[] = [];

  // "진짜 1번만 호출"을 목표로 page=1 고정
  const chunk = await fetchMarketsPageWithRetry(1, headers);
  if (chunk.length > 0) {
    all.push(...chunk);
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
