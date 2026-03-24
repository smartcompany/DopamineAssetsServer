import { resolveYahooSymbol } from "@/lib/asset-detail-service";
import { jsonWithCors } from "@/lib/cors";
import { fetchYahooOhlcBars } from "@/lib/yahoo-chart";
import type { AssetClass } from "@/lib/types";

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
  const symbol = url.searchParams.get("symbol")?.trim();
  const assetClass = url.searchParams.get("assetClass")?.trim() as AssetClass | undefined;
  const range = url.searchParams.get("range")?.trim() ?? "3mo";

  if (!symbol || symbol.length === 0) {
    return jsonWithCors({ error: "missing_symbol" }, { status: 400 });
  }
  if (!assetClass || !CLASSES.has(assetClass)) {
    return jsonWithCors({ error: "invalid_asset_class" }, { status: 400 });
  }

  const yahooSym = resolveYahooSymbol(assetClass, symbol);
  if (!yahooSym) {
    return jsonWithCors({ error: "unsupported_symbol" }, { status: 400 });
  }

  try {
    const r = range === "1mo" || range === "1y" || range === "3mo" ? range : "3mo";
    const days = rangeDays(r);
    const bars = await fetchYahooOhlcBars(yahooSym, days);
    return jsonWithCors({
      symbol,
      assetClass,
      yahooSymbol: yahooSym,
      interval: "1d",
      range,
      bars,
    });
  } catch (e) {
    console.error("[asset-chart]", yahooSym, e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "upstream_failed", detail: msg }, { status: 502 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
