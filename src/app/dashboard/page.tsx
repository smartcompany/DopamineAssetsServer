"use client";

import { useEffect, useState } from "react";

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
    Record<string, "content_hidden" | "no_issue" | "">
  >({});
  const [updateLoading, setUpdateLoading] = useState(false);
  const [filter24h, setFilter24h] = useState<"all" | "over24" | "within24">(
    "all",
  );

  const [hmdConfig, setHmdConfig] = useState<HotMoverDiscussionForm | null>(
    null,
  );
  const [hmdLoadError, setHmdLoadError] = useState(false);
  const [hmdSaveLoading, setHmdSaveLoading] = useState(false);

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
            "원문을 불러올 수 없습니다. (이미 삭제되었을 수 있습니다.)",
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
          "저장된 미리보기만 있습니다. 글이 삭제된 경우 원문을 열 수 없습니다.",
      );
      setDetailLoading(false);
      return;
    }
    void fetchTargetDetail(r.target_id, r.target_title_or_content);
  };

  const fetchReports = async (
    priorSelections?: Record<string, "content_hidden" | "no_issue" | "">,
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
    const initial: Record<string, "content_hidden" | "no_issue" | ""> = {};
    for (const r of data.reports || []) {
      const raw = r.admin_verdict ?? priorSelections?.[r.id];
      const v =
        raw === "remove_post"
          ? "content_hidden"
          : raw === "content_hidden" || raw === "no_issue"
            ? raw
            : "";
      initial[r.id] = v;
    }
    setAdminSelections(initial);
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
        if (!cancelled && data.config) setHmdConfig(data.config);
        else if (!cancelled) setHmdLoadError(true);
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
      if (data.config) setHmdConfig(data.config);
      alert("급등·급락 토론 푸시 조건을 저장했습니다.");
    } finally {
      setHmdSaveLoading(false);
    }
  };

  const handleUpdateStatus = async () => {
    const updates = reports
      .filter(
        (r) =>
          adminSelections[r.id] === "content_hidden" ||
          adminSelections[r.id] === "no_issue",
      )
      .map((r) => ({
        report_id: r.id,
        admin_verdict: adminSelections[r.id] as "content_hidden" | "no_issue",
      }));
    if (updates.length === 0) {
      alert("선택한 신고 처리가 없습니다.");
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
        alert(data.error || "상태 업데이트에 실패했습니다.");
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
        <p className="text-zinc-500">확인 중...</p>
      </div>
    );
  }

  if (authenticated === false) {
    return (
      <div className="min-h-screen bg-zinc-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-xl bg-white shadow-lg border border-zinc-200 p-8">
          <h1 className="text-xl font-semibold text-zinc-800 mb-6 text-center">
            관리자 로그인
          </h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-600 mb-1">
                아이디
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
                비밀번호
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
              {loginLoading ? "로그인 중..." : "로그인"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-800">관리 대시보드</h1>
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-zinc-600 hover:text-zinc-900"
        >
          로그아웃
        </button>
      </header>

      <main className="p-4 max-w-7xl mx-auto">
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
                  min={1}
                  max={500}
                  value={hmdConfig.minThreadComments}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10);
                    setHmdConfig((c) =>
                      c
                        ? {
                            ...c,
                            minThreadComments: Number.isFinite(n)
                              ? Math.min(500, Math.max(1, n))
                              : c.minThreadComments,
                          }
                        : c,
                    );
                  }}
                  className="w-20 rounded border border-zinc-300 px-2 py-1"
                />
                <span className="text-xs text-zinc-500">
                  루트 스레드 기준으로 묶어 셉니다.
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
              <button
                type="button"
                onClick={() => void saveHotMoverDiscussionConfig()}
                disabled={hmdSaveLoading}
                className="mt-2 rounded-lg bg-amber-800 text-white px-4 py-2 text-sm font-medium hover:bg-amber-900 disabled:opacity-50"
              >
                {hmdSaveLoading ? "저장 중…" : "조건 저장"}
              </button>
            </div>
          )}
          {!hmdConfig && !hmdLoadError && (
            <p className="text-sm text-zinc-500">설정 불러오는 중…</p>
          )}
        </section>

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
                  <th className="px-4 py-3">유형</th>
                  <th className="px-4 py-3">글 미리보기</th>
                  <th className="px-4 py-3">작성자</th>
                  <th className="px-4 py-3">신고 내용</th>
                  <th className="px-4 py-3">신고자</th>
                  <th className="px-4 py-3">AI 처리</th>
                  <th className="px-4 py-3">신고 일시</th>
                  <th className="px-4 py-3">24시간</th>
                  <th className="px-4 py-3">관리자 처리</th>
                </tr>
              </thead>
              <tbody>
                {reports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      신고 내역이 없습니다.
                    </td>
                  </tr>
                ) : sortedReports.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-zinc-500"
                    >
                      해당 조건에 맞는 신고가 없습니다.
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
                          커뮤니티
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-[200px]">
                        <button
                          type="button"
                          onClick={() => openDetail(r)}
                          className="text-left w-full truncate block text-zinc-800 underline decoration-zinc-300 hover:decoration-zinc-600 focus:outline-none"
                          title="클릭하면 원문·사진 보기"
                        >
                          {r.target_title_or_content || "-"}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        {r.host_or_author_name ?? r.host_or_author_id ?? "-"}
                      </td>
                      <td className="px-4 py-3 max-w-[220px]">
                        <div className="font-medium text-zinc-800">
                          {r.reason ?? "-"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {r.reporter_name ?? r.reporter_user_id}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium">
                          {getVerdictLabel(r.ai_verdict)}
                        </span>
                        {r.ai_reason && (
                          <div className="text-zinc-500 text-xs mt-0.5 whitespace-pre-wrap break-words max-w-[280px]">
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
                            24시간 경과
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800">
                            검토 기한 내
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={adminSelections[r.id] ?? ""}
                          onChange={(e) =>
                            setAdminSelections((prev) => ({
                              ...prev,
                              [r.id]: e.target.value as
                                | "content_hidden"
                                | "no_issue"
                                | "",
                            }))
                          }
                          className="rounded border border-zinc-300 px-2 py-1.5 text-zinc-800 text-sm focus:border-zinc-500 focus:outline-none"
                        >
                          <option value="">선택 안 함</option>
                          <option value="no_issue">
                            글 노출·신고 기각 (숨김 해제)
                          </option>
                          <option value="content_hidden">
                            글 숨김·차단 (확정)
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
