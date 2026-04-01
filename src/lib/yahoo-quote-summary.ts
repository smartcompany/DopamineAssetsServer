import YahooFinance from "yahoo-finance2";
import type { QuoteSummaryResult } from "yahoo-finance2/modules/quoteSummary-iface";

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

/** 미국·한국 주식·원자재 등 quoteSummary 필요 시 — 크럼/쿠키는 yahoo-finance2 가 처리 */
const MODULES = [
  "assetProfile",
  "summaryProfile",
  "summaryDetail",
  "price",
  "defaultKeyStatistics",
  "quoteType",
] as const;

let client: InstanceType<typeof YahooFinance> | null = null;

function getYahooFinance(): InstanceType<typeof YahooFinance> {
  if (!client) {
    client = new YahooFinance();
  }
  return client;
}

function pickText(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function formatMarketCap(n: number, currencyCode: string): string {
  const code =
    typeof currencyCode === "string" && /^[A-Za-z]{3}$/.test(currencyCode)
      ? currencyCode.toUpperCase()
      : "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return String(n);
  }
}

function mapResult(symbol: string, r: QuoteSummaryResult): YahooQuoteSummaryDetail {
  const sp = r.summaryProfile;
  const ap = r.assetProfile;
  const pr = r.price;
  const sd = r.summaryDetail;

  const sector = pickText(sp?.sector) ?? pickText(ap?.sector);
  const industry = pickText(sp?.industry) ?? pickText(ap?.industry);
  const description =
    pickText(sp?.longBusinessSummary) ?? pickText(ap?.longBusinessSummary);
  const website = pickText(ap?.website) ?? pickText(sp?.website);

  const currency =
    pickText(pr?.currency) ?? (typeof sd?.currency === "string" ? sd.currency : null);

  const mcRaw = sd?.marketCap ?? pr?.marketCap;
  const marketCapFmt =
    typeof mcRaw === "number" && Number.isFinite(mcRaw) && mcRaw > 0
      ? formatMarketCap(mcRaw, currency ?? "USD")
      : null;

  const displayName =
    pickText(pr?.longName) ??
    pickText(pr?.shortName) ??
    pickText(ap?.name) ??
    symbol;

  return {
    displayName,
    sector,
    industry,
    marketCapFmt,
    exchange: pickText(pr?.exchangeName) ?? pickText(pr?.exchange),
    currency,
    description,
    website,
  };
}

/**
 * Yahoo `quoteSummary` — [yahoo-finance2](https://github.com/gadicc/yahoo-finance2) 사용
 * (UA·crumb·쿠키·Origin/Referer 를 라이브러리 기본값과 동일하게 맞춤)
 */
export async function fetchYahooQuoteSummary(
  symbol: string,
): Promise<YahooQuoteSummaryDetail | null> {
  const sym = symbol.trim();
  if (!sym) return null;

  try {
    const yf = getYahooFinance();
    const result = await yf.quoteSummary(sym, { modules: [...MODULES] });
    if (!result || typeof result !== "object") {
      return null;
    }
    const out = mapResult(sym, result as QuoteSummaryResult);
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_YAHOO === "1") {
      console.log(`[yahoo-quote-summary] ${sym} parsed:`, JSON.stringify(out));
    }
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[yahoo-quote-summary] ${sym} failed: ${msg.slice(0, 200)}`);
    return null;
  }
}
