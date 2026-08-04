import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "매일 면접 코치",
  description: "매일 하나씩 면접 질문을 연습하고 스트릭을 쌓는 개인용 습관 트래커",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
