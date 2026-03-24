import { runAssetMoveSummaryJob } from "@/lib/asset-move-summary-batch";
import { jsonWithCors } from "@/lib/cors";

function authorizeCron(request: Request): boolean {
  // 프로덕션: 크론 URL이 노출돼도 LLM·DB 작업이 무제한 호출되지 않도록 시크릿 필수.
  // 로컬 `next dev`: 시크릿 없이 GPT/배치 결과만 빠르게 확인할 수 있게 통과.
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const auth = request.headers.get("authorization")?.trim();
  const bearer =
    auth?.toLowerCase().startsWith("bearer ") === true
      ? auth.slice(7).trim()
      : null;
  if (bearer === secret) return true;
  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return jsonWithCors({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.OPENAI_API_KEY?.trim()) {
    return jsonWithCors({ error: "openai_not_configured" }, { status: 503 });
  }

  try {
    const result = await runAssetMoveSummaryJob();
    return jsonWithCors({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    const msg = e instanceof Error ? e.message : "unknown";
    return jsonWithCors({ error: "job_failed", detail: msg }, { status: 500 });
  }
}

/** GitHub Actions `curl` GET 트리거용 (secret 쿼리) */
export async function GET(request: Request) {
  return POST(request);
}

export async function OPTIONS() {
  return jsonWithCors(null, { status: 204 });
}
