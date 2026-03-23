import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

const YAHOO_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (compatible; DopamineAssets/1.0; +https://github.com)",
};

type YahooPct = { raw?: number } | undefined;
type YahooVol = { raw?: number } | undefined;

type YahooQuote = {
  symbol?: string;
  shortName?: string;
  longName?: string;
  regularMarketChangePercent?: YahooPct;
  regularMarketVolume?: YahooVol;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function pctRaw(v: YahooPct): number | null {
  const r = v?.raw;
  if (typeof r !== "number" || !Number.isFinite(r)) return null;
  return r;
}

/**
 * Yahoo Finance 웹의 "Day Gainers / Day Losers"와 동일 계열.
 * @see https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved
 *
 * 주로 **미국 주식(EQUITY)** 만 포함. 한국·코인·원자재는 별도 스크리너/심볼이 필요.
 */
export async function fetchYahooDayMovers(
  kind: "gainers" | "losers",
  count: number,
): Promise<RankedAssetDto[]> {
  const scrIds = kind === "gainers" ? "day_gainers" : "day_losers";
  const n = Math.min(50, Math.max(1, count));
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

  const quotes = finance.finance?.result?.[0]?.quotes ?? [];
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
      assetClass: "us_stock",
      priceChangePct: round2(pricePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }

  return out;
}
