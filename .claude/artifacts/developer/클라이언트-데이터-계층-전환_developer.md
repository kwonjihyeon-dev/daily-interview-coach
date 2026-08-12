## 구현 완료: 클라이언트 데이터 계층 전환 (Server-First: RSC + Server Actions/Route Handler)

### 테스트 통과 현황
- 신규 테스트: `setCookieForwarding.test.ts` 13/13, `route.test.ts`(questions/generate) 4/4 통과
- 기존 테스트(모킹 계층 교체분): `GateForm.test.tsx` 5/5, `ResumeUploadForm.test.tsx` 29/29, `EmptyQuestionState.test.tsx` 6/6 통과
- apps/web 전체: **109/109 통과** (11 파일), 회귀 없음
- apps/api 전체: **85/85 통과** (6 파일) — apps/api는 한 글자도 건드리지 않음
- 타입체크: `pnpm --filter @daily-interview-coach/web typecheck` 통과
- lint: `pnpm --filter @daily-interview-coach/web lint` — 에러 0(기존 `postcss.config.mjs` 무관 경고 1개만 존재, 이번 변경과 무관)

### 구현 파일

**신규 4개**
- `apps/web/src/lib/setCookieForwarding.ts` — `parseSetCookieHeader`/`applySetCookieHeaders`. Max-Age는 단위 변환 없이 그대로 `maxAge`에 대입(스펙 트랩 준수).
- `apps/web/src/app/gate/actions.ts` (`'use server'`) — `createVisitorSession`. `apiPost` 호출 → 401/에러/성공 분기 → `Set-Cookie` 빈 배열 가드 → `applySetCookieHeaders` → `{kind:"ok"}`. 전체 try/catch.
- `apps/web/src/app/resumeActions.ts` (`'use server'`) — `uploadResume`. `formData.get("file")` 타입 가드 → 새 `FormData`로 재포장해 `apiPost("/api/sources/resume", {body})` → `unauthenticated`/`failed`/`success` 매핑. 전체 try/catch.
- `apps/web/src/app/api/questions/generate/route.ts` — `POST` Route Handler. `request.json()` 파싱 실패 400 → `apiPost` 호출 → `unauthenticated` 401 매핑 → 성공 시 apps/api 응답의 상태코드/바디를 그대로 통과 → 예외 500.

**수정 4개**
- `apps/web/src/app/gate/GateForm.tsx` — `fetch` 제거, `createVisitorSession` 호출로 대체. 호출부에도 try/catch 이중 방어 유지.
- `apps/web/src/app/ResumeUploadForm.tsx` — 로컬 제출 핸들러 `uploadResume` → `submitResumeUpload`로 리네임 후 `./resumeActions`의 `uploadResume` 액션 import. 질문 생성(`generateQuestions`)은 URL을 `/api/questions/generate`(상대경로)로, `credentials`/`NEXT_PUBLIC_API_BASE_URL` 제거.
- `apps/web/src/app/today/EmptyQuestionState.tsx` — `regenerateQuestions`의 fetch URL을 상대경로로, `credentials`/`NEXT_PUBLIC_API_BASE_URL` 제거.
- `apps/web/next.config.js` — `experimental.serverActions.bodySizeLimit: "6mb"` 추가.

**마지막 정리 1개**
- `apps/web/.env.example` — `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_KEY` 제거. `API_BASE_URL`(서버 전용)은 유지, 주석을 신규 전환 구조에 맞게 갱신. 8개 파일 전환 및 테스트 Green 확인 후 마지막에 수행함(스펙 지시 순서 준수).

### 기존 코드 수정
CLAUDE.md 승인 기준(기존 함수 시그니처/컴포넌트 Props 변경, `app.ts` 라우트/미들웨어 변경, 파일명/폴더 구조 변경, 의존성 변경)에 해당하는 변경은 없음. `GateForm.tsx`/`ResumeUploadForm.tsx`/`EmptyQuestionState.tsx`의 내부 구현(전송 계층)만 수정했고, 컴포넌트의 외부 Props/시그니처는 그대로다. `apps/api`는 전혀 건드리지 않음.

### 리팩토링
- 최소 구현 원칙(YAGNI)에 따라 별도 리팩토링 단계 없이 처음부터 최종 형태로 구현. 각 파일 상단 주석은 기존 파일들의 컨벤션("대상 스펙: ..." + 설계 의도)을 그대로 따름.
- `applySetCookieHeaders`는 `cookies()`를 루프 밖에서 한 번만 호출하도록 작성(불필요한 반복 호출 방지).

### 스펙과 다르게 판단/구현한 지점
없음. 스펙 문구(설계 판단 1~4, 파일 변경 목록의 `UploadResumeResult`/Route Handler 동작 설명)를 그대로 따라 구현했으며, 테스트로 방어되지 않는 3개 지점(엣지 케이스: Set-Cookie 빈 배열 가드, `resumeActions.ts`의 `body.message ?? "오류가 발생했습니다."` fallback, 각 액션의 try/catch 일반 오류 매핑)도 스펙 문구를 그대로 대조해 구현함.

### 구현 후 육안 확인 (테스트로 검증 불가한 항목)

1. **`bodySizeLimit` 설정 경로**: `next.config.js`를 `require()`로 직접 로드해 `experimental.serverActions.bodySizeLimit`이 정확히 `"6mb"`로 중첩되어 있음을 확인함(Next 16.3 문서 경로와 대조 완료: `apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/serverActions.md:29-45`).
   - **확인하지 못한 것**: 실제로 5MB 이력서 파일을 브라우저에서 업로드해 Server Action이 프레임워크 레벨에서 거부되지 않는지, 6MB 초과 바디가 실제로 거부되는지는 **로컬 dev 서버 + 실제 apps/api(Supabase/AWS 자격증명) + 브라우저 상호작용**이 필요해 이 세션에서 실행하지 못함. 설정값 자체(문서 대비 키 경로, 6MB > 5MB+여유)는 코드 검토로 확인했으나 런타임 동작은 미확인 상태로 남겨둠.

2. **쿠키 set 이후 자동 재렌더링과 `router.replace(nextPath)`의 상호작용**: 이 역시 실제 브라우저(Next dev 서버 + apps/api 응답)가 필요한 관찰이라 이 세션에서 실행하지 못함. 스펙의 예상(두 경로 모두 최종 목적지가 동일해 기능적 문제는 없을 것)에 반하는 근거를 코드 리뷰로는 발견하지 못했고, `router.replace`는 안전망으로 그대로 유지함. 다음에 로컬 `pnpm --filter web dev`로 게이트 폼을 실제 제출해 콘솔 경고/중복 네비게이션 여부를 확인하는 것을 권고함.

**Status**: Implementation Complete
