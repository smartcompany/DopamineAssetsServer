import type { Metadata } from "next";
import Link from "next/link";

const IOS_APP_STORE_WEB =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE_WEB =
  "https://play.google.com/store/apps/details?id=com.smartcompany.dopamineAssets";
const IOS_APP_STORE_ITMS =
  "itms-apps://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE_MARKET =
  "market://details?id=com.smartcompany.dopamineAssets";

const INLINE_REDIRECT = `
(function () {
  var ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  var isAndroid = /android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  if (!isAndroid && !isIOS) return;
  var scheme = isAndroid ? ${JSON.stringify(PLAY_STORE_MARKET)} : ${JSON.stringify(IOS_APP_STORE_ITMS)};
  var web = isAndroid ? ${JSON.stringify(PLAY_STORE_WEB)} : ${JSON.stringify(IOS_APP_STORE_WEB)};
  var t = window.setTimeout(function () {
    window.location.replace(web);
  }, 1800);
  function cancel() {
    if (t !== null) {
      window.clearTimeout(t);
      t = null;
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) cancel();
  });
  window.addEventListener("pagehide", cancel);
  try {
    window.location.href = scheme;
  } catch (e) {
    cancel();
    window.location.replace(web);
  }
})();
`.trim();

export const metadata: Metadata = {
  title: "Dopamine Assets — Download",
  description: "Open the App Store or Google Play to install Dopamine Assets.",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Dopamine Assets",
    description: "Real-time market movers — US/KR stocks, crypto, commodities.",
    url: "https://dopamine-assets-server.vercel.app/applink/social",
  },
  twitter: {
    card: "summary",
    title: "Dopamine Assets",
    description: "Real-time market movers — US/KR stocks, crypto, commodities.",
  },
};

/**
 * X / 카카오 / Meta 인앱 등 WKWebView 전용.
 * ` /applink` 는 proxy 302(기존 동작)이고, 여기서는 itms-apps / market 스킴으로 네이티브 스토어를 연다.
 */
export default function AppLinkSocialPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: INLINE_REDIRECT }} />
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-[#05080c] px-6 py-10 text-center text-zinc-100">
        <p className="m-0 text-sm">Opening the store app…</p>
        <p className="m-0 mb-6 text-xs text-zinc-400">
          If nothing happens, use the buttons below.
        </p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <a
            href={IOS_APP_STORE_WEB}
            className="block rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-zinc-900 no-underline"
          >
            App Store
          </a>
          <a
            href={PLAY_STORE_WEB}
            className="block rounded-xl border border-zinc-600 bg-white/5 px-5 py-3.5 text-sm font-semibold text-zinc-100 no-underline"
          >
            Google Play
          </a>
        </div>
        <p className="mt-8 text-xs text-zinc-500">
          <Link
            href="https://dopamine-assets.vercel.app/?from=share"
            className="text-emerald-400 no-underline hover:underline"
          >
            Or use the web app
          </Link>
        </p>
        <noscript>
          <p>
            <a href={IOS_APP_STORE_WEB} className="text-emerald-400">
              Continue to App Store
            </a>
          </p>
        </noscript>
      </main>
    </>
  );
}
