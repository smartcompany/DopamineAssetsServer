import type { FeedUniverseEntry } from "./types";

/**
 * Yahoo Finance 심볼 기준 유니버스 (스펙 §2).
 * 랭킹은 이 목록만 집계한다.
 */
export const FEED_UNIVERSE: FeedUniverseEntry[] = [
  // US
  { symbol: "NVDA", name: "NVIDIA", assetClass: "us_stock" },
  { symbol: "TSLA", name: "Tesla", assetClass: "us_stock" },
  { symbol: "COIN", name: "Coinbase", assetClass: "us_stock" },
  { symbol: "AAPL", name: "Apple", assetClass: "us_stock" },
  { symbol: "MSFT", name: "Microsoft", assetClass: "us_stock" },
  { symbol: "AMD", name: "AMD", assetClass: "us_stock" },
  { symbol: "META", name: "Meta", assetClass: "us_stock" },
  { symbol: "MSTR", name: "MicroStrategy", assetClass: "us_stock" },
  // KR (코스피·코스닥)
  { symbol: "005930.KS", name: "삼성전자", assetClass: "kr_stock" },
  { symbol: "000660.KS", name: "SK하이닉스", assetClass: "kr_stock" },
  { symbol: "035420.KS", name: "NAVER", assetClass: "kr_stock" },
  { symbol: "035720.KQ", name: "카카오", assetClass: "kr_stock" },
  // Crypto
  { symbol: "BTC-USD", name: "Bitcoin", assetClass: "crypto" },
  { symbol: "ETH-USD", name: "Ethereum", assetClass: "crypto" },
  { symbol: "SOL-USD", name: "Solana", assetClass: "crypto" },
  // Commodities (Yahoo Finance 선물 `=F`; 랭킹 20개까지 동일 파이프라인)
  {
    symbol: "CL=F",
    name: "Crude Oil (WTI)",
    assetClass: "commodity",
    commodityKind: "crude_oil",
  },
  {
    symbol: "GC=F",
    name: "Gold",
    assetClass: "commodity",
    commodityKind: "gold",
  },
  {
    symbol: "SI=F",
    name: "Silver",
    assetClass: "commodity",
    commodityKind: "silver",
  },
  {
    symbol: "NG=F",
    name: "Natural Gas",
    assetClass: "commodity",
    commodityKind: "natural_gas",
  },
  {
    symbol: "HG=F",
    name: "Copper",
    assetClass: "commodity",
    commodityKind: "copper",
  },
  {
    symbol: "PL=F",
    name: "Platinum",
    assetClass: "commodity",
    commodityKind: "platinum",
  },
  {
    symbol: "PA=F",
    name: "Palladium",
    assetClass: "commodity",
    commodityKind: "palladium",
  },
  {
    symbol: "RB=F",
    name: "RBOB Gasoline",
    assetClass: "commodity",
    commodityKind: "gasoline",
  },
  {
    symbol: "HO=F",
    name: "Heating Oil",
    assetClass: "commodity",
    commodityKind: "heating_oil",
  },
  {
    symbol: "KC=F",
    name: "Coffee",
    assetClass: "commodity",
    commodityKind: "coffee",
  },
  {
    symbol: "SB=F",
    name: "Sugar #11",
    assetClass: "commodity",
    commodityKind: "sugar",
  },
  {
    symbol: "CC=F",
    name: "Cocoa",
    assetClass: "commodity",
    commodityKind: "cocoa",
  },
  {
    symbol: "CT=F",
    name: "Cotton #2",
    assetClass: "commodity",
    commodityKind: "cotton",
  },
  {
    symbol: "OJ=F",
    name: "Orange Juice",
    assetClass: "commodity",
    commodityKind: "orange_juice",
  },
  {
    symbol: "LE=F",
    name: "Live Cattle",
    assetClass: "commodity",
    commodityKind: "live_cattle",
  },
  {
    symbol: "HE=F",
    name: "Lean Hogs",
    assetClass: "commodity",
    commodityKind: "lean_hogs",
  },
  {
    symbol: "ZC=F",
    name: "Corn",
    assetClass: "commodity",
    commodityKind: "corn",
  },
  {
    symbol: "ZS=F",
    name: "Soybeans",
    assetClass: "commodity",
    commodityKind: "soybeans",
  },
  {
    symbol: "ZW=F",
    name: "Wheat",
    assetClass: "commodity",
    commodityKind: "wheat",
  },
  {
    symbol: "ZM=F",
    name: "Soybean Meal",
    assetClass: "commodity",
    commodityKind: "soybean_meal",
  },
];

/**
 * 일본 상장 주요 종목 (Yahoo `.T`) — 스크리너가 지역별로 안정적이지 않아 일봉 기반 캐시에 사용.
 */
export const JP_STOCK_UNIVERSE: FeedUniverseEntry[] = [
  { symbol: "7203.T", name: "Toyota", assetClass: "jp_stock" },
  { symbol: "6758.T", name: "Sony", assetClass: "jp_stock" },
  { symbol: "9984.T", name: "SoftBank Group", assetClass: "jp_stock" },
  { symbol: "6861.T", name: "Keyence", assetClass: "jp_stock" },
  { symbol: "8306.T", name: "MUFG", assetClass: "jp_stock" },
  { symbol: "7974.T", name: "Nintendo", assetClass: "jp_stock" },
  { symbol: "8035.T", name: "Tokyo Electron", assetClass: "jp_stock" },
  { symbol: "9983.T", name: "Fast Retailing", assetClass: "jp_stock" },
  { symbol: "6098.T", name: "Recruit Holdings", assetClass: "jp_stock" },
  { symbol: "4519.T", name: "Chugai Pharmaceutical", assetClass: "jp_stock" },
  { symbol: "4063.T", name: "Shin-Etsu Chemical", assetClass: "jp_stock" },
  { symbol: "7741.T", name: "HOYA", assetClass: "jp_stock" },
  { symbol: "7269.T", name: "Suzuki", assetClass: "jp_stock" },
  { symbol: "6503.T", name: "Mitsubishi Electric", assetClass: "jp_stock" },
];

/**
 * 중국 A주·치머우 주요 종목 (Yahoo `.SS` / `.SZ`) — 동일하게 일봉 기반 캐시.
 */
export const CN_STOCK_UNIVERSE: FeedUniverseEntry[] = [
  { symbol: "600519.SS", name: "Kweichow Moutai", assetClass: "cn_stock" },
  { symbol: "000858.SZ", name: "Wuliangye", assetClass: "cn_stock" },
  { symbol: "601318.SS", name: "Ping An Insurance", assetClass: "cn_stock" },
  { symbol: "000333.SZ", name: "Midea Group", assetClass: "cn_stock" },
  { symbol: "600036.SS", name: "China Merchants Bank", assetClass: "cn_stock" },
  { symbol: "601899.SS", name: "Zijin Mining", assetClass: "cn_stock" },
  { symbol: "000651.SZ", name: "Gree Electric", assetClass: "cn_stock" },
  { symbol: "600887.SS", name: "Yili Group", assetClass: "cn_stock" },
  { symbol: "300750.SZ", name: "CATL", assetClass: "cn_stock" },
  { symbol: "601988.SS", name: "Bank of China", assetClass: "cn_stock" },
  { symbol: "601398.SS", name: "ICBC", assetClass: "cn_stock" },
  { symbol: "601012.SS", name: "LONGi Green Energy", assetClass: "cn_stock" },
  { symbol: "688981.SS", name: "SMIC", assetClass: "cn_stock" },
  { symbol: "000001.SZ", name: "Ping An Bank", assetClass: "cn_stock" },
];
