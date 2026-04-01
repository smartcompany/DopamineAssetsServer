/**
 * 크립토 자산 상세(개요): CoinGecko `/search` 로 id 확정 → `/coins/{id}` 로 프로필·시총·거래소 등.
 * (코인은 Yahoo quoteSummary 를 쓰지 않음.)
 */

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";

const UA =
  "DopamineAssets/1.0 (asset-detail; +https://github.com/DopamineAssets)";

type SearchCoinRow = {
  id?: string;
  symbol?: string;
  name?: string;
  market_cap_rank?: number | null;
};

type SearchResponse = {
  coins?: SearchCoinRow[];
};

export type CoinGeckoCryptoProfile = {
  coinId: string;
  name: string;
  marketCapFmt: string | null;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  currency: string | null;
  description: string | null;
  website: string | null;
};

const cache = new Map<string, { at: number; result: CoinGeckoCryptoProfile | null }>();
const TTL_MS = 10 * 60 * 1000;

function formatUsdCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(n);
}

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickSectorIndustry(categories: unknown): {
  sector: string | null;
  industry: string | null;
} {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { sector: null, industry: null };
  }
  const strings = categories.filter(
    (c): c is string => typeof c === "string" && c.trim() !== "",
  );
  if (strings.length === 0) return { sector: null, industry: null };
  return {
    sector: strings[0]!.trim(),
    industry: strings.length > 1 ? strings[1]!.trim() : null,
  };
}

function pickDescription(desc: unknown): string | null {
  if (!desc || typeof desc !== "object") return null;
  const d = desc as Record<string, string>;
  const raw = (d.ko ?? d.en ?? "").trim();
  if (!raw) return null;
  const plain = stripHtml(raw);
  if (!plain) return null;
  return plain.length > 12_000 ? `${plain.slice(0, 12_000)}…` : plain;
}

function pickWebsite(links: unknown): string | null {
  if (!links || typeof links !== "object") return null;
  const hp = (links as { homepage?: unknown }).homepage;
  if (!Array.isArray(hp)) return null;
  for (const h of hp) {
    const s = typeof h === "string" ? h.trim() : "";
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
  }
  return null;
}

function pickTopExchange(tickers: unknown): string | null {
  if (!Array.isArray(tickers)) return null;
  let bestName: string | null = null;
  let bestVol = -1;
  const cap = Math.min(tickers.length, 150);
  for (let i = 0; i < cap; i++) {
    const t = tickers[i] as {
      market?: { name?: string };
      converted_volume?: { usd?: number | null };
    };
    const n = t?.market?.name?.trim();
    if (!n) continue;
    const vol = t?.converted_volume?.usd;
    const v = typeof vol === "number" && Number.isFinite(vol) ? vol : 0;
    if (v > bestVol || (v === bestVol && bestName === null)) {
      bestVol = v;
      bestName = n;
    }
  }
  if (bestName) return bestName;
  for (let i = 0; i < cap; i++) {
    const t = tickers[i] as { market?: { name?: string } };
    const n = t?.market?.name?.trim();
    if (n) return n;
  }
  return null;
}

function pickBestCoinMatch(
  coins: SearchCoinRow[] | undefined,
  baseUpper: string,
): SearchCoinRow | null {
  if (!coins?.length) return null;
  const matches = coins.filter(
    (c) => typeof c.symbol === "string" && c.symbol.toUpperCase() === baseUpper,
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const ra = a.market_cap_rank;
    const rb = b.market_cap_rank;
    const na = ra == null || !Number.isFinite(ra) ? 999_999 : ra;
    const nb = rb == null || !Number.isFinite(rb) ? 999_999 : rb;
    return na - nb;
  });
  return matches[0] ?? null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
    });
    if (res.status === 429) {
      console.warn("[coingecko-asset-detail] 429", url.slice(0, 100));
      return null;
    }
    if (!res.ok) {
      console.warn("[coingecko-asset-detail] HTTP", res.status, url.slice(0, 100));
      return null;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error("[coingecko-asset-detail] fetch", e);
    return null;
  }
}

async function searchCoins(query: string): Promise<SearchCoinRow[]> {
  const u = new URL(`${COINGECKO_BASE}/search`);
  u.searchParams.set("query", query.trim().slice(0, 80));
  const data = await fetchJson<SearchResponse>(u.toString());
  return Array.isArray(data?.coins) ? data!.coins! : [];
}

async function fetchCoinDetail(coinId: string): Promise<CoinGeckoCryptoProfile | null> {
  const u = new URL(`${COINGECKO_BASE}/coins/${encodeURIComponent(coinId)}`);
  u.searchParams.set("localization", "true");
  u.searchParams.set("tickers", "true");
  u.searchParams.set("market_data", "true");
  u.searchParams.set("community_data", "false");
  u.searchParams.set("developer_data", "false");
  u.searchParams.set("sparkline", "false");

  const data = await fetchJson<{
    id?: string;
    name?: string;
    categories?: string[];
    description?: Record<string, string>;
    links?: { homepage?: string[] };
    market_data?: { market_cap?: { usd?: number | null } };
    tickers?: unknown[];
  }>(u.toString());

  if (!data || typeof data !== "object") return null;

  const id = typeof data.id === "string" ? data.id.trim() : coinId;
  const coinName =
    typeof data.name === "string" && data.name.trim() !== ""
      ? data.name.trim()
      : id;

  const mcUsd = data.market_data?.market_cap?.usd;
  const marketCapFmt =
    typeof mcUsd === "number" && Number.isFinite(mcUsd) && mcUsd >= 0
      ? formatUsdCompact(mcUsd)
      : null;

  const { sector, industry } = pickSectorIndustry(data.categories);
  const exchange = pickTopExchange(data.tickers);
  const description = pickDescription(data.description);
  const website = pickWebsite(data.links);

  return {
    coinId: id,
    name: coinName,
    marketCapFmt,
    sector,
    industry,
    exchange,
    currency: "USD",
    description,
    website,
  };
}

/**
 * 랭킹 심볼 `BASEUSDT` 등 + 표시 이름으로 CoinGecko 코인 프로필 전체.
 * 검색어는 표시 이름 우선, 없으면 베이스 티커.
 */
export async function fetchCryptoProfileFromCoinGecko(params: {
  rankingSymbol: string;
  baseSymbolUpper: string;
  displayName: string;
}): Promise<CoinGeckoCryptoProfile | null> {
  const { rankingSymbol, baseSymbolUpper, displayName } = params;
  const base = baseSymbolUpper.trim().toUpperCase();
  if (!base) return null;

  const cacheKey = `${rankingSymbol}|${displayName.trim()}|${base}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.result;
  }

  const queries: string[] = [];
  const dn = displayName.trim();
  if (dn.length >= 2) queries.push(dn);
  if (!queries.some((q) => q.toUpperCase() === base)) queries.push(base);

  let out: CoinGeckoCryptoProfile | null = null;

  for (const q of queries) {
    const coins = await searchCoins(q);
    const match = pickBestCoinMatch(coins, base);
    const id = match?.id?.trim();
    if (!id) continue;
    const profile = await fetchCoinDetail(id);
    if (profile) {
      out = profile;
      break;
    }
  }

  cache.set(cacheKey, { at: Date.now(), result: out });
  return out;
}
