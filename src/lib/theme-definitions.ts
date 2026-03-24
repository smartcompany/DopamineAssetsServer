/**
 * 테마 = Yahoo Finance 심볼 바구니. 일봉 등락·거래량 변화를 집계해 노출한다.
 * (섹터 ETF 단일 티커보다 구성 종목 평균이 “테마” 느낌에 가깝다.)
 */
export type ThemeDefinition = {
  id: string;
  /** API 응답 name — 앱이 한국어 우선이면 한글 라벨 */
  name: string;
  symbols: string[];
};

export const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: "crypto-equities",
    name: "코인·디지털자산 관련주",
    symbols: ["COIN", "MSTR", "RIOT", "MARA", "CLSK", "HOOD"],
  },
  {
    id: "ai-datacenter",
    name: "AI·데이터센터",
    symbols: ["NVDA", "AMD", "SMCI", "AVGO", "ANET", "DELL"],
  },
  {
    id: "mega-tech",
    name: "미국 빅테크",
    symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX"],
  },
  {
    id: "kr-semiconductor",
    name: "한국 반도체·대형주",
    symbols: ["000660.KS", "005930.KS", "035420.KS", "035720.KQ", "006400.KS", "373220.KS"],
  },
  {
    id: "china-adr",
    name: "중국 ADR",
    symbols: ["BABA", "JD", "PDD", "BIDU", "NTES", "LI"],
  },
  {
    id: "energy-commodity",
    name: "에너지·원자재",
    symbols: ["XLE", "CL=F", "NG=F", "COP", "CVX", "XOM"],
  },
  {
    id: "fintech",
    name: "핀테크·결제",
    symbols: ["PYPL", "XYZ", "V", "MA", "SOFI", "AFRM"],
  },
  {
    id: "defense-space",
    name: "방산·우주",
    symbols: ["LMT", "NOC", "RTX", "GD", "LHX", "RKLB"],
  },
];
