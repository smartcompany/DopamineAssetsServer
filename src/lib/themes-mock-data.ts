import type { ThemeItemDto } from "./types";

function themeScore(
  avgChangePct: number,
  volumeLiftPct: number,
  symbolCount: number,
) {
  return avgChangePct + volumeLiftPct + symbolCount;
}

const hotThemesRaw: Omit<ThemeItemDto, "themeScore">[] = [
  {
    id: "ai-infra",
    name: "AI 인프라",
    avgChangePct: 6.8,
    volumeLiftPct: 58.0,
    symbolCount: 12,
  },
  {
    id: "crypto-proxy",
    name: "코인 관련주",
    avgChangePct: 7.9,
    volumeLiftPct: 101.0,
    symbolCount: 9,
  },
  {
    id: "small-cap-beta",
    name: "고베타 소형주",
    avgChangePct: 4.2,
    volumeLiftPct: 36.0,
    symbolCount: 22,
  },
];

const crashedThemesRaw: Omit<ThemeItemDto, "themeScore">[] = [
  {
    id: "profit-warning",
    name: "실적 쇼크",
    avgChangePct: -6.5,
    volumeLiftPct: 74.0,
    symbolCount: 8,
  },
  {
    id: "china-exposure",
    name: "중국 노출",
    avgChangePct: -4.1,
    volumeLiftPct: 29.0,
    symbolCount: 15,
  },
];

const emergingThemesRaw: Omit<ThemeItemDto, "themeScore">[] = [
  {
    id: "uranium",
    name: "우라늄 테마",
    avgChangePct: 5.5,
    volumeLiftPct: 210.0,
    symbolCount: 6,
  },
  {
    id: "space",
    name: "우주 산업",
    avgChangePct: 3.9,
    volumeLiftPct: 185.0,
    symbolCount: 7,
  },
];

function withThemeScores(
  rows: Omit<ThemeItemDto, "themeScore">[],
): ThemeItemDto[] {
  return rows.map((t) => ({
    ...t,
    themeScore: themeScore(t.avgChangePct, t.volumeLiftPct, t.symbolCount),
  }));
}

export const themesHot = withThemeScores(hotThemesRaw).sort(
  (a, b) => b.themeScore - a.themeScore,
);

export const themesCrashed = withThemeScores(crashedThemesRaw).sort(
  (a, b) => a.themeScore - b.themeScore,
);

export const themesEmerging = withThemeScores(emergingThemesRaw).sort(
  (a, b) => b.themeScore - a.themeScore,
);
