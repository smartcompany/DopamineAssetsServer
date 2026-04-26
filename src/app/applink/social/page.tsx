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

/**
 * X·카카오·FB·인스타 등: 자동 itms 를 쓰면 WebView가 비거나 UI가 먼저 켜져
 * 하단 “받기/열기” 화면만 보이는 경우가 많다. → 인앱이면 **자동 이동 금지**, 버튼+탭만.
 * 사파리/Chrome 모바일: 기존처럼 itms / market 을 즉시 시도(원하면) 후 https 폴백.
 */
const BOOT_SCRIPT = `
(function () {
  var ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  var inApp = /(Twitter|X\\/[\\d.]+|FBIOS|FBAN|FBAV|Line\\/|KakaoTalk|Kakao|Daum|KAKAOTALK|Whatsapp|Telegram|Snapchat|Slack|LinkedIn|FB_IAB|Instagram|Pinterest|musical_ly|ByteDance|Aweme|; wv\\))/i.test(ua);
  var isAndroid = /android/i.test(ua);
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var elIos = document.getElementById("applink-btn-ios");
  var elAnd = document.getElementById("applink-btn-android");
  if (isIOS && elIos) { elIos.setAttribute("href", ${JSON.stringify(IOS_APP_STORE_ITMS)}); }
  if (isAndroid && elAnd) { elAnd.setAttribute("href", ${JSON.stringify(PLAY_STORE_MARKET)}); }
  if (inApp) { return; }
  if (!isAndroid && !isIOS) { return; }
  var scheme = isAndroid ? ${JSON.stringify(PLAY_STORE_MARKET)} : ${JSON.stringify(IOS_APP_STORE_ITMS)};
  var web = isAndroid ? ${JSON.stringify(PLAY_STORE_WEB)} : ${JSON.stringify(IOS_APP_STORE_WEB)};
  var t = window.setTimeout(function () { window.location.replace(web); }, 2000);
  function cancel() {
    if (t !== null) { window.clearTimeout(t); t = null; }
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) { cancel(); } });
  window.addEventListener("pagehide", cancel);
  try { window.location.href = scheme; } catch (e) { cancel(); window.location.replace(web); }
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

export default function AppLinkSocialPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      <main
        className="box-border flex min-h-[100dvh] flex-col items-center justify-start gap-2 bg-[#05080c] px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(5rem,env(safe-area-inset-bottom,32px))] text-center text-zinc-100"
        style={{ minHeight: "100dvh" }}
      >
        <p className="m-0 text-base font-semibold">Dopamine Assets</p>
        <p className="m-0 mt-2 max-w-sm text-xs leading-relaxed text-zinc-400">
          X·카카오 등 앱 안 브라우저는 아래 버튼을 눌러 스토어로 이동해 주세요.
        </p>
        <p className="m-0 mb-4 mt-1 text-[11px] text-zinc-600">
          일반 Safari에서는 자동으로 스토어가 열릴 수 있습니다.
        </p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <a
            id="applink-btn-ios"
            href={IOS_APP_STORE_WEB}
            className="block rounded-xl bg-white px-5 py-3.5 text-sm font-semibold text-zinc-900 no-underline"
          >
            App Store
          </a>
          <a
            id="applink-btn-android"
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
            웹에서 바로 사용
          </Link>
        </p>
        <noscript>
          <p>
            <a href={IOS_APP_STORE_WEB} className="text-emerald-400">
              App Store로 이동
            </a>
          </p>
        </noscript>
      </main>
    </>
  );
}
