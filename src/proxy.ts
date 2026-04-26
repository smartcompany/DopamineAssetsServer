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
 * `/applink` — UA 기준 스토어 302 (기존 동작; 사파리/QR 등).
 * X 인앱 등은 ` /applink/social` (HTML itms-apps / market) 사용.
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
