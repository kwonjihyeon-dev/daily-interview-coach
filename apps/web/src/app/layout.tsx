import type { Metadata } from "next";
import localFont from "next/font/local";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// 화면 텍스트 대부분이 한글이라 Pretendard(가변 폰트)를 헤드라인/본문 공용으로 쓴다.
// 라틴 전용 디스플레이 폰트는 한글 문자열에서 시스템 폰트로 폴백되어 무의미해지므로 배제.
const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  variable: "--font-pretendard",
  display: "swap",
});
// ID/타임스탬프 등 라틴·숫자 데이터 표기에만 쓰는 유틸리티 모노스페이스.
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

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
    <html lang="ko" className={`${pretendard.variable} ${plexMono.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  );
}
