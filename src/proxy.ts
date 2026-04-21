import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE =
  "https://play.google.com/store/apps/details?id=com.smartcompany.dopamineAssets";

function pickStore(uaLower: string): string {
  return uaLower.includes("android") ? PLAY_STORE : IOS_APP_STORE;
}

/**
 * `/applink`: 마케팅/웹 배너용. User-Agent에 따라 스토어로 302.
 *
 * Next.js 16부터 `middleware` 파일 컨벤션이 `proxy`로 변경됨.
 */
export function proxy(request: NextRequest) {
  const url = new URL(request.url);
  if (url.pathname === "/applink") {
    const ua = (request.headers.get("user-agent") || "").toLowerCase();
    return NextResponse.redirect(pickStore(ua), 302);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/applink"],
};
