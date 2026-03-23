export type AssetClass = "us_stock" | "kr_stock" | "crypto" | "commodity";

export type CommodityKind =
  | "crude_oil"
  | "gold"
  | "silver"
  | "natural_gas"
  | "copper"
  | "platinum"
  | "palladium"
  | "gasoline"
  | "heating_oil"
  | "coffee"
  | "sugar"
  | "cocoa"
  | "cotton"
  | "orange_juice"
  | "live_cattle"
  | "lean_hogs"
  | "corn"
  | "soybeans"
  | "wheat"
  | "soybean_meal"
  | "other";

export type RankedAssetDto = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  commodityKind?: CommodityKind;
  priceChangePct: number;
  volumeChangePct: number;
  dopamineScore: number;
  summaryLine?: string;
};

export type ThemeItemDto = {
  id: string;
  name: string;
  avgChangePct: number;
  volumeLiftPct: number;
  symbolCount: number;
  themeScore: number;
};

export type MarketSummaryDto = {
  kimchiPremiumPct: number | null;
  usdKrw: number | null;
  marketStatus: string | null;
};

export type FeedUniverseEntry = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  commodityKind?: CommodityKind;
};
