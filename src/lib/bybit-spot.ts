import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

const BYBIT_BASE = "https://api.bybit.com";

/** 초유동성만 제외 (신규 상장은 낮은 거래대금도 포함하려면 더 낮추면 됨) */
const DEFAULT_MIN_TURNOVER_24H_USDT = 100;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type BybitTickerItem = {
  symbol?: string;
  price24hPcnt?: string;
  turnover24h?: string;
};

type BybitTickersResult = {
  retCode?: number;
  retMsg?: string;
  result?: { list?: BybitTickerItem[] };
};

/**
 * 스테이블·스테이블 간 페어 등 (급등/급락 랭킹에 부적합)
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
    ["USDC", "USDT", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD", "PYUSD", "EUR", "BUSD"].includes(
      base,
    )
  ) {
    return true;
  }
  return false;
}

function displayNameFromBybitSpot(symbol: string): string {
  if (symbol.endsWith("USDT")) return symbol.slice(0, -4);
  if (symbol.endsWith("USDC")) return symbol.slice(0, -4);
  return symbol;
}

/**
 * Bybit V5 spot `price24hPcnt`는 소수 비율 (예: -0.0195 → -1.95%).
 * @see https://bybit-exchange.github.io/docs/v5/market/tickers
 *
 * 심볼을 미리 고정하지 않고 **전체 스팟 티커**를 한 번 받아 행으로 만든다.
 * (신규 상장 페어도 목록에 뜨면 포함 가능)
 */
export async function fetchBybitSpotAllTickerRows(
  minTurnover24hUsdt: number = DEFAULT_MIN_TURNOVER_24H_USDT,
): Promise<RankedAssetDto[]> {
  const url = `${BYBIT_BASE}/v5/market/tickers?category=spot`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Bybit HTTP ${response.status} for spot tickers`);
  }
  const data = (await response.json()) as BybitTickersResult;
  if (data.retCode !== 0) {
    throw new Error(`Bybit retCode ${data.retCode} ${data.retMsg ?? ""}`);
  }

  const list = data.result?.list ?? [];
  const out: RankedAssetDto[] = [];

  for (const t of list) {
    const sym = t.symbol?.trim();
    if (!sym || !t.price24hPcnt) continue;
    if (isStableOrFiatSpot(sym)) continue;

    const turnover = Number.parseFloat(t.turnover24h ?? "0");
    if (!Number.isFinite(turnover) || turnover < minTurnover24hUsdt) continue;

    const raw = Number.parseFloat(t.price24hPcnt);
    if (!Number.isFinite(raw)) continue;

    const priceChangePct = raw * 100;
    const volumeChangePct = 0;
    const score = dopamineScore(priceChangePct, volumeChangePct);

    out.push({
      symbol: sym,
      name: displayNameFromBybitSpot(sym),
      assetClass: "crypto",
      priceChangePct: round2(priceChangePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }

  return out;
}
