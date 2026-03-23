/**
 * Yahoo Finance `quoteSummary` 등은 종종 `Invalid Crumb` 없이는 거절된다.
 * 브라우저와 유사하게 쿠키를 받은 뒤 `getcrumb` 으로 crumb 을 얻는다.
 * @see https://query1.finance.yahoo.com/v1/test/getcrumb
 */

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

let cache: { at: number; crumb: string; cookie: string } | null = null;
const TTL_MS = 4 * 60 * 1000;

function parseSetCookieIntoMap(
  setCookieLines: string[],
  map: Map<string, string>,
): void {
  for (const line of setCookieLines) {
    const kv = line.split(";")[0]?.trim();
    if (!kv?.includes("=")) continue;
    const i = kv.indexOf("=");
    const name = kv.slice(0, i);
    const value = kv.slice(i + 1);
    if (name && value !== undefined) {
      map.set(name, value);
    }
  }
}

function mapToCookieHeader(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export async function getYahooCrumbSession(): Promise<{
  crumb: string;
  cookie: string;
} | null> {
  if (cache && Date.now() - cache.at < TTL_MS) {
    return { crumb: cache.crumb, cookie: cache.cookie };
  }

  const jar = new Map<string, string>();

  try {
    const landing = await fetch("https://finance.yahoo.com/quote/AAPL", {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": BROWSER_UA,
      },
      redirect: "follow",
    });
    const sc1 = landing.headers.getSetCookie?.() ?? [];
    parseSetCookieIntoMap(sc1, jar);

    const cookieForCrumb = mapToCookieHeader(jar);
    const crumbRes = await fetch(
      "https://query1.finance.yahoo.com/v1/test/getcrumb",
      {
        headers: {
          Accept: "text/plain,*/*",
          "User-Agent": BROWSER_UA,
          ...(cookieForCrumb ? { Cookie: cookieForCrumb } : {}),
        },
      },
    );
    const sc2 = crumbRes.headers.getSetCookie?.() ?? [];
    parseSetCookieIntoMap(sc2, jar);

    const crumbRaw = (await crumbRes.text()).trim();
    if (
      crumbRaw.length < 8 ||
      /too many requests/i.test(crumbRaw) ||
      /\s/.test(crumbRaw)
    ) {
      console.error("[yahoo-session] getcrumb failed:", crumbRaw.slice(0, 120));
      return null;
    }

    const cookie = mapToCookieHeader(jar);
    cache = { at: Date.now(), crumb: crumbRaw, cookie };
    return { crumb: crumbRaw, cookie };
  } catch (e) {
    console.error("[yahoo-session]", e);
    return null;
  }
}

export { BROWSER_UA };
