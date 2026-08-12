# 테스트 명세: 클라이언트 데이터 계층 전환 (Server-First: RSC + Server Actions/Route Handler)

- 대상 스펙: `.claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md` (Awaiting Approval)
- 이번 작업은 신규 기능이 아니라 **전송 계층 전환(transport swap)** 이므로, 사용자와 합의한
  3구간 스코프 구분을 그대로 따랐습니다(구간 1은 정식 TDD Red, 구간 2는 계약 검증만 가볍게,
  구간 3은 모킹 계층만 교체 — 새 테스트 작성 아님).
- **실행 결과 (실측)**:
  - `apps/web`: `pnpm test` → **11개 파일 중 5개 파일 실패, 92개 테스트 중 27개 실패 / 65개
    통과**. 실패 27개는 모두 **구현이 없어서 발생하는 정상적인 Red**입니다 —
    `setCookieForwarding.test.ts`/`route.test.ts`(신규 2개 파일, 17개 테스트)는 모듈 자체가
    없어 로드 실패, `GateForm.test.tsx`/`ResumeUploadForm.test.tsx`/
    `EmptyQuestionState.test.tsx`(기존 3개 파일, 27개 테스트가 실질적으로 Red)는 아직
    Server Action/Route Handler를 호출하도록 바뀌지 않은 컴포넌트가 옛 `fetch` 경로를 그대로
    쓰고 있어 새 모킹(`uploadResume`/`createVisitorSession` 모듈 모킹, 상대경로 URL)과
    어긋나서 실패합니다. 실패 목록을 직접 확인해 "테스트 자체의 버그로 인한 실패"가 섞여
    있지 않은지 검증했습니다(아래 "실행 결과 검증 방법" 참고). 기존에 통과하던 65개
    (client-only 검증 로직, `apiClient.test.ts`, `sanitizeNextPath.test.ts`,
    `visitorCookie.test.ts`, `proxy.test.ts`, `gate/page.test.tsx`, `today/page.test.tsx` 등)는
    그대로 무손상입니다.
  - `apps/api`: `pnpm test` → **6개 파일, 85개 테스트 전부 통과** — 이번 전환은 `apps/web`
    범위이므로 apps/api는 한 글자도 건드리지 않았습니다(확인 완료).
- **총 테스트 케이스(신규 + 수정)**: 신규 2개 파일(17개 테스트, 전부 이번에 새로 작성) + 기존
  3개 파일 재작성(40개 테스트). 기존 파일의 40개 중 **전송 계층과 무관하게 항상 통과하는
  "client-only" 테스트가 8개**(`ResumeUploadForm.test.tsx`의 파일 크기/확장자 사전 검증,
  미선택 제출 가드처럼 서버를 호출하기 전에 끝나는 경로) — 이 8개는 모킹 계층을 바꿔도 동작이
  같아 그대로 유지했습니다. 나머지 32개는 이번 전환에 실제로 묶여 있어 구현 전까지 Red입니다.

| 파일 | 구간 | 신규/수정 | 정상 | 엣지 | 에러 | 계 | 실행 결과 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `apps/web/src/lib/setCookieForwarding.test.ts` | 1 | 신규 | 4 | 8 | 1 | 13 | 13/13 실패(모듈 없음) |
| `apps/web/src/app/api/questions/generate/route.test.ts` | 2 | 신규 | 1 | 0 | 3 | 4 | 4/4 실패(모듈 없음) |
| `apps/web/src/app/gate/GateForm.test.tsx` | 3 | 모킹 교체 | 1 | 2 | 2 | 5 | 5/5 실패 |
| `apps/web/src/app/ResumeUploadForm.test.tsx` | 3 | 모킹 교체 | 6(+2 client-only) | 3(+5 client-only) | 3(+1 client-only) | 12(+8 client-only, 총 29) | 21/29 실패, client-only 8개는 그대로 통과 |
| `apps/web/src/app/today/EmptyQuestionState.test.tsx` | 3 | URL 단언 1개만 수정 | 3 | 1 | 2 | 6 | 1/6 실패(URL 단언이 바뀐 1개 케이스만) |
| **계** | | | **15** | **14** | **11** | **40**(client-only 8 별도, 총 48) | 아래 참고 |

**실측 결과 대조**: `pnpm test`가 보고한 `Test Files 5 failed | 6 passed (11)` /
`Tests 27 failed | 65 passed (92)`의 "92"는 **모듈이 로드된 파일의 테스트만 집계**합니다.
`setCookieForwarding.test.ts`/`route.test.ts`(신규 2개 파일, 17개 테스트)는 대상 모듈
(`./setCookieForwarding`, `./route`)이 아직 없어 파일 자체가 로드에 실패해 이 92에 전혀
포함되지 않습니다(vitest가 "Failed to resolve import"로 파일 단위 에러 처리) — 이 17개는
개별 어서션 실패가 아니라 파일 로드 자체가 실패하는, 더 확실한 형태의 Red입니다. 실제로
집계된 92개 중 실패한 27개는 전부 기존 3개 파일에서 나왔습니다: `GateForm.test.tsx` 5개 +
`ResumeUploadForm.test.tsx` 21개(client-only 8개는 통과) + `EmptyQuestionState.test.tsx`
1개. 즉 **이번에 새로 작성/수정한 테스트 중 실제로 전송 계층 전환에 묶여 있는 것은 총
44개(17+27)이고 전부 Red, client-only 8개만 예외적으로 여전히 Green**입니다.

## 실행 결과 검증 방법

각 실패가 "테스트를 잘못 써서 나는 실패"가 아니라 "구현이 없어서 나는 실패"인지 하나씩 확인
했습니다. 예를 들어 `GateForm.test.tsx`의 "Server Action 호출 자체가 reject되면..." 케이스는
초안에서는 `GateForm.tsx`가 여전히 옛 `fetch` 경로를 쓰기 때문에, 존재하지 않는
`${undefined}/api/sessions`로의 `fetch` 호출이 즉시 예외를 던지고 기존 catch 블록이 우연히
동일한 일반 오류 문구를 표시해 **의도와 무관하게 테스트가 통과**하는 것을 발견했습니다. 이 상태로
두면 구현이 실제로 `createVisitorSession`을 호출하는지와 무관하게 항상 통과하는 "가짜 Red"였을
것입니다. `expect(createVisitorSessionMock).toHaveBeenCalledWith(...)` 단언을 추가해 실제로
Red가 되도록 고쳤고, 재실행해 27개 실패로 확정했습니다. `EmptyQuestionState.test.tsx`도 실패
원인이 `undefined/api/questions/generate`(스텁된 env가 없어 `NEXT_PUBLIC_API_BASE_URL`이
`undefined`가 됨) 대 `/api/questions/generate`(기대값) 불일치임을 직접 확인해, 의도한 지점
(URL 형태)에서만 깨지는 것을 검증했습니다.

## 구간별 커버리지

### 구간 1 — `apps/web/src/lib/setCookieForwarding.test.ts` (신규, 13개)

이번 작업에서 유일하게 새로 생기고 전환 후에도 계속 사는 로직이라 정식 TDD Red로 촘촘하게
작성했습니다. **파일 상단 주석에 "이 로직이 틀렸을 때의 증상"(무한 리다이렉트: 게이트 통과 →
쿠키 없음 → `proxy.ts`가 다시 `/gate`로 되돌림)을 명시**해, 이후 이 파일을 보는 사람이 왜
이렇게 세밀한 테스트가 필요한지 알 수 있게 했습니다.

- `parseSetCookieHeader` (10개)
  - 정상 2: apps/api가 실제로 내려주는 전체 형태 파싱(Max-Age/Path/HttpOnly/SameSite), Secure
    속성 추가 시 `secure:true`.
  - **단위 변환 트랩 1**: `Max-Age=15552000` → `maxAge===15552000` 그대로(×1000/÷1000 아님).
    ms↔초 실수는 쿠키 수명을 1000배 틀어지게 하므로 명시적으로 `not.toBe(15552000000)`/
    `not.toBe(15552)`까지 못박음.
  - **URL 디코딩 트랩 2**: `user%40example.com` → `user@example.com` 디코드, 디코딩 실패
    (`"a%"`처럼 불완전한 percent-encoding) 시 원본 문자열 유지(방어적).
  - 엣지 5: `Max-Age` 없으면 `maxAge===undefined`, `Expires`(쉼표 포함 날짜 문자열)가 다른
    속성 파싱을 깨지 않고 결과에도 포함되지 않음, 속성 키 대소문자 무관 인식, `SameSite` 값이
    `lax`/`strict`/`none`이 아니면 무시, 세그먼트 앞뒤 공백 trim.
- `applySetCookieHeaders` (3개)
  - 정상 2: 단일/복수 `Set-Cookie` 헤더 각각에 대해 `cookies().set(name, value, options)` 호출.
  - 에러 1: 빈 배열이면 `cookies().set()`이 한 번도 호출되지 않음.
- `next/headers`의 `cookies()`는 `gate/page.test.tsx`의 기존 모킹 관례(동기 함수로 모킹해도
  `await`가 그대로 값을 통과시킴)를 그대로 따랐습니다.

### 구간 2 — `apps/web/src/app/api/questions/generate/route.test.ts` (신규, 4개)

얇은 프록시라 계약 검증 4개만 작성(행복 경로를 여러 변형으로 늘리지 않음, 지시사항 그대로 준수).
`../../../../lib/apiClient`를 모듈째로 모킹하고 `NextRequest`/`Response`는 실제 Web 표준
객체를 사용해 계약을 검증했습니다(`// @vitest-environment node`, `proxy.test.ts`와 동일 관례).

1. 정상: `apiPost`가 `{kind:"ok"}`면 apps/api의 상태 코드와 JSON 바디를 그대로 통과.
2. 에러: `apiPost`가 `{kind:"unauthenticated"}`면 401 + `{error:"unauthorized",
   message:"인증되지 않은 요청입니다."}`.
3. 에러: `apiPost` 호출이 예외를 던지면 500 + `{error:"internal_error", message:"일시적인
   오류가 발생했습니다. 잠시 후 다시 시도해주세요."}`.
4. 에러: 잘못된 JSON 바디면 `apiPost`를 호출하지도 않고 400을 반환.

### 구간 3 — 기존 3개 파일 (새로 작성하지 않고 모킹 계층만 교체)

- **`GateForm.test.tsx`**: `global.fetch` 모킹을 `vi.mock("./actions", () => ({
  createVisitorSession }))`로 교체. Set-Cookie 파싱·`applySetCookieHeaders` 관련 상세
  계약은 구간 1이 이미 담당하므로, 여기서는 `createVisitorSession`의 반환값(`kind`)에 따른
  분기만 검증합니다. 기존 CORS 관련 테스트는 삭제했습니다 — Server Action은 브라우저의
  cross-origin fetch가 아니라 same-origin RPC이므로 CORS 실패라는 개념 자체가 성립하지 않기
  때문입니다(대신 "Server Action 호출 자체가 프레임워크 레벨에서 reject되는" 스펙 AC 케이스로
  대체).
- **`ResumeUploadForm.test.tsx`**: 업로드 관련 테스트는 `vi.mock("./resumeActions", () => ({
  uploadResume }))`로 교체. 질문 생성(자동 트리거/재시도)은 여전히 Route Handler를
  `fetch`로 호출하므로 `global.fetch` 모킹은 유지하되, URL을 절대경로 →
  `/api/questions/generate`(상대경로)로, `credentials:"include"` 단언을 제거로 바꿨습니다.
  파일 크기/확장자/미선택 제출 가드 등 **클라이언트 사전 검증만 다루는 8개 테스트는 서버
  호출 자체가 없어 전환과 무관** — 그대로 통과 상태로 남습니다.
- **`EmptyQuestionState.test.tsx`**: `global.fetch` 모킹 유지, URL 단언만 상대경로로 변경.
  나머지 5개 테스트는 URL을 직접 단언하지 않아 변경 없이 그대로 유지됩니다.

## 보존한 기존 자산 (다음 작업 "AI 답변 피드백 UI"를 위한 그물)

- 401 → 게이트 리다이렉트
- 서버 에러 메시지 그대로 노출
- `errorSource` 구분(서버 에러 후 재선택 없이 재시도 가능)
- stale-response 가드(`uploadedSourceRef`)
- StrictMode 중복 트리거 가드(`generationRequestedSourceIdRef`)
- 업로드 중 더블클릭 방지
- 클라이언트 사전 검증(파일 크기/확장자 경계값)

## v1(fetch 기반)에서 제거한 테스트 케이스와 그 이유

- **"서버 응답이 200번대가 아니고 JSON 파싱 자체가 실패하면 일시적 오류 메시지가 표시된다"**
  (`ResumeUploadForm.test.tsx`): Server Action의 반환값은 이미 구조화된 객체이므로 더 이상
  성립하지 않습니다(스펙 "v1(fetch)에서 사라지는 케이스" 절 명시). 이 파싱은 액션 내부에서
  일어나고 실패 시 액션 내부 try/catch가 흡수합니다.
- **"서버가 400을 반환하지만 body에 message 필드가 없으면 fallback 메시지가 표시된다"**
  (`ResumeUploadForm.test.tsx`): 이 fallback 로직(`body.message ?? "오류가 발생했습니다."`)은
  `resumeActions.ts` 내부에 있고, 이 파일은 `uploadResume`을 모듈째로 모킹하므로 컴포넌트
  테스트로는 검증할 수 없습니다. 스코프 결정상 `resumeActions.ts`/`actions.ts` 자체는 별도
  유닛 테스트 대상이 아니므로(지시사항 "작성하지 않을 것" 절), developer 단계는 이 fallback을
  스펙 문구("파일 변경 목록" 절의 `UploadResumeResult` 동작 설명)만 근거로 구현합니다. 테스트로
  방어되지 않는 지점이므로 developer 리뷰 시 스펙 문구와 실제 구현을 대조 확인해주세요.
- **CORS 관련 테스트**(`GateForm.test.tsx`): Server Action은 same-origin RPC라 CORS 실패
  개념이 성립하지 않아 제거하고, 스펙 AC의 "Server Action 호출 자체가 프레임워크 레벨에서
  실패" 케이스로 대체했습니다.

- **"apps/api가 201을 반환했지만 `Set-Cookie` 헤더가 비어 있으면 `{kind:"failed"}`를 반환한다"**
  (스펙 AC A의 엣지 케이스): 이 분기는 `createVisitorSession`(`actions.ts`) 내부에 있어,
  액션을 모듈째 모킹하는 `GateForm.test.tsx`로는 검증할 수 없습니다.
  `setCookieForwarding.test.ts`는 "빈 배열이면 `cookies().set()`을 호출하지 않는다"까지만
  커버하고, **그 위에서 `{kind:"ok"}` 대신 `{kind:"failed"}`를 반환해야 한다는 판단 자체는
  테스트로 방어되지 않습니다.** 메인 세션 검토(2026-08-12)에서 식별된 공백입니다.
  이 가드가 빠지면 사용자는 게이트를 통과한 것처럼 보이지만 `proxy.ts`가 다시 `/gate`로
  되돌려보내 "에러 메시지 없이 폼만 다시 뜨는" 상태가 됩니다(원인 파악이 어려운 증상).
  방어적 분기(정상 동작하는 apps/api에서는 발생하지 않음)라 테스트를 추가하는 대신
  **developer 단계 리뷰에서 스펙 AC A와 구현을 대조 확인**하는 것으로 처리합니다.

## 수동 확인 항목 (유닛 테스트로 검증 불가능 — developer 단계에서 육안 확인)

- **`next.config.js`의 `experimental.serverActions.bodySizeLimit: "6mb"`**(스펙 AC E): 프레임워크
  설정값이라 유닛 테스트로 검증할 수 없습니다. developer 단계에서 5MB 파일을 실제로 업로드해
  프레임워크 레벨 거부가 발생하지 않는지, 그리고 (선택적으로) 6MB를 초과하는 임의 바디를 만들어
  실제로 거부되는지 브라우저/curl로 육안 확인해주세요.
- **Server Action의 쿠키 set 이후 자동 재렌더링과 `router.replace(nextPath)`의 상호작용**
  (스펙 "구현 리스크" 절): `/gate` 페이지가 Server Action의 쿠키 변경으로 자동 재렌더링되는
  것과 `GateForm`의 `router.replace(nextPath)` 호출이 겹쳐 중복 네비게이션이나 콘솔 경고가
  발생하는지 실제 브라우저에서 확인이 필요합니다(단위 테스트로는 이 프레임워크 수준의 상호작용을
  관찰할 수 없음).

## 작성하지 않은 것 (명세 요구사항대로)

- 전환 자체를 검증하는 일회용 테스트(예: "`NEXT_PUBLIC_API_BASE_URL`이 더 이상 참조되지
  않는지") — 작성하지 않았습니다.
- `actions.ts`/`resumeActions.ts` 내부 구현에 대한 별도 유닛 테스트 — 작성하지 않았습니다
  (위 "제거한 테스트 케이스" 절에서 그로 인해 테스트로 방어되지 않는 지점을 명시).

---

**Status**: Test Specification Complete
**Next Action**: 테스트 코드를 확인하신 후 승인해주시면 @developer에게 구현을 요청하겠습니다.
