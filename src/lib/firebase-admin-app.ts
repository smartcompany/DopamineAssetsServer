import admin from "firebase-admin";

function parseServiceAccountJson(raw: string): admin.ServiceAccount {
  return JSON.parse(raw) as admin.ServiceAccount;
}

/**
 * 우선순위:
 * 1) FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 — JSON 전체를 base64 (줄바꿈·공백 이슈 없음)
 * 2) FIREBASE_SERVICE_ACCOUNT_JSON — minify 한 줄 JSON (줄바꿈 넣지 말 것)
 *
 * .env에 예쁘게 포맷된 JSON(줄바꿈·들여쓰기)을 넣으면 대부분 파서가 깨집니다.
 */
export function ensureFirebaseAdmin(): typeof admin {
  if (admin.apps.length > 0) {
    return admin;
  }

  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (b64 && b64.length > 0) {
    const raw = Buffer.from(b64, "base64").toString("utf8");
    const cred = parseServiceAccountJson(raw);
    admin.initializeApp({
      credential: admin.credential.cert(cred),
    });
    return admin;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw && raw.length > 0) {
    const cred = parseServiceAccountJson(raw);
    admin.initializeApp({
      credential: admin.credential.cert(cred),
    });
    return admin;
  }

  admin.initializeApp();
  return admin;
}

export async function verifyFirebaseIdToken(idToken: string) {
  const app = ensureFirebaseAdmin();
  return app.auth().verifyIdToken(idToken);
}
