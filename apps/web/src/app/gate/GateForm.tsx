"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md (v2) "게이트 폼(GateForm, 변경 — 직접 호출)" 절.
 *
 * v1의 Next.js Route Handler(`/api/gate/verify`) 프록시는 폐기되었다 — 브라우저가
 * `${NEXT_PUBLIC_API_BASE_URL}/api/sessions`을 `credentials:"include"`로 직접
 * 호출한다(apps/api가 쿠키를 발급하므로 브라우저가 이를 저장하려면 필수). `fetch`와
 * `response.json()` 파싱을 하나의 try/catch로 묶어 네트워크 단절/CORS 차단/JSON
 * 파싱 실패를 모두 동일한 안내 문구로 처리한다.
 *
 * `reason=expired` 배너 렌더링은 부모(게이트 페이지, Server Component)의 책임이다 —
 * 이 컴포넌트는 폼 제출/에러표시/재시도(잠금 없음)만 책임진다.
 */
interface GateFormProps {
  nextPath: string;
}

export function GateForm({ nextPath }: GateFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitForm(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/sessions`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const body = await response.json();

      if (!response.ok) {
        setErrorMessage(body.message ?? "오류가 발생했습니다.");
        setIsSubmitting(false);
        return;
      }

      router.replace(nextPath);
    } catch {
      // 네트워크 단절, apps/api 무응답, CORS 차단, JSON 파싱 실패를 모두 동일하게 처리한다.
      setErrorMessage("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={submitForm} noValidate>
      <label htmlFor="gate-email">이메일</label>
      <input
        id="gate-email"
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="submit" disabled={isSubmitting}>
        제출
      </button>
      {errorMessage && <p role="alert">{errorMessage}</p>}
    </form>
  );
}
