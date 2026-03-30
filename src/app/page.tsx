import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-10 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">
        Dopamine Assets API
      </h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        Flutter 클라이언트는{" "}
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-sm dark:bg-zinc-900">
          API_BASE_URL=http://127.0.0.1:3000
        </code>{" "}
        (client `api_config.dart`)로 이 서버를 가리키면 됩니다.
      </p>
      <ul className="list-inside list-disc space-y-2 text-zinc-800 dark:text-zinc-200">
        <li>
          <Link className="underline" href="/api/meta/asset-classes">
            GET /api/meta/asset-classes
          </Link>
        </li>
        <li>
          <Link className="underline" href="/api/feed/rankings/up">
            GET /api/feed/rankings/up (Supabase 피드 캐시 — GitHub Actions 갱신)
          </Link>
        </li>
        <li>
          <Link className="underline" href="/api/feed/rankings/down">
            GET /api/feed/rankings/down
          </Link>
        </li>
        <li>
          <Link className="underline" href="/api/rankings/up">
            GET /api/rankings/up (호환 alias)
          </Link>
        </li>
        <li>
          <Link
            className="underline"
            href="/api/themes?kind=hot"
          >
            GET /api/themes?kind=hot|crashed|emerging (optional locale=ko|en)
          </Link>
        </li>
        <li>
          <Link className="underline" href="/api/market-summary">
            GET /api/market-summary (환율 Yahoo KRW=X)
          </Link>
        </li>
      </ul>
    </main>
  );
}
