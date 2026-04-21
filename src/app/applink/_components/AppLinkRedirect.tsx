"use client";

import { useEffect } from "react";

const IOS_APP_STORE_WEB =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";
const IOS_APP_STORE_SCHEME =
  "itms-apps://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE_WEB =
  "https://play.google.com/store/apps/details?id=com.smartcompany.dopamineAssets";
const PLAY_STORE_SCHEME =
  "market://details?id=com.smartcompany.dopamineAssets";

/**
 * 마운트 시 네이티브 스토어 앱을 직접 열도록 시도한다(`itms-apps://`, `market://`).
 * 스킴이 차단되거나 데스크톱이면 짧은 지연 후 웹 스토어 URL 로 폴백한다.
 *
 * 페이지가 숨겨지면(네이티브 앱이 떠서 WebView 가 background) 폴백 타이머는 취소.
 */
export default function AppLinkRedirect() {
  useEffect(() => {
    const ua =
      typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const isAndroid = /android/i.test(ua);
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    if (!isAndroid && !isIOS) return;

    const scheme = isAndroid ? PLAY_STORE_SCHEME : IOS_APP_STORE_SCHEME;
    const web = isAndroid ? PLAY_STORE_WEB : IOS_APP_STORE_WEB;

    let fallbackTimer: number | null = window.setTimeout(() => {
      window.location.replace(web);
    }, 1500);

    const cancelFallback = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) cancelFallback();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", cancelFallback);

    try {
      window.location.href = scheme;
    } catch {
      cancelFallback();
      window.location.replace(web);
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", cancelFallback);
      cancelFallback();
    };
  }, []);

  return null;
}
