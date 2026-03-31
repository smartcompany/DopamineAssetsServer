import { jsonWithCors } from "@/lib/cors";

export async function GET() {
  const payload = {
    ios_ads: [{ rewarded_ad: 1 }],
    android_ads: [{ rewarded_ad: 1 }],
    ref: {
      ios: {
        initial_ad: process.env.IOS_INTERSTITIAL_AD_UNIT_ID ?? "",
        rewarded_ad: process.env.IOS_REWARDED_AD_UNIT_ID ?? "",
      },
      android: {
        initial_ad: process.env.ANDROID_INTERSTITIAL_AD_UNIT_ID ?? "",
        rewarded_ad: process.env.ANDROID_REWARDED_AD_UNIT_ID ?? "",
      },
    },
    down_load_url: process.env.DOWNLOAD_URL ?? "",
  };
  return jsonWithCors(payload);
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
