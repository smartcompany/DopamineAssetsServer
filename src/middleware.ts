import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";
const PLAY_STORE =
  "https://play.google.com/store/apps/details?id=com.smartcompany.dopamineAssets";

/** 마케팅·웹 배너용: 랜딩 없이 바로 스토어로 보냄 (coin-portal timeCapital 패턴). */
export function middleware(request: NextRequest) {
  const ua = (request.headers.get("user-agent") || "").toLowerCase();
  const target = ua.includes("android") ? PLAY_STORE : IOS_APP_STORE;
  return NextResponse.redirect(target, 302);
}

export const config = {
  matcher: "/applink",
};
