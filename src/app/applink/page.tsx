import type { Metadata } from "next";
import AppLinkRedirect from "./_components/AppLinkRedirect";

const IOS_APP_STORE_WEB =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE_WEB =
  "https://play.google.com/store/apps/details?id=com.smartcompany.dopamineAssets";

export const metadata: Metadata = {
  title: "Dopamine Assets — 앱 다운로드",
  description: "시장의 도파민을 한 화면에. 앱을 설치하세요.",
  robots: { index: false, follow: false },
};

/**
 * `/applink` 는 SNS/QR 공유용 단일 다운로드 랜딩.
 *
 * 과거엔 미들웨어에서 곧장 `https://apps.apple.com/...` 로 302를 보냈지만,
 * X 같은 앱의 인앱 WKWebView 는 apps.apple.com 을 네이티브 App Store 로 넘기지
 * 않고 그냥 웹 페이지로 렌더링해버림. 따라서 `itms-apps://` / `market://` 커스텀
 * 스킴으로 먼저 시도해 네이티브 스토어 앱을 띄우고, 실패 시 웹 스토어로 폴백.
 */
export default function AppLinkPage() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center gap-8 overflow-hidden bg-[#05080c] px-6 py-10 text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60% 40% at 50% 0%, rgba(34,197,94,0.18) 0%, rgba(5,8,12,0) 70%)",
        }}
      />

      <AppLinkRedirect />

      <div className="flex flex-col items-center gap-3 text-center">
        <div className="text-sm font-medium tracking-[0.2em] text-emerald-300">
          DOPAMINE ASSETS
        </div>
        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
          스토어로 이동 중…
        </h1>
        <p className="max-w-sm text-sm text-white/60">
          자동으로 열리지 않으면 아래 버튼을 눌러 주세요.
        </p>
      </div>

      <div className="flex w-full max-w-sm flex-col gap-3">
        <a
          href={IOS_APP_STORE_WEB}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-3 rounded-2xl bg-white px-6 py-4 text-base font-semibold text-black shadow-lg shadow-black/30 transition hover:-translate-y-0.5"
        >
          App Store 열기
        </a>
        <a
          href={PLAY_STORE_WEB}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-3 rounded-2xl bg-white/10 px-6 py-4 text-base font-semibold text-white ring-1 ring-white/20 transition hover:-translate-y-0.5 hover:bg-white/15"
        >
          Google Play 열기
        </a>
      </div>

      <noscript>
        <meta httpEquiv="refresh" content={`0; url=${IOS_APP_STORE_WEB}`} />
      </noscript>
    </main>
  );
}
