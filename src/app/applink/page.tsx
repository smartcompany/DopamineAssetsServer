import Link from "next/link";

const IOS_APP_STORE_URL =
  "https://apps.apple.com/us/app/dopamine-assets/id6761470158";

export const metadata = {
  title: "Dopamine Assets — App links",
  description:
    "Open Dopamine Assets on the App Store. Android link will be added when available.",
};

export default function AppLinkPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 p-10 font-sans">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
          Dopamine Assets
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          앱 설치·열기용 딥링크 허브입니다. 마케팅·푸시·웹에서 이 URL을 고정으로
          사용할 수 있습니다.
        </p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          iOS (App Store)
        </h2>
        <p className="mt-2 text-zinc-700 dark:text-zinc-300">
          <a
            href={IOS_APP_STORE_URL}
            className="break-all font-medium text-emerald-700 underline decoration-emerald-700/30 underline-offset-2 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300"
          >
            {IOS_APP_STORE_URL}
          </a>
        </p>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          Universal Links / Associated Domains 설정 시 이 경로(
          <code className="rounded bg-zinc-100 px-1 py-0.5 dark:bg-zinc-900">
            /applink
          </code>
          )를 열 때 앱으로 라우팅할 수 있습니다.
        </p>
      </section>

      <section className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 dark:border-zinc-700 dark:bg-zinc-900/50">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Android (Google Play)
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          스토어 출시 후 Play Store 링크를 여기에 등록할 예정입니다.
        </p>
      </section>

      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        <Link href="/" className="underline hover:text-zinc-800 dark:hover:text-zinc-200">
          ← API 홈
        </Link>
      </p>
    </main>
  );
}
