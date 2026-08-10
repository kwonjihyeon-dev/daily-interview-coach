# 이력서 업로드 UI 코드 독해 가이드

- **목적**: 결함 찾기(audit)가 아니라 **이해(comprehension)** — `ResumeUploadForm.tsx`가 무엇을 하는지 머릿속에 지도 그리기
- **대상 파일**: `apps/web/src/app/ResumeUploadForm.tsx`, 진입점 `apps/web/src/app/page.tsx`
- **관련 스펙**: `이력서-업로드-UI_spec.md`(v1.1), `질문-생성_spec.md`(v2)

## 0. 먼저 알아둘 것 — 한 파일에 스펙이 둘 겹쳐 있다

`ResumeUploadForm.tsx`는 두 기능이 한 컴포넌트에 얹혀 있다. 파일을 열면 "문서보다 코드가 많네?" 하게 되는 이유:

- **본연(이력서 업로드, v1.1)**: 파일 선택 → 검증 → 업로드 → 성공/에러
- **나중에 얹힘(질문 생성 자동 트리거, v2)**: 업로드 성공하면 **자동으로** 질문 생성 API 호출

이 둘을 분리해서 읽으면 훨씬 쉽다.

## 1. 읽는 순서 (위→아래가 곧 이해 순서)

1. **파일 상단 주석(8–24행)** — 아키텍처(브라우저가 apps/api 직접 호출)와 상태 설계 의도 요약. 여기부터.
2. **모듈 상수·순수 함수(26–52행)** — `validateResumeFile`(검증), `buildResumePreview`(100자 미리보기), `formatFileSize`. 상태와 무관한 순수 로직이라 부담 없음.
3. **상태 선언(55–74행)** — 이 컴포넌트의 심장 (2번 지도 참고).
4. **흐름 함수 5개** — `selectFile`(124) → `uploadResume`(139) → `generateQuestions`(76)+`useEffect`(116) → `resetForm`(180) → `proceedToToday`(190).
5. **렌더 분기(195행~)** — `uploadedSource` 유무로 성공 패널 vs 폼.

## 2. 상태 지도 (여기만 이해하면 절반은 끝)

| 상태 | 의미 | 이게 바뀌면 |
|------|------|------------|
| `selectedFile` | 현재 고른 파일 | 제출 버튼 활성 판단 |
| `errorMessage` | **표시용** 에러 문자열 | 폼 하단 alert |
| `errorSource` | 에러 **출처**(client/server) | 버튼 잠금 여부 판단 |
| `isUploading` | 업로드 요청 진행 중 | 버튼/인풋 비활성 |
| `uploadedSource` | 업로드 성공 결과 | **truthy면 화면이 성공 패널로 전환** |
| `questionGenerationStatus` | 질문 생성 단계(idle/generating/ready/error) | 성공 패널 안 CTA/문구 |
| `generationErrorMessage` | 질문 생성 실패 문구 | 에러 상태 문구 |

파생값 2개(계산만, state 아님): `isClientValidationError`(= errorSource가 client), `isSubmitDisabled`(= 파일없음 || 업로드중 || 클라검증실패).

**핵심 통찰**: `errorMessage`(뭘 보여줄까)와 `errorSource`(누가 낸 에러냐)를 **일부러 분리**했다. 이유 — "서버 에러 후엔 재선택 없이 즉시 재시도 가능, 클라 검증 에러는 파일 바꿔야 잠금 해제"라는 서로 다른 동작. 버튼 잠금은 `errorSource`만 본다.

## 3. 시간순 흐름 (사용자 여정 = 코드 여정)

```
파일 선택 ─selectFile─▶ validateResumeFile
                         ├ 통과 → errorSource=null (제출 가능)
                         └ 실패 → errorMessage+errorSource="client" (버튼 잠김)
제출 클릭 ─uploadResume─▶ POST /api/sources/resume
                         ├ 401 → router.replace("/gate...")
                         ├ 실패 → errorMessage+errorSource="server" (재시도 가능)
                         └ 201 → setUploadedSource(...)   ← 화면이 성공 패널로 전환
                                     │
       (자동) uploadedSource 변화 ─useEffect─▶ generateQuestions()
                         ├ generating → "질문을 생성 중입니다"
                         ├ ready      → "면접 진행하기" 버튼 활성
                         └ error      → 실패 문구 + "다시 시도"
"면접 진행하기" ─proceedToToday─▶ (ready일 때만) router.push("/today")
"다른 파일 업로드" ─resetForm─▶ 모든 상태 초기화
```

## 4. 처음 보면 갸웃할 관용구 2개 (이해의 함정)

- **70–71행 `uploadedSourceRef.current = uploadedSource;` (렌더 중 직접 대입)**
  "렌더 도중 부작용 아냐?" 싶지만 아니다. `generateQuestions`가 async라, **응답이 도착한 시점엔 이미 사용자가 리셋했거나 다른 파일을 올렸을 수** 있다. 그때 낡은 응답이 화면을 덮어쓰지 않도록, 응답 도착 시점의 "최신" 값을 ref로 들고 있다가 91·110행에서 `ref.current.id !== sourceId`면 그냥 `return`한다. → **stale-response 가드**.

- **74·116–122행 `generationRequestedSourceIdRef` + useEffect**
  자동 트리거가 **같은 sourceId로 두 번** 안 돌게 막는 장치. React StrictMode(개발 모드)에서 effect가 2번 실행돼도 질문 생성 POST는 1회만 나가야 하니까. "이미 이 sourceId로 요청했나?"를 ref로 기억.

## 5. 서버와 어떻게 대화하나 (한 줄 모델)

이 컴포넌트는 **RSC/apiClient를 안 쓴다.** `"use client"`에서 브라우저가 `NEXT_PUBLIC_API_BASE_URL`로 **직접 `fetch`** + `credentials:"include"`(쿠키 실어보냄). 업로드는 `FormData`(Content-Type 수동 설정 안 함 → 브라우저가 multipart boundary 자동 생성), 질문 생성은 JSON. — 클라이언트 "쓰기" 패턴의 실물이 이 파일이다([`client-data-strategy.md`](../../../docs/client-data-strategy.md) 참고).
