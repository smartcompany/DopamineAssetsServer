import { redirect } from "next/navigation";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";

export const metadata = {
  title: "Dopamine Assets — App Store",
};

/**
 * proxy.ts 가 /applink → App Store/Play 302(UA 분기)를 담당.
 * 프록시가 적용되지 않는 환경에서의 iOS 기본 폴백.
 *
 * X·인앱 WebView 는 ` /applink/social` 를 사용.
 */
export default function AppLinkFallbackPage() {
  redirect(IOS_APP_STORE);
}
