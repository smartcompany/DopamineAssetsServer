import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "신고 관리 대시보드",
  description: "커뮤니티 글 신고·AI 분류",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
