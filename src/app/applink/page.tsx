import { redirect } from "next/navigation";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";

export const metadata = {
  title: "Dopamine Assets — App Store",
};

/**
 * 기본 동작은 proxy.ts에서 /applink -> 스토어 302 리다이렉트.
 * 이 페이지는 프록시 미적용 환경에서의 iOS 폴백.
 */
export default function AppLinkFallbackPage() {
  redirect(IOS_APP_STORE);
}
