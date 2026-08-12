"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createVisitorSession } from "./actions";

/**
 * 대상 스펙: .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 1" 절.
 *
 * v2까지 브라우저가 `${NEXT_PUBLIC_API_BASE_URL}/api/sessions`를 `credentials:"include"`로
 * 직접 호출했지만, 프로덕션에서 apps/api가 `127.0.0.1`에만 바인딩되면(deploy-topology-review.md
 * 3절) 브라우저가 더 이상 apps/api에 도달할 수 없어, Server Action `createVisitorSession`
 * (`./actions`)을 호출하는 것으로 바뀌었다. `apiPost` 호출·Set-Cookie 파싱·쿠키 적용은 그
 * 액션 내부(및 `setCookieForwarding.ts`)의 책임이다 — 이 컴포넌트는 반환값의 `kind`로
 * 분기만 한다. `createVisitorSession` 호출 자체가 프레임워크 레벨에서 reject될 수 있으므로
 * (액션 ID 불일치 등) 이 호출도 try/catch로 감싼다(액션 내부 catch와 이중 방어).
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
      const result = await createVisitorSession(email);

      if (result.kind === "failed") {
        setErrorMessage(result.message);
        setIsSubmitting(false);
        return;
      }

      router.replace(nextPath);
    } catch {
      // createVisitorSession 호출 자체가 프레임워크 레벨에서 reject되는 경우를 위한 이중
      // 방어(액션 내부 catch와 동일한 안내 문구로 처리).
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
