/**
 * coin-portal-bot 과 동일 계열 소스(CryptoPanic → NewsData.io → GNews → CryptoCompare).
 * 검색어는 티커(콤마 구분) 또는 자연어 키워드 모두 허용.
 */

export type AssetNewsItem = {
  title: string;
  url: string;
  publishedAt: string | null;
  source: string | null;
  currencies: string[];
};

export type AssetNewsFetchResult = {
  ok: true;
  query: string;
  source:
    | "cryptopanic"
    | "newsdata"
    | "gnews"
    | "cryptocompare"
    | "googlenews_rss"
    | "googlenews_rss_kr";
  items: AssetNewsItem[];
};

const CRYPTOPANIC_URL = "https://cryptopanic.com/api/v1/posts/";
const NEWSDATA_URL = "https://newsdata.io/api/1/news";
const GNEWS_URL = "https://gnews.io/api/v4/search";
const CRYPTOCOMPARE_NEWS_URL = "https://min-api.cryptocompare.com/data/v2/news/";

/** 검색어에서 뽑은 토큰이 제목에 하나도 없으면(예: APGE인데 GE 기사) 제외 */
const QUERY_STOPWORDS = new Set([
  "stock",
  "stocks",
  "share",
  "shares",
  "crypto",
  "cryptocurrency",
  "commodity",
  "korea",
  "kor",
  "and",
  "or",
  "the",
  "inc",
  "corp",
  "llc",
  "ltd",
  "limited",
  "plc",
  "company",
  "market",
  "us",
]);

function tokenizeQueryForRelevance(query: string): string[] {
  const raw = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  return raw.filter((t) => t.length >= 3 && !QUERY_STOPWORDS.has(t));
}

function dedupeNewsByTitle(items: AssetNewsItem[], max: number): AssetNewsItem[] {
  const seen = new Set<string>();
  const out: AssetNewsItem[] = [];
  for (const it of items) {
    const k = it.title.trim().toLowerCase().replace(/\s+/g, " ");
    if (k.length < 4) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function filterNewsByQueryTokens(
  items: AssetNewsItem[],
  query: string,
): AssetNewsItem[] {
  const tokens = tokenizeQueryForRelevance(query);
  if (tokens.length === 0) return items;
  return items.filter((it) => {
    const tl = it.title.toLowerCase();
    return tokens.some((tok) => tl.includes(tok));
  });
}

/** 동일 제목(지역만 다른 시디케이션) 제거 + 검색어 토큰이 제목에 없는 기사는 버림 */
function refineNewsItems(
  raw: AssetNewsItem[],
  query: string,
  limit: number,
): AssetNewsItem[] {
  const multi = isMultiSegmentSearchQuery(query);
  const cap = multi
    ? Math.min(100, Math.max(raw.length, limit * 4))
    : Math.min(30, Math.max(raw.length, limit));
  const deduped = dedupeNewsByTitle(raw, cap);
  if (multi) {
    // 다중 티커: 헤드라인에 티커 문자열이 안 나오는 경우가 많아(브랜드명·일반어) 공급자 결과를 그대로 사용
    return deduped.slice(0, limit);
  }
  const tokens = tokenizeQueryForRelevance(query);
  if (tokens.length === 0) {
    return deduped.slice(0, limit);
  }
  const filtered = filterNewsByQueryTokens(deduped, query);
  if (filtered.length === 0) {
    return [];
  }
  return filtered.slice(0, limit);
}

function looksLikeTickerList(q: string): boolean {
  const t = q.trim();
  return /^[A-Za-z0-9]+(?:,[A-Za-z0-9]+)*$/.test(t) && t.length <= 80;
}

/** 콤마로 잇된 검색(테마 구성 티커 등) — 제목 토큰 필터가 과하게 걸러 502에 가깝게 빈 결과가 나기 쉬움 */
function isMultiSegmentSearchQuery(query: string): boolean {
  const parts = query
    .split(",")
    .map((s) => s.trim())
    .filter((p) => p.length > 0);
  return parts.length >= 2;
}

/**
 * NewsData / GNews / Google News RSS 는 콤마 나열을 AND에 가깝게 해석하는 경우가 많음.
 * 티커 바구니는 `A OR B OR C` 형태로 보내 "어느 하나" 관련 기사를 모은다.
 */
function buildOrQueryForNewsProviders(rawQuery: string): string {
  const trimmed = rawQuery.trim();
  if (!isMultiSegmentSearchQuery(trimmed)) {
    return trimmed;
  }
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((p) => p.length > 0);
  return parts
    .map((p) => {
      if (/[^a-zA-Z0-9.]/.test(p)) {
        const safe = p.replace(/"/g, "");
        return `"${safe}"`;
      }
      return p;
    })
    .join(" OR ");
}

function toCryptoPanicCurrencies(q: string): string {
  return q
    .trim()
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .join(",");
}

async function fetchCryptoPanic(
  query: string,
  limit: number,
): Promise<AssetNewsItem[] | null> {
  const key = process.env.CRYPTOPANIC_API_KEY?.trim();
  if (!key || !looksLikeTickerList(query)) return null;

  const currencies = toCryptoPanicCurrencies(query);
  const url = new URL(CRYPTOPANIC_URL);
  url.searchParams.set("auth_token", key);
  url.searchParams.set("filter", "news");
  url.searchParams.set("currencies", currencies);
  url.searchParams.set("public", "true");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as { results?: unknown[] };
  const results = data.results;
  if (!Array.isArray(results)) return [];

  const out: AssetNewsItem[] = [];
  for (const row of results) {
    if (typeof row !== "object" || row === null) continue;
    const o = row as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const urlStr = typeof o.url === "string" ? o.url.trim() : "";
    if (!title || !urlStr) continue;
    const published =
      typeof o.published_at === "string" ? o.published_at.trim() : null;
    const src =
      typeof o.source === "object" &&
      o.source !== null &&
      typeof (o.source as { title?: string }).title === "string"
        ? (o.source as { title: string }).title.trim()
        : null;
    const curRaw = o.currencies;
    const currencies: string[] = [];
    if (Array.isArray(curRaw)) {
      for (const c of curRaw) {
        if (typeof c === "object" && c !== null && "code" in c) {
          const code = (c as { code?: string }).code;
          if (typeof code === "string" && code.trim()) currencies.push(code.trim());
        }
      }
    }
    out.push({
      title,
      url: urlStr,
      publishedAt: published,
      source: src,
      currencies,
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchNewsData(query: string, limit: number): Promise<AssetNewsItem[] | null> {
  const key = process.env.NEWSDATA_API_KEY?.trim();
  if (!key) return null;

  const url = new URL(NEWSDATA_URL);
  url.searchParams.set("apikey", key);
  url.searchParams.set("q", buildOrQueryForNewsProviders(query));
  url.searchParams.set("language", "en");
  url.searchParams.set("category", "business");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as { results?: unknown[] };
  const results = data.results;
  if (!Array.isArray(results)) return [];

  const out: AssetNewsItem[] = [];
  for (const row of results) {
    if (typeof row !== "object" || row === null) continue;
    const o = row as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const link = typeof o.link === "string" ? o.link.trim() : "";
    if (!title || !link) continue;
    const pub = typeof o.pubDate === "string" ? o.pubDate.trim() : null;
    const sid =
      typeof o.source_id === "string" ? o.source_id.trim() : "NewsData.io";
    out.push({
      title,
      url: link,
      publishedAt: pub,
      source: sid,
      currencies: [],
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchGNews(query: string, limit: number): Promise<AssetNewsItem[] | null> {
  const token = process.env.GNEWS_API_KEY?.trim();
  if (!token) return null;

  const max = Math.min(limit, 100);
  const url = new URL(GNEWS_URL);
  url.searchParams.set("q", query.trim());
  url.searchParams.set("lang", "en");
  url.searchParams.set("country", "us");
  url.searchParams.set("max", String(max));
  url.searchParams.set("token", token);

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as { articles?: unknown[] };
  const articles = data.articles;
  if (!Array.isArray(articles)) return [];

  const out: AssetNewsItem[] = [];
  for (const row of articles) {
    if (typeof row !== "object" || row === null) continue;
    const o = row as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const link = typeof o.url === "string" ? o.url.trim() : "";
    if (!title || !link) continue;
    const pub = typeof o.publishedAt === "string" ? o.publishedAt.trim() : null;
    let src: string | null = null;
    if (typeof o.source === "object" && o.source !== null) {
      const s = (o.source as { name?: string }).name;
      if (typeof s === "string") src = s.trim();
    }
    out.push({
      title,
      url: link,
      publishedAt: pub,
      source: src,
      currencies: [],
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchCryptoCompare(
  query: string,
  limit: number,
): Promise<AssetNewsItem[] | null> {
  const apiKey = process.env.CRYPTOCOMPARE_API_KEY?.trim();
  if (!apiKey || !looksLikeTickerList(query)) return null;

  const categories = toCryptoPanicCurrencies(query);
  const url = new URL(CRYPTOCOMPARE_NEWS_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("categories", categories);
  url.searchParams.set("excludeCategories", "Sponsored");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    Data?: Array<{
      title?: string;
      url?: string;
      published_on?: number;
      source?: string;
      categories?: string;
    }>;
  };
  const rows = data.Data;
  if (!Array.isArray(rows)) return [];

  const out: AssetNewsItem[] = [];
  for (const article of rows) {
    const title = typeof article.title === "string" ? article.title.trim() : "";
    const link = typeof article.url === "string" ? article.url.trim() : "";
    if (!title || !link) continue;
    const published =
      typeof article.published_on === "number"
        ? new Date(article.published_on * 1000).toISOString()
        : null;
    const src =
      typeof article.source === "string" ? article.source.trim() : "CryptoCompare";
    const cats = article.categories
      ? article.categories.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    out.push({
      title,
      url: link,
      publishedAt: published,
      source: src,
      currencies: cats,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Google News RSS. `kr` 은 한국 매체·한국어 헤드라인 비중이 큼 (한국 주식 보강용). */
async function fetchGoogleNewsRss(
  query: string,
  limit: number,
  region: "us" | "kr" = "us",
): Promise<AssetNewsItem[] | null> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", buildOrQueryForNewsProviders(query));
  if (region === "kr") {
    url.searchParams.set("hl", "ko");
    url.searchParams.set("gl", "KR");
    url.searchParams.set("ceid", "KR:ko");
  } else {
    url.searchParams.set("hl", "en-US");
    url.searchParams.set("gl", "US");
    url.searchParams.set("ceid", "US:en");
  }

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: { "User-Agent": "DopamineAssets/1.0 (asset-news)" },
  });
  if (!res.ok) return null;

  const xml = await res.text();
  const out: AssetNewsItem[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && out.length < limit) {
    const block = m[1] ?? "";
    const titleCdata = block.match(/<title>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/title>/i);
    const titlePlain = block.match(/<title>([^<]*)<\/title>/i);
    const title = (titleCdata?.[1] ?? titlePlain?.[1] ?? "").trim();
    const linkM = block.match(/<link[^>]*>([^<]*)<\/link>/i);
    const link = (linkM?.[1] ?? "").trim();
    const pubM = block.match(/<pubDate>([^<]*)<\/pubDate>/i);
    const publishedAt = (pubM?.[1] ?? "").trim() || null;
    const sourceM = block.match(/<source[^>]*>([^<]*)<\/source>/i);
    const source = (sourceM?.[1] ?? "Google News").trim();
    if (!title || !link) continue;
    out.push({
      title,
      url: link,
      publishedAt,
      source,
      currencies: [],
    });
  }
  return out.length > 0 ? out : [];
}

export type FetchAssetNewsOptions = {
  /** `kr_stock` 이면 Google News RSS(한국)를 다른 소스보다 먼저 시도 */
  assetClass?: string;
};

/**
 * @param query 검색어 (예: `BTC`, `BTC,ETH`, `solana`, `Apple stock`)
 * @param limit 최대 기사 수 (기본 15, 상한 30)
 */
export async function fetchAssetNews(
  query: string,
  limit: number,
  options?: FetchAssetNewsOptions,
): Promise<AssetNewsFetchResult | { ok: false; error: string; detail?: string }> {
  const q = query.trim();
  const lim = Math.min(Math.max(1, limit), 30);
  const multi = isMultiSegmentSearchQuery(q);
  const fetchCap = multi
    ? Math.min(100, Math.max(lim * 5, 40))
    : Math.min(30, Math.max(lim * 3, lim));
  const assetClass = options?.assetClass?.trim();

  const errors: string[] = [];

  if (assetClass === "kr_stock") {
    try {
      const krItems = await fetchGoogleNewsRss(q, fetchCap, "kr");
      if (krItems !== null && krItems.length > 0) {
        const refined = refineNewsItems(krItems, q, lim);
        if (refined.length > 0) {
          return {
            ok: true,
            query: q,
            source: "googlenews_rss_kr",
            items: refined,
          };
        }
      }
      if (krItems === null) {
        errors.push("googlenews_rss_kr:null");
      } else if (krItems.length === 0) {
        errors.push("googlenews_rss_kr:empty");
      } else {
        errors.push("googlenews_rss_kr:filtered_out");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`googlenews_rss_kr:${msg}`);
    }
  }

  const tryOrder: Array<{
    source: AssetNewsFetchResult["source"];
    fn: () => Promise<AssetNewsItem[] | null>;
  }> = [
    { source: "cryptopanic", fn: () => fetchCryptoPanic(q, fetchCap) },
    { source: "newsdata", fn: () => fetchNewsData(q, fetchCap) },
    { source: "gnews", fn: () => fetchGNews(q, fetchCap) },
    { source: "cryptocompare", fn: () => fetchCryptoCompare(q, fetchCap) },
    { source: "googlenews_rss", fn: () => fetchGoogleNewsRss(q, fetchCap, "us") },
  ];

  for (const { source, fn } of tryOrder) {
    try {
      const items = await fn();
      if (items === null) {
        errors.push(`${source}:skipped_or_no_key`);
        continue;
      }
      if (items.length > 0) {
        const refined = refineNewsItems(items, q, lim);
        if (refined.length > 0) {
          return { ok: true, query: q, source, items: refined };
        }
      }
      errors.push(`${source}:empty`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${source}:${msg}`);
    }
  }

  return {
    ok: false,
    error: "no_news_found",
    detail: errors.join(" | ") || "all_providers_failed",
  };
}
