import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

/**
 * Binance Spot 공개 REST — **한 번의 요청**으로 전 종목 24h 티커.
 * Vercel(미국) 등에서 Bybit 403 회피용. (지역에 따라 Binance도 막힐 수 있음)
 * @see https://binance-docs.github.io/apidocs/spot/en/#24hr-ticker-price-change-statistics
 */

const BINANCE_SPOT = "https://api.binance.com";

/** USDT 페어 최소 24h 거래대금(quote, USDT) — Bybit turnover와 동일 목적 */
const DEFAULT_MIN_QUOTE_VOLUME_USDT = 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type Binance24hTicker = {
  symbol: string;
  priceChangePercent: string;
  quoteVolume: string;
};

/**
 * Bybit `bybit-spot` 와 동일 규칙 — 스테이블·스테이블 페어 제외
 */
function isStableOrFiatSpot(symbol: string): boolean {
  const u = symbol.toUpperCase();
  const exact = new Set([
    "USDCUSDT",
    "USDTUSDC",
    "USDEUSDT",
    "USDCUSDE",
    "DAIUSDT",
    "FDUSDUSDT",
    "TUSDUSDT",
    "USDPUSDT",
    "PYUSDUSDT",
    "EURUSDT",
    "USDDUSDT",
  ]);
  if (exact.has(u)) return true;
  const m = u.match(/^([A-Z0-9]+)(USDT|USDC)$/);
  if (!m) return true;
  const base = m[1];
  if (
    [
      "USDC",
      "USDT",
      "DAI",
      "FDUSD",
      "TUSD",
      "USDP",
      "USDE",
      "USDD",
      "PYUSD",
      "EUR",
      "BUSD",
    ].includes(base)
  ) {
    return true;
  }
  return false;
}

function displayNameFromUsdtPair(symbol: string): string {
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4);
  if (symbol.endsWith("USDC")) return symbol.slice(0, -4);
  return symbol;
}

/**
 * 스팟 USDT 페어 전체 `ticker/24hr` → 급등/급락 랭킹 후보 행.
 * `priceChangePercent` 는 이미 퍼센트(예: "1.25" = +1.25%).
 */
export async function fetchBinanceSpotUsdtTickerRows(
  minQuoteVolumeUsdt: number = DEFAULT_MIN_QUOTE_VOLUME_USDT,
): Promise<RankedAssetDto[]> {
  const url = `${BINANCE_SPOT}/api/v3/ticker/24hr`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; DopamineAssets/1.0)",
    },
  });
  if (!response.ok) {
    throw new Error(`Binance HTTP ${response.status} for spot ticker/24hr`);
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("Binance: expected ticker array");
  }

  const out: RankedAssetDto[] = [];

  for (const row of data as Binance24hTicker[]) {
    const sym = row.symbol?.trim();
    if (!sym || !sym.endsWith("USDT")) continue;
    if (isStableOrFiatSpot(sym)) continue;

    const qv = Number.parseFloat(row.quoteVolume ?? "0");
    if (!Number.isFinite(qv) || qv < minQuoteVolumeUsdt) continue;

    const priceChangePct = Number.parseFloat(row.priceChangePercent ?? "");
    if (!Number.isFinite(priceChangePct)) continue;

    const volumeChangePct = 0;
    const score = dopamineScore(priceChangePct, volumeChangePct);

    out.push({
      symbol: sym,
      name: displayNameFromUsdtPair(sym),
      assetClass: "crypto",
      priceChangePct: round2(priceChangePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }

  return out;
}
