import { dopamineScore } from "./feed-metrics";
import type { AssetClass, RankedAssetDto } from "./types";

const YAHOO_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (compatible; DopamineAssets/1.0; +https://github.com)",
};

/** 미국: `day_gainers` / `day_losers`. 일·중: Yahoo가 단독 JP/CN saved 스크리너를 주지 않아 `day_*_asia` 후 접미사로 필터. */
export type YahooDayMoversMarket = "us" | "asia_jp" | "asia_cn";

export type FetchYahooDayMoversOptions = {
  market?: YahooDayMoversMarket;
};

type YahooPct = { raw?: number } | undefined;

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketChangePercent?: YahooPct;
};

const ASIA_SCREENER_COUNT = 250;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctRaw(v: YahooPct): number | null {
  const r = v?.raw;
  if (typeof r !== "number" || !Number.isFinite(r)) return null;
  return r;
}

function symbolMatchesMarket(symbol: string, market: "asia_jp" | "asia_cn"): boolean {
  const s = symbol.trim();
  if (market === "asia_jp") return s.endsWith(".T");
  return s.endsWith(".SS") || s.endsWith(".SZ");
}

function assetClassForMarket(m: YahooDayMoversMarket): AssetClass {
  if (m === "asia_jp") return "jp_stock";
  if (m === "asia_cn") return "cn_stock";
  return "us_stock";
}

function scrIdsFor(kind: "gainers" | "losers", market: YahooDayMoversMarket): string {
  if (market === "us") {
    return kind === "gainers" ? "day_gainers" : "day_losers";
  }
  return kind === "gainers" ? "day_gainers_asia" : "day_losers_asia";
}

/**
 * Yahoo Finance 웹의 Day Gainers / Day Losers 계열 (`/v1/finance/screener/predefined/saved`).
 *
 * - **US** (`market` 기본): `day_gainers` / `day_losers`, `region=US`.
 * - **일본·중국**: Yahoo 단독 `day_gainers_jp` 등은 API에서 404이므로,
 *   `day_gainers_asia` / `day_losers_asia` 응답에서 각각 `.T` / `.SS`·`.SZ` 만 남긴 뒤 상위 [count]개.
 *
 * @see https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved
 */
export async function fetchYahooDayMovers(
  kind: "gainers" | "losers",
  count: number,
  options?: FetchYahooDayMoversOptions,
): Promise<RankedAssetDto[]> {
  const market = options?.market ?? "us";
  const scrIds = scrIdsFor(kind, market);
  const n =
    market === "us"
      ? Math.min(50, Math.max(1, count))
      : Math.min(ASIA_SCREENER_COUNT, Math.max(50, count * 5));
  const url =
    `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved` +
    `?formatted=true&lang=en-US&region=US&scrIds=${scrIds}&count=${n}`;

  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Yahoo screener HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const data: unknown = await response.json();
  const finance = data as {
    finance?: {
      error?: unknown;
      result?: Array<{ quotes?: YahooQuote[] }>;
    };
  };

  if (finance.finance?.error) {
    throw new Error(`Yahoo screener error: ${JSON.stringify(finance.finance.error)}`);
  }

  let quotes = finance.finance?.result?.[0]?.quotes ?? [];

  if (market === "asia_jp" || market === "asia_cn") {
    quotes = quotes.filter((q) => {
      const sym = q.symbol?.trim();
      if (!sym) return false;
      return symbolMatchesMarket(sym, market);
    });
    quotes.sort((a, b) => {
      const pa = pctRaw(a.regularMarketChangePercent);
      const pb = pctRaw(b.regularMarketChangePercent);
      if (pa === null && pb === null) return 0;
      if (pa === null) return 1;
      if (pb === null) return -1;
      if (kind === "gainers") return pb - pa;
      return pa - pb;
    });
    const cap = Math.min(50, Math.max(1, count));
    quotes = quotes.slice(0, cap);
  }

  const assetClass = assetClassForMarket(market);
  const out: RankedAssetDto[] = [];

  for (const q of quotes) {
    const symbol = q.symbol?.trim();
    if (!symbol) continue;
    const pricePct = pctRaw(q.regularMarketChangePercent);
    if (pricePct === null) continue;

    const volumeChangePct = 0;
    const score = dopamineScore(pricePct, volumeChangePct);
    const name =
      (typeof q.shortName === "string" && q.shortName.trim() !== ""
        ? q.shortName
        : null) ??
      (typeof q.longName === "string" && q.longName.trim() !== ""
        ? q.longName
        : symbol);

    out.push({
      symbol,
      name,
      assetClass,
      priceChangePct: round2(pricePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }

  return out;
}
