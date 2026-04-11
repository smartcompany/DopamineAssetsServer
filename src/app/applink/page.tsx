import { redirect } from "next/navigation";

const IOS_APP_STORE =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";

export const metadata = {
  title: "Dopamine Assets — App Store",
};

/**
 * 미들웨어가 항상 /applink → 스토어로 보냄.
 * 이 페이지는 엣지 케이스 폴백(미들웨어 미적용 시 iOS 스토어).
 */
export default function AppLinkFallbackPage() {
  redirect(IOS_APP_STORE);
}
