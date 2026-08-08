"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

/**
 * 대상 스펙: .claude/artifacts/spec/이메일-방문자-게이트_spec.md "게이트 폼(GateForm)" 절.
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const response = await fetch("/api/gate/verify", {
      method: "POST",
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
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
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
