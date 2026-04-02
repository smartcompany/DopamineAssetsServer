import { jsonWithCors } from "@/lib/cors";
import { ensureFirebaseAdmin } from "@/lib/firebase-admin-app";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonWithCors({ error: "invalid_json" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return jsonWithCors({ error: "invalid_body" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const accessToken =
    typeof o.access_token === "string" ? o.access_token.trim() : "";
  if (!accessToken) {
    return jsonWithCors({ error: "missing_access_token" }, { status: 400 });
  }

  try {
    // 1) 카카오 access_token → 카카오 유저 정보 확인
    const kakaoRes = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (!kakaoRes.ok) {
      return jsonWithCors({ error: "invalid_kakao_access_token" }, { status: 401 });
    }
    const kakaoUser = (await kakaoRes.json()) as { id?: unknown };
    const kakaoIdRaw = kakaoUser?.id;
    const kakaoId =
      typeof kakaoIdRaw === "number"
        ? String(kakaoIdRaw)
        : typeof kakaoIdRaw === "string"
          ? kakaoIdRaw.trim()
          : "";
    if (!kakaoId) {
      return jsonWithCors({ error: "kakao_user_missing_id" }, { status: 502 });
    }
    const uid = `kakao:${kakaoId}`;

    // 2) Firebase 커스텀 토큰 발급 (신규/기존 상관 없이 항상 발급)
    const admin = ensureFirebaseAdmin();
    const customToken = await admin.auth().createCustomToken(uid, {
      provider: "kakao",
      kakaoId,
    });

    return jsonWithCors({
      uid,
      kakao_id: kakaoId,
      custom_token: customToken,
    });
  } catch (e) {
    console.error("[auth][kakao][firebase] failed", e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "internal_error", detail: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}

