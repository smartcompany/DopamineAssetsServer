export const YAHOO_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (compatible; DopamineAssets/1.0; +https://github.com)",
};

export type DailyBar = {
  /** Unix seconds (session start) */
  t: number;
  close: number;
  volume: number;
};

/**
 * Yahoo Finance v8 chart, interval=1d.
 * 직전 거래일 종가 대비 최근 종가(또는 당일 봉) 등락 계산에 쓰인다 (스펙 §2.1).
 */
export async function fetchYahooDailyBars(
  symbol: string,
  rangeDays = 21,
): Promise<DailyBar[]> {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - rangeDays * 86400;
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?period1=${period1}&period2=${period2}&interval=1d`;

  const response = await fetch(url, { headers: YAHOO_HEADERS });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Yahoo HTTP ${response.status} for ${symbol}: ${text.slice(0, 200)}`);
  }

  const data: unknown = await response.json();
  const chart = data as {
    chart?: {
      error?: unknown;
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ close?: (number | null)[]; volume?: (number | null)[] }> };
      }>;
    };
  };

  if (chart.chart?.error) {
    throw new Error(`Yahoo chart error for ${symbol}: ${JSON.stringify(chart.chart.error)}`);
  }

  const result = chart.chart?.result?.[0];
  if (!result) {
    throw new Error(`Yahoo: no result for ${symbol}`);
  }

  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const closes = quote?.close ?? [];
  const volumes = quote?.volume ?? [];

  const out: DailyBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const c = closes[i];
    const v = volumes[i] ?? 0;
    if (typeof c === "number" && Number.isFinite(c) && c > 0) {
      out.push({
        t: timestamps[i]!,
        close: c,
        volume: typeof v === "number" && Number.isFinite(v) ? v : 0,
      });
    }
  }

  if (out.length === 0) {
    throw new Error(`Yahoo: no valid daily bars for ${symbol}`);
  }

  return out;
}
