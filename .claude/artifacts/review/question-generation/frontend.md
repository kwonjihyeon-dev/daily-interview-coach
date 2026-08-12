# 오늘의 질문 노출 프론트엔드 — 핵심 로직

- **목적**: 결함 찾기(audit)가 아니라 **이해(comprehension)** — `/today` 페이지가 질문을 어떻게 가져오고, 소진 상태를 어떻게 처리하는지 지도 그리기
- **대상 파일**: `apps/web/src/app/today/page.tsx`, `apps/web/src/app/today/EmptyQuestionState.tsx`
- **관련 스펙**: `질문-생성_spec.md`(v2) "프론트엔드 — 신규 /today 페이지" 절
- **연결점**: `resume-upload/ui.md`의 `proceedToToday()`가 여기로 이동시킴 / `question-generation/backend.md`의 `GET·POST /api/questions`를 호출

## 1. `page.tsx`는 Server Component — 서버에서 먼저 질문을 가져온다

`apiGet("/api/questions/today", ...)`을 서버에서 호출해 결과에 따라 분기:

```
unauthenticated → redirect(gate 페이지)
!response.ok    → 에러 문구만 렌더
question === null → <EmptyQuestionState /> (질문 소진, Client Component에 위임)
question 있음   → 질문 텍스트 렌더
```

## 2. 핵심 포인트 — 질문 소진 감지와 재생성은 서로 다른 컴포넌트가 처리

소진 여부는 **서버 컴포넌트가 최초 진입 시점에** 판단하지만(`body.question === null`), 실제 재생성은 **클라이언트 컴포넌트**(`EmptyQuestionState`)가 별도 라운드트립으로 처리한다. 서버 컴포넌트는 재생성 완료를 기다리지 않는다.

- `EmptyQuestionState`는 `apiClient.ts`가 `import "server-only"`라 사용할 수 없으므로, `ResumeUploadForm.tsx`/`GateForm.tsx`와 **동일한 아키텍처**(브라우저가 `NEXT_PUBLIC_API_BASE_URL`로 `credentials:"include"` 직접 fetch)를 그대로 반복한다.

## 3. 핵심 포인트 — "다시 시도"는 `GET /today` 재호출이 아니다

`EmptyQuestionState`의 "다시 시도" 버튼은 `POST /api/questions/generate`를 **`sourceId` 없이(`{}`)** 직접 호출한다(v2 확정 지침). 별도로 `GET /today`를 다시 부르지 않는다.

- 이 호출을 받는 백엔드(`resolveSourceId`, `questions.ts:46-52`)가 `sourceId` 키 자체가 없으면 `findLatestResumeSourceId`로 "가장 최근 업로드한 이력서"를 fallback으로 쓰는 로직 — 이게 실제로 소비되는 지점이 바로 여기다.
- 성공 시 응답의 `question`을 그대로 화면에 렌더(추가 fetch 없음), 실패 시 에러 문구 + 재시도 버튼 유지.
