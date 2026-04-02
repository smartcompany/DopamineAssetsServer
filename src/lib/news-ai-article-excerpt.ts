import iconv from "iconv-lite";

/** 기사당 본문 앞부분 최대 문자 수 (UTF-16 기준, 비용·토큰 절약). */
export const NEWS_AI_BODY_CHARS_PER_URL = 2200;

/** 5개 기사 전체 본문 발췌 합산 상한 (여유 있게 잘라서 토큰 과다 방지). */
export const NEWS_AI_BODY_TOTAL_MAX = 10000;

const FETCH_TIMEOUT_MS = 12_000;

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (compatible; DopamineAssets/1.0; +https://dopamine-assets-server.vercel.app) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
};

function stripHtmlToText(html: string): string {
  const noScripts = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  const noTags = noScripts.replace(/<[^>]+>/g, " ");
  return noTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitleFromHtml(html: string): string {
  const og =
    html.match(
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    ) ??
    html.match(
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    );
  if (og?.[1]) return decodeBasicEntities(og[1].trim());
  const tw = html.match(
    /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i,
  );
  if (tw?.[1]) return decodeBasicEntities(tw[1].trim());
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t?.[1]) return decodeBasicEntities(stripHtmlToText(t[1]).slice(0, 500));
  return "";
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function charsetFromContentType(ct: string): string | null {
  const m = ct.match(/charset\s*=\s*([^;]+)/i);
  if (!m?.[1]) return null;
  const c = m[1].trim().toLowerCase();
  if (c.includes("utf-8") || c === "utf8") return "utf-8";
  if (c.includes("euc-kr") || c.includes("euckr") || c.includes("ks_c_5601"))
    return "euc-kr";
  return null;
}

function decodeHtmlBuffer(buf: Buffer, contentType: string): string {
  const cs = charsetFromContentType(contentType);
  if (cs === "euc-kr") {
    return iconv.decode(buf, "euc-kr");
  }
  const utf8 = buf.toString("utf8");
  if (!cs) {
    const utf8Hangul = (utf8.match(/[\uAC00-\uD7AF]/g) ?? []).length;
    const euc = iconv.decode(buf, "euc-kr");
    const eucHangul = (euc.match(/[\uAC00-\uD7AF]/g) ?? []).length;
    return eucHangul > utf8Hangul ? euc : utf8;
  }
  return utf8;
}

export type NewsArticleExcerpt = {
  url: string;
  /** 피드 제목(폴백) 또는 HTML에서 추출한 제목 */
  title: string;
  /** 본문 앞부분만 (잘림) */
  excerpt: string;
  /** HTML fetch·파싱 성공 여부 */
  ok: boolean;
};

/**
 * 단일 URL에서 HTML을 가져와 제목 + 본문 앞부분(최대 maxBodyChars)을 만든다.
 */
export async function fetchArticleExcerptForNewsAi(
  url: string,
  feedTitle: string,
  maxBodyChars: number,
): Promise<NewsArticleExcerpt> {
  const fallbackTitle = feedTitle.trim() || "(제목 없음)";
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: DEFAULT_HEADERS,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      return {
        url,
        title: fallbackTitle,
        excerpt: "",
        ok: false,
      };
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().includes("text/html") && !ct.includes("application/xhtml")) {
      return {
        url,
        title: fallbackTitle,
        excerpt: "",
        ok: false,
      };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const html = decodeHtmlBuffer(buf, ct);
    const htmlTitle = extractTitleFromHtml(html);
    const title =
      htmlTitle.length > 0 ? htmlTitle.slice(0, 300) : fallbackTitle;
    const plain = stripHtmlToText(html);
    const excerpt = plain.slice(0, Math.max(0, maxBodyChars));
    return {
      url,
      title,
      excerpt,
      ok: excerpt.length > 0,
    };
  } catch (e) {
    console.warn("[news-ai-article-excerpt] fetch failed", url, e);
    return {
      url,
      title: fallbackTitle,
      excerpt: "",
      ok: false,
    };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/**
 * 최대 5개 URL에 대해 병렬 fetch 후, 기사당·전체 상한에 맞춰 발췌 길이를 분배한다.
 */
export async function fetchArticleExcerptsForNewsAi(
  urls: string[],
  feedTitles: string[],
): Promise<NewsArticleExcerpt[]> {
  const n = urls.length;
  if (n === 0) return [];
  const perUrlBudget = Math.min(
    NEWS_AI_BODY_CHARS_PER_URL,
    Math.floor(NEWS_AI_BODY_TOTAL_MAX / n),
  );
  const results = await Promise.all(
    urls.map((u, i) =>
      fetchArticleExcerptForNewsAi(u, feedTitles[i] ?? "", perUrlBudget),
    ),
  );
  return results;
}
