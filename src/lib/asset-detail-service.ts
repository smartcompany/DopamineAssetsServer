import { fetchBybitSpotInstrumentDetail } from "./bybit-instrument-detail";
import type { AssetClass, AssetDetailDto, CommodityKind } from "./types";
import { fetchYahooQuoteSummary } from "./yahoo-quote-summary";

function cryptoSymbolToYahooUsd(symbol: string): string | null {
  const u = symbol.toUpperCase().trim();
  if (u.endsWith("USDT")) {
    const base = u.slice(0, -4);
    if (base.length === 0) return null;
    return `${base}-USD`;
  }
  if (u.endsWith("USDC")) {
    const base = u.slice(0, -4);
    if (base.length === 0) return null;
    return `${base}-USD`;
  }
  return null;
}

/**
 * Yahoo Finance 심볼 (랭킹 심볼 → 차트/요약용).
 */
export function resolveYahooSymbol(
  assetClass: AssetClass,
  symbol: string,
): string | null {
  const s = symbol.trim();
  switch (assetClass) {
    case "us_stock":
    case "kr_stock":
    case "commodity":
      return s;
    case "crypto": {
      const y = cryptoSymbolToYahooUsd(s);
      return y;
    }
    default:
      return null;
  }
}

export async function getAssetDetail(params: {
  symbol: string;
  assetClass: AssetClass;
  name: string;
  commodityKind?: CommodityKind;
}): Promise<AssetDetailDto> {
  const { symbol, assetClass, name, commodityKind } = params;
  const dataSources: string[] = [];
  const asOf = new Date().toISOString();

  let yahooSym = resolveYahooSymbol(assetClass, symbol);
  console.log("[asset-detail] request", {
    symbol,
    assetClass,
    name,
    yahooSym,
  });
  let yahoo = null;
  if (yahooSym) {
    try {
      yahoo = await fetchYahooQuoteSummary(yahooSym);
      if (yahoo) {
        dataSources.push(`yahoo_quote_summary:${yahooSym}`);
      }
    } catch (e) {
      console.error("[asset-detail] Yahoo failed", yahooSym, e);
    }
  }

  let baseCurrency: string | null = null;
  let quoteCurrency: string | null = null;
  if (assetClass === "crypto") {
    try {
      const bi = await fetchBybitSpotInstrumentDetail(symbol);
      if (bi) {
        baseCurrency = bi.baseCoin;
        quoteCurrency = bi.quoteCoin;
        dataSources.push("bybit_spot_instruments_info");
      }
    } catch (e) {
      console.error("[asset-detail] Bybit failed", symbol, e);
    }
  }

  const displayName = yahoo?.displayName ?? name ?? symbol;

  const dto = {
    symbol,
    name: displayName,
    assetClass,
    commodityKind,
    sector: yahoo?.sector ?? null,
    industry: yahoo?.industry ?? null,
    marketCap: yahoo?.marketCapFmt ?? null,
    exchange: yahoo?.exchange ?? null,
    currency: yahoo?.currency ?? null,
    description: yahoo?.description ?? null,
    website: yahoo?.website ?? null,
    baseCurrency,
    quoteCurrency,
    dataSources,
    asOf,
  };
  console.log("[asset-detail] response", JSON.stringify(dto));
  return dto;
}
