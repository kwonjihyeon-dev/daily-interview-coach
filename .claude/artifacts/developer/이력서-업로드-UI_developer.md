## 구현 완료: 이력서 업로드 UI

### 구현 계획 (착수 전 제시했던 계획)
- **상태 설계**: `selectedFile`(File | null), `errorMessage`(string | null, 표시용), `errorSource`("client" | "server" | null, 에러 출처 구분 전용), `isUploading`(boolean), `uploadedSource`(Source | null).
- **제출 버튼 활성화**: `isClientValidationError = errorSource === "client"`를 파생시키고 `disabled = !selectedFile || isUploading || isClientValidationError`로 구현 — 서버 에러(`errorSource === "server"`) 직후에는 재선택 없이 즉시 재활성화되도록 함.
- **client/server 에러 구분 방법**: `errorMessage`(문자열)와 별개로 `errorSource` 상태를 두어, 클라이언트 사전 검증(`validateResumeFile`)에서 설정한 에러는 `"client"`, 서버 응답/네트워크 예외로 설정한 에러는 `"server"`로 표시. 두 출처가 동일한 문자열 포맷을 공유하더라도 버튼 활성화 조건 판단에는 `errorSource`만 사용.
- **폼 ↔ 성공 패널 스위칭**: `uploadedSource`의 truthy 여부로 렌더링을 완전히 분기(동시 노출 없음). `resetForm` 클릭 시 폼이 통째로 재마운트되므로 별도 `ref.value=""`나 `key` 강제 리마운트 없이도 파일 input이 자연스럽게 초기화됨(YAGNI).
- **401 처리**: `next/navigation`의 `useRouter().replace("/gate?reason=expired&next=%2F")`를 인라인 에러 표시 없이 즉시 호출(GateForm.tsx와 동일 패턴).
- **요청 방식**: `fetch`에 `FormData`(필드명 "file")를 그대로 전달하고 `Content-Type`을 수동 설정하지 않음(브라우저가 multipart boundary 자동 생성).

### 테스트 통과 현황
- 신규 테스트(`ResumeUploadForm.test.tsx`): 21/21 통과
- 기존 테스트: 76/76 통과 (신규 포함 전체 스위트, 회귀 없음)
  - `middleware.test.ts` 7, `visitorCookie.test.ts` 9, `sanitizeNextPath.test.ts` 9, `apiClient.test.ts` 15, `gate/page.test.tsx` 8, `gate/GateForm.test.tsx` 7, `ResumeUploadForm.test.tsx` 21
- 타입체크: 통과 (`pnpm typecheck`, api/web 모두 성공)

### 구현 파일
- `apps/web/src/app/ResumeUploadForm.tsx` (신규, `"use client"`) — 파일 선택 UI, 클라이언트 사전 검증(`validateResumeFile`), 업로드 요청(`uploadResume`), 로딩/성공/에러 상태, 리셋(`resetForm`)을 모두 소유
- `apps/web/src/app/page.tsx` (수정) — placeholder 문구 제거, `<ResumeUploadForm />` 렌더링

### 기존 코드 수정
- `apps/web/src/app/page.tsx`: placeholder 텍스트("스캐폴딩 완료 — ...")를 제거하고 `<ResumeUploadForm />`을 렌더링하도록 변경. 이 변경은 spec(`이력서-업로드-UI_spec.md` "대상 파일" 절)이 명시적으로 지시한 것이며, 기존 함수 시그니처/컴포넌트 Props 변경이 아니므로 별도 승인 없이 진행함.

### 리팩토링
- `validateResumeFile`(파일 검증 순수 함수)과 `buildResumePreview`(미리보기 포맷팅 순수 함수)를 컴포넌트 외부로 분리 — 상태 관리 로직과 검증/포맷팅 로직 분리, 렌더링마다 재생성되지 않음.
- 매직 넘버(5MB = 5,242,880)와 확장자 검사 정규식을 상단 상수(`MAX_FILE_SIZE_BYTES`, `ALLOWED_EXTENSION_PATTERN`)로 추출.
- 불필요한 `useMemo`/`useCallback` 없이 파생 상태(`isClientValidationError`, `isSubmitDisabled`)는 매 렌더링 시 직접 계산(React 훅 최소화 원칙 준수).

### 스펙과 다르게 판단/구현한 지점

1. **`uploadResume`의 방어적 가드**: spec 원문의 코드 블록(91~134행)은 `if (!selectedFile || errorMessage) return;`이었다. 이를 문자 그대로 구현하면, 서버 에러로 `errorMessage`가 채워진 뒤 재클릭 시 이 가드에서 즉시 `return`되어 버려, 같은 spec 문서가 명시한 "서버 에러 후 재선택 없이 제출 버튼 재클릭으로 재시도 가능"(엣지 케이스 #6/#8, `unsupported_file_type`·`storage_upload_failed` AC)과 정면으로 충돌한다.
   - **판단**: 가드 로직을 제출 버튼 활성화 조건과 동일하게 `if (!selectedFile || isUploading || isClientValidationError) return;`로 구현했다.
   - **근거**: spec v1.1이 "제출 버튼 활성화 조건" 절만 명시적으로 수정하고, 바로 아래 "업로드 요청" 절의 예시 코드 블록에 있는 방어적 가드는 갱신하지 않은 채로 남겨둔 잔여 불일치로 판단했다. 두 절이 요구하는 "재시도 가능" 의도가 서로 충돌하므로, Acceptance Criteria(사용자가 최종 확정한 동작)를 우선했다. 실제로 이 판단이 없었다면 엣지 케이스 #14(`unsupported_file_type` 재시도)와 #16(`storage_upload_failed` 재시도) 테스트가 실패했을 것을 확인함(구현 중 재현).

2. **파일 input의 `accept` 속성** (최초 구현 시 임시 생략 → 최종 상태에서 복원):
   - **1차 구현 시 발견한 문제**: spec이 명시한 `accept=".pdf,.txt,application/pdf,text/plain"`을 그대로 두면, `@testing-library/user-event`의 `upload()`가 기본 설정(`applyAccept: true`)으로 `accept`와 MIME/확장자가 일치하지 않는 파일(.docx 등)의 `change` 이벤트 자체를 억제해, ".docx 확장자 즉시 에러 표시" 테스트(엣지 케이스 #4, #5)가 재현되지 않는 문제를 확인했다. 1차 구현에서는 이를 우회하기 위해 `accept` 속성을 임시로 생략했었다.
   - **최종 처리**: 사용자 결정에 따라 test-architect가 테스트 쪽(`ResumeUploadForm.test.tsx`의 `selectFile()` 헬퍼)에서 `userEvent.setup({ applyAccept: false })`로 수정해 문제를 해소했고, 이에 맞춰 컴포넌트의 `accept` 속성을 spec 원문(`accept=".pdf,.txt,application/pdf,text/plain"`) 그대로 복원했다. 최종 산출물은 spec 코드 스니펫과 완전히 일치한다.

**Status**: Implementation Complete
