import { commoditySpotAliasToYahoo } from "@/lib/commodity-fx-yahoo";
import { resolveYahooSymbol } from "@/lib/asset-detail-service";
import { fetchCoinGeckoOhlcBarsForCryptoRankingSymbol } from "@/lib/coingecko-chart";
import { jsonWithCors } from "@/lib/cors";
import type { AssetClass } from "@/lib/types";
import { fetchYahooOhlcBars, type OhlcBar } from "@/lib/yahoo-chart";

const CLASSES = new Set<AssetClass>(["us_stock", "kr_stock", "crypto", "commodity"]);

/** `3mo` | `1mo` | `1y` — 일봉 구간 */
function rangeDays(raw: string | null): number {
  switch (raw) {
    case "1mo":
      return 32;
    case "1y":
      return 370;
    case "3mo":
    default:
      return 92;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSymbol = url.searchParams.get("symbol")?.trim() ?? "";
  const assetClass = url.searchParams.get("assetClass")?.trim() as AssetClass | undefined;
  const range = url.searchParams.get("range")?.trim() ?? "3mo";
  const assetName = url.searchParams.get("assetName")?.trim() ?? "";
  const coingeckoId = url.searchParams.get("id")?.trim() ?? "";

  if (!rawSymbol || rawSymbol.length === 0) {
    return jsonWithCors({ error: "missing_symbol" }, { status: 400 });
  }
  if (!assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_asset_class" }, { status: 400 });
  }

  const fxSpot = commoditySpotAliasToYahoo(rawSymbol);
  let assetClassEff = assetClass;
  let symbol: string;
  if (fxSpot && (assetClass === "crypto" || assetClass === "commodity")) {
    symbol = fxSpot.yahoo;
    if (assetClass === "crypto") {
      assetClassEff = "commodity";
    }
  } else if (assetClass === "crypto") {
    symbol = rawSymbol;
  } else {
    symbol = rawSymbol;
  }

  const yahooSym = resolveYahooSymbol(assetClassEff, symbol);
  if (
    !yahooSym &&
    !(assetClassEff === "crypto" && coingeckoId.length > 0)
  ) {
    return jsonWithCors({ error: "unsupported_symbol" }, { status: 400 });
  }

  try {
    const r = range === "1mo" || range === "1y" || range === "3mo" ? range : "3mo";
    let bars: OhlcBar[];
    let chartSource: "yahoo" | "coingecko";

    if (assetClassEff === "crypto") {
      const cg = await fetchCoinGeckoOhlcBarsForCryptoRankingSymbol({
        rankingSymbol: symbol,
        displayName: assetName.length > 0 ? assetName : null,
        range: r,
        coingeckoId: coingeckoId.length > 0 ? coingeckoId : null,
      });
      if (!cg || cg.length === 0) {
        console.error("[asset-chart] CoinGecko returned no bars", {
          symbol,
          yahooSym,
          coingeckoId: coingeckoId || null,
        });
        return jsonWithCors(
          { error: "upstream_failed", detail: "coingecko_no_bars" },
          { status: 502 },
        );
      }
      bars = cg;
      chartSource = "coingecko";
    } else {
      if (!yahooSym) {
        return jsonWithCors({ error: "unsupported_symbol" }, { status: 400 });
      }
      const days = rangeDays(r);
      bars = await fetchYahooOhlcBars(yahooSym, days);
      chartSource = "yahoo";
    }

    return jsonWithCors({
      symbol,
      assetClass: assetClassEff,
      yahooSymbol: yahooSym ?? "",
      chartSource,
      interval: "1d",
      range,
      bars,
    });
  } catch (e) {
    console.error("[asset-chart]", yahooSym ?? symbol, e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "upstream_failed", detail: msg }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
