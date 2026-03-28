/**
 * 테마 = Yahoo Finance 심볼 바구니. 일봉 등락·거래량 변화를 집계해 노출한다.
 * (섹터 ETF 단일 티커보다 구성 종목 평균이 “테마” 느낌에 가깝다.)
 */
export type ThemeLocale = "en" | "ko";

export type ThemeLocalizedNames = {
  en: string;
  ko: string;
};

export type ThemeDefinition = {
  id: string;
  names: ThemeLocalizedNames;
  symbols: string[];
};

/** 쿼리/Accept-Language 등에서 허용 로케일로 정규화 (기본 en). */
export function normalizeThemeLocale(raw: string | null | undefined): ThemeLocale {
  const s = raw?.trim().toLowerCase() ?? "";
  if (s.startsWith("ko")) return "ko";
  return "en";
}

export function themeDisplayName(def: ThemeDefinition, locale: ThemeLocale): string {
  return locale === "ko" ? def.names.ko : def.names.en;
}

/** 커뮤니티 등 표시명(한/영)으로 테마 id 역검색 — 대소문자 무시. */
export function resolveThemeIdByDisplayName(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  for (const def of THEME_DEFINITIONS) {
    if (def.names.ko.toLowerCase() === t || def.names.en.toLowerCase() === t) {
      return def.id;
    }
  }
  return null;
}

export const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: "crypto-equities",
    names: {
      en: "Crypto & digital asset equities",
      ko: "코인·디지털자산 관련주",
    },
    symbols: ["COIN", "MSTR", "RIOT", "MARA", "CLSK", "HOOD"],
  },
  {
    id: "ai-datacenter",
    names: {
      en: "AI & data center",
      ko: "AI·데이터센터",
    },
    symbols: ["NVDA", "AMD", "SMCI", "AVGO", "ANET", "DELL"],
  },
  {
    id: "mega-tech",
    names: {
      en: "US mega-cap tech",
      ko: "미국 빅테크",
    },
    symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NFLX"],
  },
  {
    id: "kr-semiconductor",
    names: {
      en: "Korea semiconductors & large caps",
      ko: "한국 반도체·대형주",
    },
    symbols: ["000660.KS", "005930.KS", "035420.KS", "035720.KQ", "006400.KS", "373220.KS"],
  },
  {
    id: "china-adr",
    names: {
      en: "China ADRs",
      ko: "중국 ADR",
    },
    symbols: ["BABA", "JD", "PDD", "BIDU", "NTES", "LI"],
  },
  {
    id: "energy-commodity",
    names: {
      en: "Energy & commodities",
      ko: "에너지·원자재",
    },
    symbols: ["XLE", "CL=F", "NG=F", "COP", "CVX", "XOM"],
  },
  {
    id: "fintech",
    names: {
      en: "Fintech & payments",
      ko: "핀테크·결제",
    },
    symbols: ["PYPL", "XYZ", "V", "MA", "SOFI", "AFRM"],
  },
  {
    id: "defense-space",
    names: {
      en: "Defense & space",
      ko: "방산·우주",
    },
    symbols: ["LMT", "NOC", "RTX", "GD", "LHX", "RKLB"],
  },
  {
    id: "biotech-health",
    names: {
      en: "Biotech & healthcare",
      ko: "바이오·헬스케어",
    },
    symbols: ["UNH", "LLY", "JNJ", "MRK", "ABBV", "VRTX"],
  },
  {
    id: "clean-energy",
    names: {
      en: "Clean & renewable energy",
      ko: "클린·신재생 에너지",
    },
    symbols: ["ENPH", "FSLR", "NEE", "ORA", "BE", "RUN"],
  },
  {
    id: "cybersecurity",
    names: {
      en: "Cybersecurity",
      ko: "사이버보안",
    },
    symbols: ["CRWD", "PANW", "ZS", "FTNT", "OKTA", "NET"],
  },
  {
    id: "ev-mobility",
    names: {
      en: "EVs & mobility",
      ko: "전기차·모빌리티",
    },
    symbols: ["TSLA", "RIVN", "LCID", "F", "GM", "MBLY"],
  },
  {
    id: "consumer-lifestyle",
    names: {
      en: "Consumer & lifestyle",
      ko: "소비·라이프스타일",
    },
    symbols: ["LULU", "NKE", "SBUX", "ULTA", "ETSY", "MCD"],
  },
  {
    id: "gold-miners",
    names: {
      en: "Gold & precious metals miners",
      ko: "금·귀금속 광업",
    },
    symbols: ["NEM", "GOLD", "FNV", "AEM", "WPM", "KGC"],
  },
];
