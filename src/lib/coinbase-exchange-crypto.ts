import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

/**
 * Coinbase Exchange(공개 REST). Bybit과 같이 **상장 마켓 목록 → 시세** 흐름이며,
 * Vercel(미국) 등에서 Bybit 403 회피용.
 * @see https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproducts
 */

const COINBASE_EXCHANGE = "https://api.exchange.coinbase.com";

const HEADERS: HeadersInit = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; DopamineAssets/1.0)",
};

/** stats 요청 상한 (레이트리밋·서버리스 시간). products 전량은 불가에 가깝다. */
const MAX_STATS_FETCH = 120;
/** 동시에 날리는 stats 요청 수 */
const STATS_CONCURRENCY = 8;
const BETWEEN_CHUNK_MS = 140;

/** 우선 stats 할 베이스(대형·거래 많은 쪽 위주). 나머지는 상장 목록에서 id 순으로 채움. */
const PRIORITY_BASES = new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "ADA",
  "DOGE",
  "DOT",
  "AVAX",
  "SHIB",
  "LINK",
  "UNI",
  "ATOM",
  "LTC",
  "NEAR",
  "APT",
  "ARB",
  "OP",
  "INJ",
  "RUNE",
  "AAVE",
  "MKR",
  "SNX",
  "CRV",
  "ETC",
  "FIL",
  "ICP",
  "VET",
  "ALGO",
  "XLM",
  "BCH",
  "HBAR",
  "SEI",
  "SUI",
  "TIA",
  "PEPE",
  "WIF",
  "BONK",
  "FLOKI",
  "TRX",
  "EOS",
  "XTZ",
  "GRT",
  "SAND",
  "MANA",
  "AXS",
  "LDO",
  "STX",
  "PENDLE",
  "JUP",
  "WLD",
  "STRK",
  "PYTH",
  "ONDO",
  "FET",
  "RENDER",
  "TAO",
  "BCH",
  "EGLD",
  "FLOW",
  "KAVA",
  "MINA",
  "ROSE",
  "ZEC",
  "DASH",
  "COMP",
  "YFI",
  "1INCH",
  "ENS",
  "IMX",
  "BLUR",
  "MASK",
  "LRC",
  "ANKR",
  "CHZ",
  "ENJ",
  "BAT",
  "ZRX",
  "KSM",
  "WOO",
  "CRO",
]);

const STABLE_BASE = new Set([
  "USDT",
  "USDC",
  "DAI",
  "BUSD",
  "TUSD",
  "USDP",
  "USDE",
  "GUSD",
  "PYUSD",
  "EUR",
  "GBP",
  "USD",
]);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

type CoinbaseProduct = {
  id: string;
  base_currency: string;
  quote_currency: string;
  status: string;
  trading_disabled?: boolean;
  fx_stablecoin?: boolean;
  cancel_only?: boolean;
};

type CoinbaseStats = {
  open?: string;
  last?: string;
  volume?: string;
};

function coinbaseToRankingSymbol(p: CoinbaseProduct): string | null {
  const base = p.base_currency?.toUpperCase() ?? "";
  const q = p.quote_currency?.toUpperCase() ?? "";
  if (!base || STABLE_BASE.has(base)) return null;
  if (q === "USD") return `${base}USDT`;
  if (q === "USDC") return `${base}USDC`;
  return null;
}

function filterEligibleProducts(products: CoinbaseProduct[]): CoinbaseProduct[] {
  return products.filter((p) => {
    if (p.status !== "online") return false;
    if (p.trading_disabled === true) return false;
    if (p.fx_stablecoin === true) return false;
    if (p.cancel_only === true) return false;
    const q = p.quote_currency?.toUpperCase() ?? "";
    if (q !== "USD" && q !== "USDC") return false;
    const b = p.base_currency?.toUpperCase() ?? "";
    if (!b || STABLE_BASE.has(b)) return false;
    return coinbaseToRankingSymbol(p) !== null;
  });
}

/** 동일 베이스에 USD·USDC 둘 다 있으면 USD 우선 1개만 */
function dedupeByBasePreferUsd(products: CoinbaseProduct[]): CoinbaseProduct[] {
  const m = new Map<string, CoinbaseProduct>();
  for (const p of products) {
    const base = p.base_currency.toUpperCase();
    const cur = m.get(base);
    if (!cur) {
      m.set(base, p);
      continue;
    }
    if (cur.quote_currency === "USDC" && p.quote_currency === "USD") {
      m.set(base, p);
    }
  }
  return [...m.values()];
}

function orderForStatsFetch(products: CoinbaseProduct[]): CoinbaseProduct[] {
  const deduped = dedupeByBasePreferUsd(products);
  const pri: CoinbaseProduct[] = [];
  const rest: CoinbaseProduct[] = [];
  for (const p of deduped) {
    if (PRIORITY_BASES.has(p.base_currency.toUpperCase())) {
      pri.push(p);
    } else {
      rest.push(p);
    }
  }
  pri.sort((a, b) => a.id.localeCompare(b.id));
  rest.sort((a, b) => a.id.localeCompare(b.id));
  return [...pri, ...rest].slice(0, MAX_STATS_FETCH);
}

async function fetchProductStats(productId: string): Promise<CoinbaseStats | null> {
  const url = `${COINBASE_EXCHANGE}/products/${encodeURIComponent(productId)}/stats`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) {
    return null;
  }
  return (await response.json()) as CoinbaseStats;
}

/** 최소 추정 명목 거래대금(USD). stats.volume 은 베이스 수량. */
const MIN_EST_NOTIONAL_USD = 25_000;

function buildRow(
  p: CoinbaseProduct,
  stats: CoinbaseStats,
): RankedAssetDto | null {
  const sym = coinbaseToRankingSymbol(p);
  if (!sym) return null;

  const open = Number.parseFloat(stats.open ?? "");
  const last = Number.parseFloat(stats.last ?? "");
  const vol = Number.parseFloat(stats.volume ?? "");
  if (!Number.isFinite(open) || !Number.isFinite(last) || open <= 0 || last <= 0) {
    return null;
  }
  if (!Number.isFinite(vol) || vol < 0) return null;

  const estNotional = vol * last;
  if (estNotional < MIN_EST_NOTIONAL_USD) return null;

  const priceChangePct = ((last - open) / open) * 100;
  const volumeChangePct = 0;
  const score = dopamineScore(priceChangePct, volumeChangePct);

  return {
    symbol: sym,
    name: p.base_currency,
    assetClass: "crypto",
    priceChangePct: round2(priceChangePct),
    volumeChangePct: round2(volumeChangePct),
    dopamineScore: round2(score),
  };
}

/**
 * Coinbase 상장 USD/USDC 스팟 마켓 중 일부에 대해 24h open→last 등락률로 랭킹 후보 행 생성.
 */
export async function fetchCoinbaseCryptoRankingRows(): Promise<RankedAssetDto[]> {
  const prodRes = await fetch(`${COINBASE_EXCHANGE}/products`, { headers: HEADERS });
  if (!prodRes.ok) {
    throw new Error(`Coinbase products HTTP ${prodRes.status}`);
  }
  const all = (await prodRes.json()) as CoinbaseProduct[];
  const eligible = filterEligibleProducts(all);
  const toFetch = orderForStatsFetch(eligible);

  const out: RankedAssetDto[] = [];

  for (let i = 0; i < toFetch.length; i += STATS_CONCURRENCY) {
    const chunk = toFetch.slice(i, i + STATS_CONCURRENCY);
    const statsList = await Promise.all(chunk.map((p) => fetchProductStats(p.id)));
    for (let j = 0; j < chunk.length; j++) {
      const p = chunk[j]!;
      const s = statsList[j];
      if (!s) continue;
      const row = buildRow(p, s);
      if (row) out.push(row);
    }
    if (i + STATS_CONCURRENCY < toFetch.length) {
      await sleep(BETWEEN_CHUNK_MS);
    }
  }

  return out;
}
