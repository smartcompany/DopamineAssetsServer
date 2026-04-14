"use client";

import { useEffect, useState } from "react";

/** 관리자 처리 드롭다운 값 (DB admin_verdict와 동일) */
type AdminVerdictSelection =
  | ""
  | "no_issue"
  | "content_hidden";

type UserActionSelection = "none" | "suspend" | "unsuspend";

type ReportRow = {
  id: string;
  target_type: "asset_comment";
  target_id: string | null;
  target_title_or_content: string;
  host_or_author_name: string | null;
  host_or_author_id: string | null;
  reason: string | null;
  reporter_user_id: string;
  reporter_name: string | null;
  ai_verdict: string | null;
  ai_reason: string | null;
  ai_verdict_at: string | null;
  created_at: string;
  admin_verdict: string | null;
  target_user_suspended_until: string | null;
};

const API = process.env.NEXT_PUBLIC_API_BASE || "";

type TargetDetail = {
  type: string;
  title: string | null;
  content: string;
  image_urls: string[];
};

/** 급등·급락 토론 푸시 — GET/PUT /api/dashboard/hot-mover-discussion-config */
type HotMoverDiscussionForm = {
  useTimeWindow: boolean;
  windowHours: number;
  minThreadComments: number;
  minRootViewCount: number;
  pushTitleKo: string;
  pushTitleEn: string;
  pushTitleJa: string;
  pushTitleZh: string;
  pushBodyTemplateKo: string;
  pushBodyTemplateEn: string;
  pushBodyTemplateJa: string;
  pushBodyTemplateZh: string;
};

const HMD_DEFAULT_PUSH: Pick<
  HotMoverDiscussionForm,
  | "pushTitleKo"
  | "pushTitleEn"
  | "pushTitleJa"
  | "pushTitleZh"
  | "pushBodyTemplateKo"
  | "pushBodyTemplateEn"
  | "pushBodyTemplateJa"
  | "pushBodyTemplateZh"
> = {
  pushTitleKo: "🔥 지금 뜨는 토론",
  pushTitleEn: "🔥 Heating up",
  pushTitleJa: "🔥 今アツい討論",
  pushTitleZh: "🔥 正在热议",
  pushBodyTemplateKo:
    "💬 {name} {direction} ({pct}) · 커뮤니티 온도 미쳤어요 👀 지금 보러 와요!",
  pushBodyTemplateEn:
    "💬 {name} is {direction} ({pct}) — Community's buzzing 👀 Tap to see what's up!",
  pushBodyTemplateJa:
    "💬 {name} が{direction}（{pct}）・コミュニティが大盛り上がり 👀 今すぐチェック！",
  pushBodyTemplateZh:
    "💬 {name} {direction}（{pct}）· 社区热度爆表 👀 现在就来看看！",
};

function getVerdictLabel(v: string | null): string {
  if (!v) return "-";
  const map: Record<string, string> = {
    hide_post: "글 차단·숨김 (AI)",
    remove_post: "글 차단·숨김 (AI)",
    needs_review: "검토 필요",
    no_issue: "이상 없음",
  };
  return map[v] || v;
}

const MS_24H = 24 * 60 * 60 * 1000;
function isOver24h(createdAt: string | null): boolean {
  if (!createdAt) return false;
  return Date.now() - new Date(createdAt).getTime() > MS_24H;
}

export default function DashboardPage() {
  const [locale, setLocale] = useState<"ko" | "en">("ko");
  const isKo = locale === "ko";
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [detail, setDetail] = useState<TargetDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFallback, setDetailFallback] = useState<string | null>(null);
  const [adminSelections, setAdminSelections] = useState<
    Record<string, AdminVerdictSelection>
  >({});
  const [userActions, setUserActions] = useState<Record<string, UserActionSelection>>(
    {},
  );
  const [updateLoading, setUpdateLoading] = useState(false);
  const [filter24h, setFilter24h] = useState<"all" | "over24" | "within24">(
    "all",
  );

  const [hmdConfig, setHmdConfig] = useState<HotMoverDiscussionForm | null>(
    null,
  );
  const [hmdLoadError, setHmdLoadError] = useState(false);
  const [hmdSaveLoading, setHmdSaveLoading] = useState(false);
  /** 푸시 문구 편집 탭: 한국어 / English */
  const [hmdPushLocale, setHmdPushLocale] = useState<
    "ko" | "en" | "ja" | "zh"
  >("ko");
  const [activeTab, setActiveTab] = useState<"reports" | "push">("reports");

  const fetchTargetDetail = async (
    commentId: string,
    listPreview?: string,
  ) => {
    setDetailLoading(true);
    setDetail(null);
    setDetailFallback(null);
    try {
      const res = await fetch(
        `${API}/api/dashboard/target/asset-comment/${encodeURIComponent(commentId)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        setDetail(null);
        setDetailFallback(
          listPreview ||
            isKo
              ? "원문을 불러올 수 없습니다. (이미 삭제되었을 수 있습니다.)"
              : "Failed to load original content. It may have been deleted.",
        );
        return;
      }
      const data = (await res.json()) as TargetDetail;
      setDetail({
        type: data.type,
        title: data.title ?? null,
        content: data.content ?? "",
        image_urls: data.image_urls ?? [],
      });
    } finally {
      setDetailLoading(false);
    }
  };

  const openDetail = (r: ReportRow) => {
    if (!r.target_id) {
      setDetail(null);
      setDetailFallback(
        r.target_title_or_content ||
          isKo
            ? "저장된 미리보기만 있습니다. 글이 삭제된 경우 원문을 열 수 없습니다."
            : "Only snapshot preview is available. Original may have been deleted.",
      );
      setDetailLoading(false);
      return;
    }
    void fetchTargetDetail(r.target_id, r.target_title_or_content);
  };

  const fetchReports = async (
    priorSelections?: Record<string, AdminVerdictSelection>,
  ) => {
    const res = await fetch(`${API}/api/dashboard/reports`, {
      credentials: "include",
    });
    if (res.status === 401) {
      setAuthenticated(false);
      setReports([]);
      return;
    }
    if (!res.ok) {
      setAuthenticated(true);
      setReports([]);
      return;
    }
    const data = (await res.json()) as { reports?: ReportRow[] };
    setReports(data.reports || []);
    setAuthenticated(true);
    const initial: Record<string, AdminVerdictSelection> = {};
    const initialUserActions: Record<string, UserActionSelection> = {};
    for (const r of data.reports || []) {
      const raw = r.admin_verdict ?? priorSelections?.[r.id];
      const v: AdminVerdictSelection =
        raw === "remove_post"
          ? "content_hidden"
          : raw === "content_hidden" || raw === "no_issue"
            ? raw
            : "";
      initial[r.id] = v;
      initialUserActions[r.id] = "none";
    }
    setAdminSelections(initial);
    setUserActions(initialUserActions);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await fetchReports();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authenticated !== true) return;
    let cancelled = false;
    void (async () => {
      setHmdLoadError(false);
      try {
        const res = await fetch(
          `${API}/api/dashboard/hot-mover-discussion-config`,
          { credentials: "include" },
        );
        if (!res.ok) {
          if (!cancelled) setHmdLoadError(true);
          return;
        }
        const data = (await res.json()) as {
          config?: HotMoverDiscussionForm;
        };
        if (!cancelled && data.config) {
          const c = data.config;
          setHmdConfig({
            useTimeWindow: c.useTimeWindow,
            windowHours: c.windowHours,
            minThreadComments: c.minThreadComments,
            minRootViewCount: c.minRootViewCount,
            pushTitleKo: c.pushTitleKo ?? HMD_DEFAULT_PUSH.pushTitleKo,
            pushTitleEn: c.pushTitleEn ?? HMD_DEFAULT_PUSH.pushTitleEn,
            pushTitleJa: c.pushTitleJa ?? HMD_DEFAULT_PUSH.pushTitleJa,
            pushTitleZh: c.pushTitleZh ?? HMD_DEFAULT_PUSH.pushTitleZh,
            pushBodyTemplateKo:
              c.pushBodyTemplateKo ?? HMD_DEFAULT_PUSH.pushBodyTemplateKo,
            pushBodyTemplateEn:
              c.pushBodyTemplateEn ?? HMD_DEFAULT_PUSH.pushBodyTemplateEn,
            pushBodyTemplateJa:
              c.pushBodyTemplateJa ?? HMD_DEFAULT_PUSH.pushBodyTemplateJa,
            pushBodyTemplateZh:
              c.pushBodyTemplateZh ?? HMD_DEFAULT_PUSH.pushBodyTemplateZh,
          });
        } else if (!cancelled) setHmdLoadError(true);
      } catch {
        if (!cancelled) setHmdLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      const res = await fetch(`${API}/api/dashboard/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setLoginError(data.error || "로그인 실패");
        return;
      }
      setAuthenticated(true);
      setPassword("");
      await fetchReports();
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    await fetch(`${API}/api/dashboard/logout`, {
      method: "POST",
      credentials: "include",
    });
    setAuthenticated(false);
    setReports([]);
    setHmdConfig(null);
    setHmdLoadError(false);
    setHmdPushLocale("ko");
  };

  const saveHotMoverDiscussionConfig = async () => {
    if (!hmdConfig) return;
    setHmdSaveLoading(true);
    try {
      const res = await fetch(
        `${API}/api/dashboard/hot-mover-discussion-config`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hmdConfig),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        config?: HotMoverDiscussionForm;
      };
      if (!res.ok) {
        alert(data.error || "저장에 실패했습니다.");
        return;
      }
      if (data.config) {
        const c = data.config;
        setHmdConfig({
          useTimeWindow: c.useTimeWindow,
          windowHours: c.windowHours,
          minThreadComments: c.minThreadComments,
          minRootViewCount: c.minRootViewCount,
          pushTitleKo: c.pushTitleKo ?? HMD_DEFAULT_PUSH.pushTitleKo,
          pushTitleEn: c.pushTitleEn ?? HMD_DEFAULT_PUSH.pushTitleEn,
          pushTitleJa: c.pushTitleJa ?? HMD_DEFAULT_PUSH.pushTitleJa,
          pushTitleZh: c.pushTitleZh ?? HMD_DEFAULT_PUSH.pushTitleZh,
          pushBodyTemplateKo:
            c.pushBodyTemplateKo ?? HMD_DEFAULT_PUSH.pushBodyTemplateKo,
          pushBodyTemplateEn:
            c.pushBodyTemplateEn ?? HMD_DEFAULT_PUSH.pushBodyTemplateEn,
          pushBodyTemplateJa:
            c.pushBodyTemplateJa ?? HMD_DEFAULT_PUSH.pushBodyTemplateJa,
          pushBodyTemplateZh:
            c.pushBodyTemplateZh ?? HMD_DEFAULT_PUSH.pushBodyTemplateZh,
        });
      }
      alert("급등·급락 토론 푸시 설정을 저장했습니다.");
    } finally {
      setHmdSaveLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    const actionable: AdminVerdictSelection[] = ["no_issue", "content_hidden"];
    const updates = reports
      .filter(
        (r) =>
          actionable.includes(adminSelections[r.id]) ||
          (userActions[r.id] ?? "none") !== "none",
      )
      .map((r) => {
        const selectedAdmin = adminSelections[r.id] ?? "";
        return {
          report_id: r.id,
          ...(selectedAdmin
            ? {
                admin_verdict:
                  selectedAdmin as Exclude<AdminVerdictSelection, "">,
              }
            : {}),
          user_action: (userActions[r.id] ?? "none") as UserActionSelection,
        };
      });
    if (updates.length === 0) {
      alert(isKo ? "선택한 신고 처리가 없습니다." : "No report actions selected.");
      return;
    }
    setUpdateLoading(true);
    try {
      const res = await fetch(`${API}/api/dashboard/reports/update-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(
          data.error ||
            (isKo ? "상태 업데이트에 실패했습니다." : "Failed to update status."),
        );
        return;
      }
      await fetchReports(adminSelections);
    } finally {
      setUpdateLoading(false);
    }
  };

  const filteredReports =
    filter24h === "all"
      ? reports
      : filter24h === "over24"
        ? reports.filter((r) => isOver24h(r.created_at))
        : reports.filter((r) => !isOver24h(r.created_at));
  const sortedReports = [...filteredReports].sort((a, b) => {
    const aOver = isOver24h(a.created_at);
    const bOver = isOver24h(b.created_at);
    if (aOver && !bOver) return -1;
    if (!aOver && bOver) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  if (loading && authenticated === null) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center">
        <p className="text-zinc-500">{isKo ? "확인 중..." : "Checking..."}</p>
      </div>
    );
  }

  if (authenticated === false) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-white shadow-lg border border-zinc-200 p-8">
          <h1 className="text-xl font-semibold text-zinc-800 mb-6 text-center">
            {isKo ? "관리자 로그인" : "Admin Login"}
          </h1>
          <div className="mb-4 flex items-center justify-end gap-2 text-xs">
            <span className="text-zinc-500">{isKo ? "언어" : "Language"}</span>
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value as "ko" | "en")}
              className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-800 bg-white focus:border-zinc-500 focus:outline-none"
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-1">
                {isKo ? "아이디" : "Username"}
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none"
                required
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-1">
                {isKo ? "비밀번호" : "Password"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900 focus:border-zinc-500 focus:outline-none"
                required
                autoComplete="current-password"
              />
            </div>
            {loginError && (
              <p className="text-sm text-red-600">{loginError}</p>
            )}
            <button
              type="submit"
              disabled={loginLoading}
              className="w-full rounded-lg bg-zinc-800 text-white py-2 font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              {loginLoading
                ? isKo
                  ? "로그인 중..."
                  : "Signing in..."
                : isKo
                  ? "로그인"
                  : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-800">
          {isKo ? "관리 대시보드" : "Moderation Dashboard"}
        </h1>
        <div className="flex items-center gap-3">
          <select
            value={locale}
            onChange={(e) => setLocale(e.target.value as "ko" | "en")}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-800 bg-white focus:border-zinc-500 focus:outline-none"
          >
            <option value="ko">한국어</option>
            <option value="en">English</option>
          </select>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            {isKo ? "로그아웃" : "Logout"}
          </button>
        </div>
      </header>

      <main className="p-4 max-w-7xl mx-auto">
        <div className="mb-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("reports")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === "reports"
                ? "bg-zinc-800 text-white"
                : "bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {isKo ? "신고 관리" : "Report moderation"}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("push")}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === "push"
                ? "bg-amber-800 text-white"
                : "bg-white text-zinc-700 border border-zinc-300 hover:bg-zinc-50"
            }`}
          >
            {isKo ? "급등·급락 토론 푸시" : "Hot-mover discussion push"}
          </button>
        </div>

        {activeTab === "push" && (
          <section className="mb-6 rounded-xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm">
          <h2 className="text-base font-semibold text-amber-950 mb-1">
            급등·급락 토론 푸시 (4시간 크론)
          </h2>
          <p className="text-xs text-amber-900/80 mb-4">
            조건은 Supabase{" "}
            <code className="rounded bg-amber-100/80 px-1">
              dopamine_hot_mover_discussion_config
            </code>{" "}
            에 저장됩니다. 시간 창을 끄면 급등·급락 후보 종목에 대해{" "}
            <strong>최근 댓글 약 8,000건</strong>만 스캔합니다(부하 한도).
          </p>
          {hmdLoadError && (
            <p className="text-sm text-red-700 mb-2">
              설정을 불러오지 못했습니다. DB 마이그레이션(설정 테이블·view_count
              컬럼)을 적용했는지 확인하세요.
            </p>
          )}
          {hmdConfig && (
            <div className="space-y-3 text-sm text-zinc-800">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hmdConfig.useTimeWindow}
                  onChange={(e) =>
                    setHmdConfig((c) =>
                      c
                        ? { ...c, useTimeWindow: e.target.checked }
                        : c,
                    )
                  }
                  className="rounded border-zinc-400"
                />
                <span>최근 N시간 안의 글·댓글·답글만 집계</span>
              </label>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <span className="text-zinc-600">집계 시간 (시간)</span>
                <input
                  type="number"
                  min={1}
                  max={8760}
                  disabled={!hmdConfig.useTimeWindow}
                  value={hmdConfig.windowHours}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setHmdConfig((c) =>
                      c
                        ? {
                            ...c,
                            windowHours: Number.isFinite(n)
                              ? Math.min(8760, Math.max(1, n))
                              : c.windowHours,
                          }
                        : c,
                    );
                  }}
                  className="w-24 rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
                />
                <span className="text-xs text-zinc-500">
                  (끄면 위 숫자는 무시)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-600 min-w-[200px]">
                  종목당 글+댓글+답글 합계 ≥
                </span>
                <input
                  type="number"
                  min={0}
                  max={500}
                  value={hmdConfig.minThreadComments}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setHmdConfig((c) =>
                      c
                        ? {
                            ...c,
                            minThreadComments: Number.isFinite(n)
                              ? Math.min(500, Math.max(0, n))
                              : c.minThreadComments,
                          }
                        : c,
                    );
                  }}
                  className="w-20 rounded border border-zinc-300 px-2 py-1"
                />
                <span className="text-xs text-zinc-500">
                  0이면 합계 조건 없음(답 없는 글만 있어도 후보). 그 외는 루트 스레드
                  기준 합계.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-zinc-600 min-w-[200px]">
                  루트 글 조회수 ≥
                </span>
                <input
                  type="number"
                  min={0}
                  max={99999999}
                  value={hmdConfig.minRootViewCount}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setHmdConfig((c) =>
                      c
                        ? {
                            ...c,
                            minRootViewCount: Number.isFinite(n)
                              ? Math.min(99_999_999, Math.max(0, n))
                              : c.minRootViewCount,
                          }
                        : c,
                    );
                  }}
                  className="w-28 rounded border border-zinc-300 px-2 py-1"
                />
                <span className="text-xs text-zinc-500">
                  0이면 조회수 조건 없음. 앱에서 글 상세 진입 시 +1.
                </span>
              </div>

              <div className="border-t border-amber-200/80 pt-3 mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-amber-950">
                    푸시 문구 (이모지 OK · 발송 시 치환)
                  </p>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="hmd-push-locale"
                      className="text-xs text-zinc-600 whitespace-nowrap"
                    >
                      언어
                    </label>
                    <select
                      id="hmd-push-locale"
                      value={hmdPushLocale}
                      onChange={(e) =>
                        setHmdPushLocale(
                          e.target.value as "ko" | "en" | "ja" | "zh",
                        )
                      }
                      className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-800 bg-white focus:border-zinc-500 focus:outline-none"
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="zh">简体中文</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-zinc-600 leading-relaxed">
                  <code className="rounded bg-white/70 px-1">{"{name}"}</code>{" "}
                  종목명,{" "}
                  <code className="rounded bg-white/70 px-1">{"{pct}"}</code>{" "}
                  등락률,{" "}
                  <code className="rounded bg-white/70 px-1">
                    {"{direction}"}
                  </code>{" "}
                  — KO: 급등 중·급락 중 / EN: surging·sliding / JA: 急騰中・急落中
                  / ZH: 飙升中・下跌中. 제목·본문은 발송 시 각각 약 65·180자에서
                  잘릴 수 있음.
                </p>
                {hmdPushLocale === "ko" ? (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        제목
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={hmdConfig.pushTitleKo}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c ? { ...c, pushTitleKo: e.target.value } : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        본문
                      </label>
                      <textarea
                        rows={3}
                        maxLength={320}
                        value={hmdConfig.pushBodyTemplateKo}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c
                              ? { ...c, pushBodyTemplateKo: e.target.value }
                              : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-normal"
                      />
                    </div>
                  </>
                ) : hmdPushLocale === "en" ? (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        Title
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={hmdConfig.pushTitleEn}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c ? { ...c, pushTitleEn: e.target.value } : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        Body
                      </label>
                      <textarea
                        rows={3}
                        maxLength={320}
                        value={hmdConfig.pushBodyTemplateEn}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c
                              ? { ...c, pushBodyTemplateEn: e.target.value }
                              : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-normal"
                      />
                    </div>
                  </>
                ) : hmdPushLocale === "ja" ? (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        タイトル
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={hmdConfig.pushTitleJa}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c ? { ...c, pushTitleJa: e.target.value } : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        本文
                      </label>
                      <textarea
                        rows={3}
                        maxLength={320}
                        value={hmdConfig.pushBodyTemplateJa}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c
                              ? { ...c, pushBodyTemplateJa: e.target.value }
                              : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-normal"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        标题
                      </label>
                      <input
                        type="text"
                        maxLength={80}
                        value={hmdConfig.pushTitleZh}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c ? { ...c, pushTitleZh: e.target.value } : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-600 mb-1">
                        正文
                      </label>
                      <textarea
                        rows={3}
                        maxLength={320}
                        value={hmdConfig.pushBodyTemplateZh}
                        onChange={(e) =>
                          setHmdConfig((c) =>
                            c
                              ? { ...c, pushBodyTemplateZh: e.target.value }
                              : c,
                          )
                        }
                        className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-normal"
                      />
                    </div>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => void saveHotMoverDiscussionConfig()}
                disabled={hmdSaveLoading}
                className="mt-2 rounded-lg bg-amber-800 text-white px-4 py-2 text-sm font-medium hover:bg-amber-900 disabled:opacity-50"
              >
                {hmdSaveLoading ? "저장 중…" : "조건·문구 저장"}
              </button>
            </div>
          )}
          {!hmdConfig && !hmdLoadError && (
            <p className="text-sm text-zinc-500">설정 불러오는 중…</p>
          )}
          </section>
        )}

        {activeTab === "reports" && (
          <>
            <p className="text-sm text-zinc-600 mb-3">
          AI가 <strong>hide_post</strong>로 판정하면 해당 글에 숨김 플래그가
          붙어 앱 사용자에게는 보이지 않습니다(삭제 아님). 오판이면 아래
          관리자 처리에서 <strong>글 노출·신고 기각</strong>으로 번복하세요.
            </p>
            <div className="flex flex-wrap items-center gap-4 mb-4">
          <span className="text-sm text-zinc-600">24시간 기준:</span>
          <select
            value={filter24h}
            onChange={(e) =>
              setFilter24h(e.target.value as "all" | "over24" | "within24")
            }
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 focus:border-zinc-500 focus:outline-none"
          >
            <option value="all">전체</option>
            <option value="over24">24시간 경과</option>
            <option value="within24">검토 기한 내</option>
          </select>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-zinc-600 font-medium">
                  <th className="px-4 py-3">{isKo ? "유형" : "Type"}</th>
                  <th className="px-4 py-3">
                    {isKo ? "글 미리보기" : "Post preview"}
                  </th>
                  <th className="px-4 py-3">{isKo ? "작성자" : "Author"}</th>
                  <th className="px-4 py-3">
                    {isKo ? "신고 내용" : "Report reason"}
                  </th>
                  <th className="px-4 py-3">{isKo ? "신고자" : "Reporter"}</th>
                  <th className="px-4 py-3">{isKo ? "AI 처리" : "AI verdict"}</th>
                  <th className="px-4 py-3">{isKo ? "신고 일시" : "Reported at"}</th>
                  <th className="px-4 py-3">24h</th>
                  <th className="px-4 py-3">
                    {isKo ? "관리자 처리" : "Admin verdict"}
                  </th>
                  <th className="px-4 py-3">
                    {isKo ? "계정 조치" : "Account action"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      {isKo ? "신고 내역이 없습니다." : "No reports."}
                    </td>
                  </tr>
                ) : sortedReports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      {isKo
                        ? "해당 조건에 맞는 신고가 없습니다."
                        : "No reports match this filter."}
                    </td>
                  </tr>
                ) : (
                  sortedReports.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-zinc-100 hover:bg-zinc-50/50"
                    >
                      <td className="px-4 py-3">
                        <span className="text-emerald-700 font-medium">
                          {isKo ? "커뮤니티" : "Community"}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <button
                          type="button"
                          onClick={() => openDetail(r)}
                          className="text-left w-full truncate block text-zinc-800 underline decoration-zinc-300 hover:decoration-zinc-600 focus:outline-none"
                          title={
                            isKo
                              ? "클릭하면 원문·사진 보기"
                              : "Open original content and images"
                          }
                        >
                          {r.target_title_or_content || "-"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        <div className="flex flex-col gap-1">
                          <span>{r.host_or_author_name ?? r.host_or_author_id ?? "-"}</span>
                          {r.target_user_suspended_until &&
                            new Date(r.target_user_suspended_until).getTime() >
                              Date.now() && (
                              <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                                {isKo ? "사용정지 중" : "Suspended"}
                              </span>
                            )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="font-medium text-zinc-800">
                          {r.reason ?? "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        {r.reporter_name ?? r.reporter_user_id}
                      </td>
                      <td className="px-4 py-3 text-zinc-900">
                        <span className="font-medium text-zinc-900">
                          {getVerdictLabel(r.ai_verdict)}
                        </span>
                        {r.ai_reason && (
                          <div className="text-zinc-700 text-xs mt-0.5 whitespace-pre-wrap break-words max-w-[280px]">
                            {r.ai_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 whitespace-nowrap">
                        {r.created_at
                          ? new Date(r.created_at).toLocaleString("ko-KR")
                          : "-"}
                      </td>
                      <td className="px-4 py-3">
                        {isOver24h(r.created_at) ? (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                            {isKo ? "24시간 경과" : "Over 24h"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">
                            {isKo ? "검토 기한 내" : "Within 24h"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={adminSelections[r.id] ?? ""}
                          onChange={(e) =>
                            setAdminSelections((prev) => ({
                              ...prev,
                              [r.id]: e.target.value as AdminVerdictSelection,
                            }))
                          }
                          className="rounded border border-zinc-300 px-2 py-1.5 text-zinc-800 text-sm focus:border-zinc-500 focus:outline-none"
                        >
                          <option value="">{isKo ? "선택 안 함" : "No change"}</option>
                          <option value="no_issue">
                            {isKo
                              ? "글 노출·신고 기각 (숨김 해제)"
                              : "No issue (unhide post)"}
                          </option>
                          <option value="content_hidden">
                            {isKo
                              ? "글 숨김·차단 (확정)"
                              : "Hide post (confirmed)"}
                          </option>
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={userActions[r.id] ?? "none"}
                          onChange={(e) =>
                            setUserActions((prev) => ({
                              ...prev,
                              [r.id]: e.target.value as UserActionSelection,
                            }))
                          }
                          className="rounded border border-zinc-300 px-2 py-1.5 text-zinc-800 text-sm focus:border-zinc-500 focus:outline-none"
                        >
                          <option value="none">
                            {isKo ? "변경 없음" : "No change"}
                          </option>
                          <option value="suspend">
                            {isKo ? "계정 사용정지" : "Suspend account"}
                          </option>
                          <option value="unsuspend">
                            {isKo ? "사용정지 해제" : "Unsuspend account"}
                          </option>
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
            </div>
            <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleUpdateStatus}
            disabled={reports.length === 0 || updateLoading}
            className="rounded-lg bg-zinc-800 text-white px-4 py-2 text-sm font-medium hover:bg-zinc-700 disabled:opacity-50 disabled:pointer-events-none"
          >
            {updateLoading ? "처리 중…" : "상태 업데이트"}
          </button>
            </div>
          </>
        )}

        {(detail !== null || detailLoading || detailFallback !== null) && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
            onClick={() => {
              if (!detailLoading) {
                setDetail(null);
                setDetailFallback(null);
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label="글 상세"
          >
            <div
              className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200">
                <h2 className="font-semibold text-zinc-800">
                  {detailLoading ? "불러오는 중…" : "커뮤니티 글 상세"}
                </h2>
                {!detailLoading && (
                  <button
                    type="button"
                    onClick={() => {
                      setDetail(null);
                      setDetailFallback(null);
                    }}
                    className="text-zinc-500 hover:text-zinc-800 p-1"
                    aria-label="닫기"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="overflow-y-auto p-4 flex-1">
                {detailLoading ? (
                  <p className="text-zinc-500">로딩 중...</p>
                ) : detailFallback && !detail ? (
                  <p className="text-zinc-600 whitespace-pre-wrap break-words">
                    {detailFallback}
                  </p>
                ) : detail ? (
                  <>
                    {detail.title && (
                      <h3 className="text-lg font-medium text-zinc-900 mb-2">
                        {detail.title}
                      </h3>
                    )}
                    <div className="text-zinc-700 whitespace-pre-wrap break-words mb-4">
                      {detail.content || "(내용 없음)"}
                    </div>
                    {detail.image_urls.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-zinc-600">
                          첨부 ({detail.image_urls.length})
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {detail.image_urls.map((url, i) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-lg overflow-hidden bg-zinc-100 aspect-square"
                            >
                              <img
                                src={url}
                                alt={`첨부 ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
