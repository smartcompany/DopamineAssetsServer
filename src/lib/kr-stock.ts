import iconv from "iconv-lite";
import { dopamineScore } from "./feed-metrics";
import type { RankedAssetDto } from "./types";

const NAVER_HEADERS: HeadersInit = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: "https://finance.naver.com/",
};

/** 종목명 + 등락률(%) 컬럼. 전일비 컬럼의 tah p11 red02 는 제외하고 red01|nv01 만 매칭 */
const ROW_PCT_RE =
  /<a href="\/item\/main\.naver\?code=(\d{6})" class="tltle">([^<]+)<\/a><\/td>[\s\S]*?<span class="tah p11 (?:red01|nv01)">\s*([+-]?[\d.]*)%\s*<\/span>/g;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 인버스·선물(연동) ETN/ETF 등 급등락 랭킹에서 제외 */
function isExcludedKrStockName(name: string): boolean {
  const compact = name.replace(/\s+/g, "");
  if (compact.includes("인버스")) return true;
  if (compact.includes("선물")) return true;
  return false;
}

async function fetchNaverHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: NAVER_HEADERS });
  if (!response.ok) {
    throw new Error(`Naver HTTP ${response.status} for ${url}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  return iconv.decode(buf, "euc-kr");
}

function parseNaverSiseHtml(html: string, suffix: "KS" | "KQ"): RankedAssetDto[] {
  const rows: RankedAssetDto[] = [];
  const re = new RegExp(ROW_PCT_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const code = m[1];
    const name = m[2]!.trim().replace(/\s+/g, " ");
    if (isExcludedKrStockName(name)) continue;
    const pct = Number.parseFloat(m[3]!);
    if (!Number.isFinite(pct)) continue;
    const priceChangePct = pct;
    const volumeChangePct = 0;
    const score = dopamineScore(priceChangePct, volumeChangePct);
    rows.push({
      symbol: `${code}.${suffix}`,
      name,
      assetClass: "kr_stock",
      priceChangePct: round2(priceChangePct),
      volumeChangePct: round2(volumeChangePct),
      dopamineScore: round2(score),
    });
  }
  return rows;
}

/**
 * 네이버 증권 시세·상세 → 급등/급락 (코스피·코스닥 각각) HTML 크롤링.
 * 등락률은 페이지에 표시된 값(당일 기준)을 사용.
 * @see https://finance.naver.com/sise/sise_rise.naver
 * @see https://finance.naver.com/sise/sise_fall.naver
 */
export async function fetchKrStockRowsFromNaver(): Promise<RankedAssetDto[]> {
  const urls = [
    { url: "https://finance.naver.com/sise/sise_rise.naver?sosok=0", suffix: "KS" as const },
    { url: "https://finance.naver.com/sise/sise_rise.naver?sosok=1", suffix: "KQ" as const },
    { url: "https://finance.naver.com/sise/sise_fall.naver?sosok=0", suffix: "KS" as const },
    { url: "https://finance.naver.com/sise/sise_fall.naver?sosok=1", suffix: "KQ" as const },
  ];

  const bySymbol = new Map<string, RankedAssetDto>();

  for (const { url, suffix } of urls) {
    try {
      const html = await fetchNaverHtml(url);
      const parsed = parseNaverSiseHtml(html, suffix);
      for (const row of parsed) {
        const prev = bySymbol.get(row.symbol);
        if (!prev || Math.abs(row.priceChangePct) > Math.abs(prev.priceChangePct)) {
          bySymbol.set(row.symbol, row);
        }
      }
    } catch (e) {
      console.error(`[kr] naver crawl failed ${url}`, e);
    }
    await new Promise((r) => setTimeout(r, 120));
  }

  return [...bySymbol.values()];
}
