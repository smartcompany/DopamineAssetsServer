import { fetchYahooDailyBars } from "./yahoo-chart";

type IndexRow = {
  symbol: string;
  labelKo: string;
  labelEn: string;
  region: "us" | "kr";
};

const INDICES: IndexRow[] = [
  { symbol: "^GSPC", labelKo: "S&P 500", labelEn: "S&P 500", region: "us" },
  { symbol: "^DJI", labelKo: "다우존스", labelEn: "Dow Jones", region: "us" },
  { symbol: "^IXIC", labelKo: "나스닥", labelEn: "Nasdaq", region: "us" },
  { symbol: "^KS11", labelKo: "코스피", labelEn: "KOSPI", region: "kr" },
];

const FLAT_ABS = 0.02;

function fmtPct(p: number): string {
  const sign = p > 0 ? "+" : "";
  return `${sign}${p.toFixed(2)}%`;
}

async function pctVsPriorClose(symbol: string): Promise<number | null> {
  try {
    const bars = await fetchYahooDailyBars(symbol, 18);
    if (bars.length < 2) return null;
    const prev = bars[bars.length - 2]!.close;
    const last = bars[bars.length - 1]!.close;
    if (!(prev > 0) || !(last > 0)) return null;
    return ((last - prev) / prev) * 100;
  } catch (e) {
    console.error(`[yahoo-market-brief] ${symbol}`, e);
    return null;
  }
}

function usToneKo(pcts: number[]): string {
  if (pcts.length === 0) return "보합권에서 마감했습니다";
  const up = pcts.filter((p) => p > FLAT_ABS).length;
  const down = pcts.filter((p) => p < -FLAT_ABS).length;
  if (up > 0 && down > 0) return "혼조세였습니다";
  if (down === 0 && up > 0) return "상승 흐름이었습니다";
  if (up === 0 && down > 0) return "하락 흐름이었습니다";
  return "보합권에서 마감했습니다";
}

function usToneEn(pcts: number[]): string {
  if (pcts.length === 0) return "were little changed";
  const up = pcts.filter((p) => p > FLAT_ABS).length;
  const down = pcts.filter((p) => p < -FLAT_ABS).length;
  if (up > 0 && down > 0) return "traded mixed";
  if (down === 0 && up > 0) return "moved higher";
  if (up === 0 && down > 0) return "moved lower";
  return "were little changed";
}

function krToneKo(p: number): string {
  if (p > FLAT_ABS) return "상승했습니다";
  if (p < -FLAT_ABS) return "하락했습니다";
  return "보합권이었습니다";
}

function buildParagraphKo(
  rows: { labelKo: string; pct: number | null; region: "us" | "kr" }[],
): string | null {
  const us = rows.filter((r) => r.region === "us" && r.pct != null) as {
    labelKo: string;
    pct: number;
  }[];
  const kr = rows.filter((r) => r.region === "kr" && r.pct != null) as {
    labelKo: string;
    pct: number;
  }[];

  const parts: string[] = [];

  if (us.length > 0) {
    const bits = us.map((r) => `${r.labelKo} ${fmtPct(r.pct)}`);
    const tone = usToneKo(us.map((r) => r.pct));
    parts.push(`미국 증시는 ${bits.join(", ")}로 ${tone}.`);
  }

  if (kr.length === 1) {
    const r = kr[0]!;
    parts.push(`국내 ${r.labelKo}는 전일 대비 ${fmtPct(r.pct)} ${krToneKo(r.pct)}.`);
  }

  if (parts.length === 0) return null;
  return parts.join(" ");
}

function buildParagraphEn(
  rows: { labelEn: string; pct: number | null; region: "us" | "kr" }[],
): string | null {
  const us = rows.filter((r) => r.region === "us" && r.pct != null) as {
    labelEn: string;
    pct: number;
  }[];
  const kr = rows.filter((r) => r.region === "kr" && r.pct != null) as {
    labelEn: string;
    pct: number;
  }[];

  const parts: string[] = [];

  if (us.length > 0) {
    const bits = us.map((r) => `${r.labelEn} ${fmtPct(r.pct)}`);
    const tone = usToneEn(us.map((r) => r.pct));
    parts.push(`U.S. markets ${tone}: ${bits.join(", ")}.`);
  }

  if (kr.length === 1) {
    const r = kr[0]!;
    parts.push(`KOSPI ended ${fmtPct(r.pct)} vs. the prior session.`);
  }

  if (parts.length === 0) return null;
  return parts.join(" ");
}

/**
 * Yahoo Finance 일봉(직전 거래일 종가 대비 최근 일봉)로 주요 지수 흐름을 한·영 문장으로 요약한다.
 * 야후의 편집 브리핑 API는 없어, 동일 데이터 소스로 서술형 요약을 생성한다.
 */
export async function buildYahooMarketBrief(): Promise<{
  briefingKo: string;
  briefingEn: string;
  attributionKo: string;
  attributionEn: string;
}> {
  const settled = await Promise.all(
    INDICES.map(async (d) => {
      const pct = await pctVsPriorClose(d.symbol);
      return {
        labelKo: d.labelKo,
        labelEn: d.labelEn,
        region: d.region,
        pct,
      };
    }),
  );

  const ko = buildParagraphKo(settled);
  const en = buildParagraphEn(settled);

  const fallbackKo =
    "지금은 주요 지수 데이터를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  const fallbackEn =
    "We couldn't load major index data right now. Please try again shortly.";

  return {
    briefingKo: ko ?? fallbackKo,
    briefingEn: en ?? fallbackEn,
    attributionKo:
      "전 거래일 대비 등락은 Yahoo Finance 일봉 종가 기준이며, 실시간 시세·장중 변동과 다를 수 있습니다.",
    attributionEn:
      "Moves are vs. the prior session using Yahoo Finance daily closes; they may differ from live prices.",
  };
}
