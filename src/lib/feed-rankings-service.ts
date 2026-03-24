import { fetchBybitSpotAllTickerRows } from "./bybit-spot";
import { FEED_UNIVERSE } from "./feed-universe";
import { fetchKrStockRowsFromNaver } from "./kr-stock";
import { computeChangeFromDailyBars, dopamineScore } from "./feed-metrics";
import { clampLimit, resolveAssetClasses } from "./feed-query";
import type { FeedUniverseEntry, RankedAssetDto } from "./types";
import { fetchYahooDailyBars } from "./yahoo-chart";
import { fetchYahooDayMovers } from "./yahoo-screener";

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; body: FeedRankingsResponse }>();

export type FeedRankingsResponse = {
  asOf: string;
  volumeBasis: string;
  items: RankedAssetDto[];
};

function cacheKey(direction: string, searchParams: URLSearchParams): string {
  return `${direction}?${searchParams.toString()}`;
}

function parseSource(raw: string | null): "universe" | "yahoo_us" {
  if (raw === "yahoo_us") return "yahoo_us";
  return "universe";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function buildRow(entry: FeedUniverseEntry): Promise<RankedAssetDto | null> {
  try {
    const bars = await fetchYahooDailyBars(entry.symbol, 21);
    const m = computeChangeFromDailyBars(bars);
    if (!m) return null;
    const score = dopamineScore(m.priceChangePct, m.volumeChangePct);
    const row: RankedAssetDto = {
      symbol: entry.symbol,
      name: entry.name,
      assetClass: entry.assetClass,
      priceChangePct: round2(m.priceChangePct),
      volumeChangePct: round2(m.volumeChangePct),
      dopamineScore: round2(score),
    };
    if (entry.commodityKind) {
      row.commodityKind = entry.commodityKind;
    }
    return row;
  } catch (e) {
    console.error(`[feed] skip ${entry.symbol}`, e);
    return null;
  }
}

function finalizeRankings(
  direction: "up" | "down",
  rows: RankedAssetDto[],
  limit: number,
): RankedAssetDto[] {
  const filtered =
    direction === "up"
      ? rows.filter((r) => r.priceChangePct > 0)
      : rows.filter((r) => r.priceChangePct < 0);

  // UI 카피가 "가장 미친 상승 / 가장 크게 박살" 이므로 **등락률(%) 우선** 정렬.
  // (도파민 점수 우선이면 변동률 작은 원자재가 대형 하락 주식보다 위에 오는 등 역전됨)
  if (direction === "up") {
    filtered.sort((a, b) => {
      const d = b.priceChangePct - a.priceChangePct;
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    });
  } else {
    filtered.sort((a, b) => {
      const d = a.priceChangePct - b.priceChangePct;
      if (d !== 0) return d;
      return b.dopamineScore - a.dopamineScore;
    });
  }

  return filtered.slice(0, limit);
}

export async function getFeedRankings(
  direction: "up" | "down",
  searchParams: URLSearchParams,
): Promise<FeedRankingsResponse> {
  const key = cacheKey(direction, searchParams);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.body;
  }

  const limit = clampLimit(searchParams.get("limit"));
  const source = parseSource(searchParams.get("source"));
  const include = searchParams.get("include");
  const exclude = searchParams.get("exclude");

  let classes;
  try {
    classes = resolveAssetClasses(include, exclude);
  } catch (e) {
    throw e;
  }

  let rows: RankedAssetDto[];
  let volumeBasis: string;

  if (source === "yahoo_us") {
    rows = [];
    if (classes.has("us_stock")) {
      const kind = direction === "up" ? "gainers" : "losers";
      rows = await fetchYahooDayMovers(kind, limit);
    }
    if (classes.has("crypto")) {
      const cryptoRows = await fetchBybitSpotAllTickerRows();
      rows = [...rows, ...cryptoRows];
    }
    if (classes.has("kr_stock")) {
      const krRows = await fetchKrStockRowsFromNaver();
      rows = [...rows, ...krRows];
    }
    if (classes.has("commodity")) {
      const commodityEntries = FEED_UNIVERSE.filter(
        (e) => e.assetClass === "commodity",
      );
      for (const entry of commodityEntries) {
        const row = await buildRow(entry);
        if (row) rows.push(row);
        await sleep(75);
      }
    }
    const yahooParts: string[] = [];
    if (classes.has("us_stock")) {
      yahooParts.push("yahoo_predefined_screener_intraday_pct_est_for_us_equity");
    }
    if (classes.has("crypto")) {
      yahooParts.push("bybit_spot_all_pairs_price24hPcnt");
    }
    if (classes.has("kr_stock")) {
      yahooParts.push("naver_finance_sise_rise_fall_html_crawl_for_kr_stock");
    }
    if (classes.has("commodity")) {
      yahooParts.push("daily_session_volume_vs_prior_session_yahoo_chart_commodity");
    }
    volumeBasis = yahooParts.join(";") || "none";
  } else {
    const entries = FEED_UNIVERSE.filter(
      (e) =>
        classes.has(e.assetClass) &&
        e.assetClass !== "crypto" &&
        e.assetClass !== "kr_stock",
    );
    rows = [];
    for (const entry of entries) {
      const row = await buildRow(entry);
      if (row) rows.push(row);
      await sleep(75);
    }
    if (classes.has("crypto")) {
      const cryptoRows = await fetchBybitSpotAllTickerRows();
      rows = [...rows, ...cryptoRows];
    }
    if (classes.has("kr_stock")) {
      const krRows = await fetchKrStockRowsFromNaver();
      rows = [...rows, ...krRows];
    }
    const uniParts: string[] = [];
    if (classes.has("crypto")) {
      uniParts.push("bybit_spot_all_pairs_price24hPcnt");
    }
    if (classes.has("kr_stock")) {
      uniParts.push("naver_finance_sise_rise_fall_html_crawl_for_kr_stock");
    }
    if (entries.length > 0) {
      uniParts.push("daily_session_volume_vs_prior_session_yahoo_chart");
    }
    volumeBasis = uniParts.join(";") || "none";
  }

  const items = finalizeRankings(direction, rows, limit);

  const body: FeedRankingsResponse = {
    asOf: new Date().toISOString(),
    volumeBasis,
    items,
  };

  cache.set(key, { at: Date.now(), body });
  return body;
}
