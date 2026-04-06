import type { CommodityKind } from "./types";

type SpotRow = { yahoo: string; commodityKind: CommodityKind };

/**
 * FX·현물식 코드(XAUUSD 등) → Yahoo Finance 선물/현물 티커.
 * 관심 폭주 등에서 AI가 crypto 또는 잘못된 commodity 심볼을 줄 때 상세·차트가 깨지지 않게 함.
 * (CoinGecko는 해당 현물에 대응 코인이 없음)
 */
const SPOT_TO_YAHOO: Record<string, SpotRow> = {
  XAUUSD: { yahoo: "GC=F", commodityKind: "gold" },
  "XAU=X": { yahoo: "GC=F", commodityKind: "gold" },
  XAGUSD: { yahoo: "SI=F", commodityKind: "silver" },
  "XAG=X": { yahoo: "SI=F", commodityKind: "silver" },
  XPTUSD: { yahoo: "PL=F", commodityKind: "platinum" },
  XPDUSD: { yahoo: "PA=F", commodityKind: "palladium" },
  USOIL: { yahoo: "CL=F", commodityKind: "crude_oil" },
  UKOIL: { yahoo: "BZ=F", commodityKind: "crude_oil" },
  WTICOUSD: { yahoo: "CL=F", commodityKind: "crude_oil" },
  BRENTUSD: { yahoo: "BZ=F", commodityKind: "crude_oil" },
};

function normalizeSpotKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function commoditySpotAliasToYahoo(raw: string): SpotRow | null {
  const k = normalizeSpotKey(raw);
  if (k.length === 0) return null;
  return SPOT_TO_YAHOO[k] ?? null;
}
