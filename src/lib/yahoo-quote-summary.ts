import { BROWSER_UA, getYahooCrumbSession } from "./yahoo-session";

const MODULES =
  "assetProfile,summaryProfile,summaryDetail,price,defaultKeyStatistics,quoteType";

export type YahooQuoteSummaryDetail = {
  displayName: string;
  sector: string | null;
  industry: string | null;
  marketCapFmt: string | null;
  exchange: string | null;
  currency: string | null;
  description: string | null;
  website: string | null;
};

type QuoteValue = { raw?: number; fmt?: string; longFmt?: string };

function pickFmt(v: QuoteValue | undefined): string | null {
  if (!v) return null;
  return v.fmt ?? v.longFmt ?? null;
}

function pickText(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

/**
 * Yahoo Finance v10 quoteSummary (비공식). 시세·프로필·시가총액 등.
 */
export async function fetchYahooQuoteSummary(
  symbol: string,
): Promise<YahooQuoteSummaryDetail | null> {
  const enc = encodeURIComponent(symbol);
  const session = await getYahooCrumbSession();

  const u = new URL(
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${enc}`,
  );
  u.searchParams.set("modules", MODULES);
  if (session?.crumb) {
    u.searchParams.set("crumb", session.crumb);
  }

  const headers: HeadersInit = {
    Accept: "application/json",
    "User-Agent": BROWSER_UA,
    ...(session?.cookie ? { Cookie: session.cookie } : {}),
  };

  const response = await fetch(u.toString(), { headers });
  if (!response.ok) {
    const t = await response.text().catch(() => "");
    throw new Error(`Yahoo quoteSummary HTTP ${response.status}: ${t.slice(0, 160)}`);
  }

  const data: unknown = await response.json();
  const root = data as {
    quoteSummary?: { result?: unknown[]; error?: unknown };
    finance?: { result?: unknown[]; error?: unknown };
  };
  const qs = root.quoteSummary ?? root.finance;
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_YAHOO === "1") {
    console.log(
      `[yahoo-quote-summary] ${symbol} resultCount=${qs?.result?.length ?? 0}`,
    );
    if (qs?.error) {
      console.log(`[yahoo-quote-summary] ${symbol} error:`, JSON.stringify(qs.error));
    }
  }
  const result = qs?.result?.[0] as
    | {
        summaryProfile?: { sector?: string; industry?: string; longBusinessSummary?: string };
        assetProfile?: {
          sector?: string;
          industry?: string;
          longBusinessSummary?: string;
          website?: string;
        };
        summaryDetail?: { marketCap?: QuoteValue };
        defaultKeyStatistics?: { marketCap?: QuoteValue };
        price?: {
          longName?: string;
          shortName?: string;
          exchangeName?: string;
          currency?: string;
        };
      }
    | undefined;

  if (!result) {
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_YAHOO === "1") {
      console.log(`[yahoo-quote-summary] ${symbol} no result[0] (empty or missing)`);
    }
    return null;
  }

  const sp = result.summaryProfile;
  const ap = result.assetProfile;
  const pr = result.price;

  const sector = pickText(sp?.sector) ?? pickText(ap?.sector);
  const industry = pickText(sp?.industry) ?? pickText(ap?.industry);
  const description =
    pickText(sp?.longBusinessSummary) ?? pickText(ap?.longBusinessSummary);
  const website = pickText(ap?.website);

  const marketCapFmt =
    pickFmt(result.summaryDetail?.marketCap) ??
    pickFmt(result.defaultKeyStatistics?.marketCap);

  const displayName =
    pickText(pr?.longName) ?? pickText(pr?.shortName) ?? symbol;

  const out = {
    displayName,
    sector,
    industry,
    marketCapFmt,
    exchange: pickText(pr?.exchangeName),
    currency: pickText(pr?.currency),
    description,
    website,
  };
  if (process.env.NODE_ENV !== "production" || process.env.DEBUG_YAHOO === "1") {
    console.log(`[yahoo-quote-summary] ${symbol} parsed:`, JSON.stringify(out));
  }
  return out;
}
