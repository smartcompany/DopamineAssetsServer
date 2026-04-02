import { fetchCryptoProfileFromCoinGecko } from "./coingecko-asset-detail";
import { fetchMoveSummaryKo } from "./asset-move-summary-batch";
import { THEME_DEFINITIONS } from "./theme-definitions";
import { fetchKrStockNameFromNaver } from "./kr-stock";
import type { AssetClass, AssetDetailDto, CommodityKind } from "./types";
import { fetchYahooQuoteSummary } from "./yahoo-quote-summary";

function cryptoSymbolToYahooUsd(symbol: string): string | null {
  const t = symbol.trim();
  if (/^[A-Za-z0-9]+-USD$/i.test(t)) {
    return t.toUpperCase();
  }
  const u = t.toUpperCase();
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

/** Bybit 대체: `BTCUSDT` 등에서 베이스/쿼트 추정 (Vercel에서 Bybit 403 회피). */
export function parseCryptoPairFromRankingSymbol(symbol: string): {
  base: string;
  quote: string;
} | null {
  const u = symbol.toUpperCase().trim();
  const m = u.match(/^([A-Z0-9]{1,20})(USDT|USDC)$/);
  if (!m) return null;
  return { base: m[1], quote: m[2] };
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
    case "theme":
      return null;
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

  const yahooSym = resolveYahooSymbol(assetClass, symbol);
  console.log("[asset-detail] request", {
    symbol,
    assetClass,
    name,
    yahooSym,
  });
  let yahoo = null;
  if (assetClass !== "crypto" && yahooSym) {
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
    const pair = parseCryptoPairFromRankingSymbol(symbol);
    if (pair) {
      baseCurrency = pair.base;
      quoteCurrency = pair.quote;
      dataSources.push("symbol_parse_crypto_pair");
    }
  }

  let displayName: string;
  let marketCap: string | null;
  let marketCapRaw: number | null = null;
  let marketCapRank: number | null = null;
  let currentPrice: string | null = null;
  let sector: string | null;
  let industry: string | null;
  let exchange: string | null;
  let currency: string | null;
  let description: string | null;
  let website: string | null;

  if (assetClass === "crypto") {
    marketCap = null;
    marketCapRaw = null;
    sector = null;
    industry = null;
    exchange = null;
    currency = null;
    description = null;
    website = null;
    const pair = parseCryptoPairFromRankingSymbol(symbol);
    let cgProfile: Awaited<ReturnType<typeof fetchCryptoProfileFromCoinGecko>> = null;
    if (pair) {
      try {
        const label = name.trim() || symbol;
        cgProfile = await fetchCryptoProfileFromCoinGecko({
          rankingSymbol: symbol,
          baseSymbolUpper: pair.base,
          displayName: label,
        });
        if (cgProfile) {
          dataSources.push(`coingecko_coin:${cgProfile.coinId}`);
          marketCap = cgProfile.marketCapFmt;
          marketCapRaw = null;
          marketCapRank = cgProfile.marketCapRank;
          currentPrice = cgProfile.currentPriceFmt;
          sector = cgProfile.sector;
          industry = cgProfile.industry;
          exchange = cgProfile.exchange;
          currency = cgProfile.currency;
          description = cgProfile.description;
          website = cgProfile.website;
        }
      } catch (e) {
        console.error("[asset-detail] CoinGecko failed", symbol, e);
      }
    }
    displayName = name.trim() || cgProfile?.name || symbol;
  } else {
    let naverKrName: string | null = null;
    if (assetClass === "kr_stock") {
      try {
        naverKrName = await fetchKrStockNameFromNaver(symbol);
        if (naverKrName && naverKrName.trim().length > 0) {
          dataSources.push(`naver_stock_name:${symbol}`);
        }
      } catch (e) {
        console.error("[asset-detail] Naver kr_stock name failed", symbol, e);
      }
    }

    marketCap = yahoo?.marketCapFmt ?? null;
    marketCapRaw = yahoo?.marketCapRaw ?? null;
    marketCapRank = null;
    currentPrice = null;
    sector = yahoo?.sector ?? null;
    industry = yahoo?.industry ?? null;
    exchange = yahoo?.exchange ?? null;
    currency = yahoo?.currency ?? null;
    description = yahoo?.description ?? null;
    website = yahoo?.website ?? null;
    displayName = naverKrName ?? yahoo?.displayName ?? name ?? symbol;

    if (assetClass === "kr_stock") {
      console.log("[asset-detail][kr_stock name decision]", {
        symbol,
        requestName: name,
        naverKrName,
        yahooDisplayName: yahoo?.displayName,
        finalName: displayName,
      });
    }
  }

  let moveSummaryKo: string | null = null;
  try {
    moveSummaryKo = await fetchMoveSummaryKo({ symbol, assetClass });
  } catch {
    moveSummaryKo = null;
  }

  const dto: AssetDetailDto = {
    symbol,
    name: displayName,
    assetClass,
    commodityKind,
    sector,
    industry,
    marketCap,
    marketCapRaw,
    marketCapRank,
    currentPrice,
    exchange,
    currency,
    description,
    website,
    baseCurrency,
    quoteCurrency,
    dataSources,
    asOf,
    moveSummaryKo,
  };
  console.log("[asset-detail] response", JSON.stringify(dto));
  return dto;
}

/** 테마 상세 — Yahoo 프로필 없이 최소 필드만 (앱은 랭킹 행의 가격·점수를 그대로 표시). */
export function getThemeAssetDetail(themeId: string, displayName: string): AssetDetailDto {
  const def = THEME_DEFINITIONS.find((d) => d.id === themeId);
  if (!def) {
    throw new Error("unknown_theme");
  }
  const label = displayName.trim();
  const sym = label.length > 0 ? label : def.id;
  const asOf = new Date().toISOString();
  return {
    symbol: sym,
    name: sym,
    assetClass: "theme",
    themeId,
    themeSymbols: [...def.symbols],
    sector: null,
    industry: null,
    marketCap: null,
    marketCapRaw: null,
    marketCapRank: null,
    currentPrice: null,
    exchange: null,
    currency: null,
    description: null,
    website: null,
    baseCurrency: null,
    quoteCurrency: null,
    dataSources: ["theme_definition"],
    asOf,
    moveSummaryKo: null,
  };
}
