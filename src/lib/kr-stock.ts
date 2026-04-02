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

  const contentType = response.headers.get("content-type") ?? "";
  const charsetMatch = contentType.match(/charset\s*=\s*([^;]+)/i);
  const charsetRaw = charsetMatch?.[1]?.trim()?.toLowerCase() ?? "";

  const decodeUtf8 = () => buf.toString("utf8");
  const decodeEucKr = () => iconv.decode(buf, "euc-kr");
  const debugItemMain = url.includes("finance.naver.com/item/main.naver?code=");

  const extractTitlePreview = (html: string) => {
    const m = html.match(/<title[^>]*>\s*([^<]+)\s*<\/title>/i);
    const t = m?.[1]?.trim() ?? "";
    return t.length > 140 ? t.slice(0, 140) + "…" : t;
  };

  if (charsetRaw.includes("utf-8") || charsetRaw.includes("utf8")) {
    const utf8 = decodeUtf8();
    if (debugItemMain) {
      console.log("[kr-stock][naver decode utf8]", {
        url,
        contentType,
        charsetRaw,
        title: extractTitlePreview(utf8),
      });
    }
    return utf8;
  }

  if (
    charsetRaw.includes("euc-kr") ||
    charsetRaw.includes("euckr") ||
    charsetRaw.includes("ks_c_5601")
  ) {
    const euc = decodeEucKr();
    if (debugItemMain) {
      console.log("[kr-stock][naver decode euc-kr]", {
        url,
        contentType,
        charsetRaw,
        title: extractTitlePreview(euc),
      });
    }
    return euc;
  }

  const utf8 = decodeUtf8();
  const euc = decodeEucKr();
  const hangulUtf8 = (utf8.match(/[\uAC00-\uD7AF]/g) ?? []).length;
  const hangulEuc = (euc.match(/[\uAC00-\uD7AF]/g) ?? []).length;
  const chosen = hangulEuc > hangulUtf8 ? "euc-kr" : "utf-8";

  if (debugItemMain) {
    console.log("[kr-stock][naver decode fallback]", {
      url,
      contentType,
      charsetRaw,
      hangulUtf8,
      hangulEuc,
      chosen,
      titleUtf8: extractTitlePreview(utf8),
      titleEuc: extractTitlePreview(euc),
    });
  }

  return hangulEuc > hangulUtf8 ? euc : utf8;
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

function normalizeKrStockCode(symbol: string): string | null {
  const s = symbol.trim();
  const m = s.match(/^(\d{6})(?:\.(KS|KQ))?$/i);
  if (!m) return null;
  return m[1];
}

function parseKrStockNameFromNaverHtml(html: string): string | null {
  // Naver item main page title example:
  // "계양전기우 : Npay 증권"
  const title = html
    .match(/<title[^>]*>\s*([^<]+?)\s*<\/title>/i)?.[1]
    ?.trim();
  if (title) {
    const cleaned = title
      .split(" : ")[0]
      .split(" - ")[0]
      .split("|")[0]
      .trim();
    if (cleaned) return cleaned;
  }

  // Fallback: try to find a token between "종목명" and "종목코드" in the raw HTML.
  // (HTML 구조가 바뀔 수 있어 폭을 넉넉히 둔 보수적 정규식)
  const m = html.match(
    /종목명[\s\S]{0,800}?종목코드[\s\S]{0,200}?/i,
  );
  if (m) {
    const chunk = m[0];
    // name candidate: last text chunk before "종목코드"
    const parts = chunk.split(/종목코드/i);
    if (parts.length >= 2) {
      const before = parts[0].replace(/<[^>]*>/g, " ").trim();
      // 마지막 단어/토큰을 사용 (예: "종목명  계양전기우")
      const tokens = before.split(/\s+/).filter(Boolean);
      const last = tokens[tokens.length - 1];
      if (last) return last;
    }
  }
  return null;
}

/**
 * Naver Finance 종목 상세(main)에서 한글 종목명을 가져옵니다.
 * - 입력: `012205.KS`, `012205.KQ` 등
 * - 출력: "계양전기우" 같은 한글명
 */
export async function fetchKrStockNameFromNaver(
  symbol: string,
): Promise<string | null> {
  const code = normalizeKrStockCode(symbol);
  if (!code) return null;

  const url = `https://finance.naver.com/item/main.naver?code=${code}`;
  try {
    const html = await fetchNaverHtml(url);
    const name = parseKrStockNameFromNaverHtml(html);
    console.log("[kr-stock][naver parsed name]", { symbol, code, name });
    return name;
  } catch (e) {
    console.error("[kr-stock] failed to fetch name", { symbol, code, e });
    return null;
  }
}
