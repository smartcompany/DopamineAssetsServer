export type AssetClass = "us_stock" | "kr_stock" | "crypto" | "commodity" | "theme";

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
  /** kr_stock: `refresh-feed-cache`가 Yahoo quoteSummary 표기(영문·라틴)로 맞춤. 한글 UI는 `nameKo`→`name` 치환 */
  name: string;
  /** 네이버 종목 메인 제목 — `refresh-feed-cache`가 채움. `locale=ko` 랭킹 응답에서 `name`으로 승격 */
  nameKo?: string;
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
  /** Yahoo 티커 목록 — 뉴스 검색·클라이언트 표시용 */
  symbols: string[];
  /** 종목 상세 진입용 — 테마 구성 첫 심볼 + 추정 asset_class */
  detailSymbol: string;
  detailAssetClass: AssetClass;
};

export type MarketSummaryDto = {
  /** 한국어 시장 요약 본문 (지수 흐름 서술) */
  briefing: string | null;
  briefingEn: string | null;
  attribution: string | null;
  attributionEn: string | null;
  kimchiPremiumPct: number | null;
  usdKrw: number | null;
  /** @deprecated 호환용 — briefing 사용 */
  marketStatus: string | null;
};

/** GET /api/feed/asset-detail 응답 */
export type AssetDetailDto = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** [assetClass] === theme 일 때만 — 차트·구성 조회용 */
  themeId?: string;
  /** [assetClass] === theme 일 때만 — 뉴스 티커 검색 */
  themeSymbols?: string[];
  commodityKind?: CommodityKind;
  /** 섹터·대분류 */
  sector: string | null;
  industry: string | null;
  marketCap: string | null;
  /**
   * 시가총액 원시값 — [currency]와 동일 단위(예: KRW=원, USD=달러).
   * 클라이언트가 로케일별 표기(한국어+KRW → 백만 단위 등)에 사용.
   */
  marketCapRaw: number | null;
  /** 암호화폐(CoinGecko) 시총 순위, 그 외 null */
  marketCapRank: number | null;
  /** 암호화폐(CoinGecko) USD 현재가 표시 문자열, 그 외 null */
  currentPrice: string | null;
  exchange: string | null;
  currency: string | null;
  description: string | null;
  website: string | null;
  baseCurrency: string | null;
  quoteCurrency: string | null;
  dataSources: string[];
  asOf: string;
  /** 배치 LLM이 같은 UTC 일자에 저장한 요약 (없으면 null) */
  moveSummaryKo: string | null;
};

export type FeedUniverseEntry = {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  commodityKind?: CommodityKind;
};
