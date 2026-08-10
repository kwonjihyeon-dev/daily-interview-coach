# 테스트 명세: 이력서 업로드 UI

- 총 테스트 케이스: 21개 (정상 8개 / 엣지 8개 / 에러 5개)
- 파일: `apps/web/src/app/ResumeUploadForm.test.tsx`
- 최초 작성 시 실행 결과(TDD Red, `ResumeUploadForm.tsx` 없음): 1 test file / 0 test 수집 — `Failed to resolve import "./ResumeUploadForm" ... Does the file exist?` (구현 없음 — 정상)
- **업데이트(developer 구현 중, `userEvent`의 `applyAccept` 이슈 수정 후)**: `pnpm --filter @daily-interview-coach/web test -- ResumeUploadForm` 결과 **21/21 통과**(1-3절 참고). `accept` 속성을 컴포넌트에 임시로 복원한 상태로도, 복원하지 않은 상태로도 모두 21/21 통과함을 확인함.

**Status**: Test Specification Complete (developer 구현 중 발견된 이슈 반영 완료)
**Next Action**: 테스트 코드를 확인하신 후 승인해주시면 @developer가 구현을 계속 진행합니다.

---

## 0. 사전 작업

이번 단계에서는 신규 devDependency를 추가하지 않았습니다. `apps/web/package.json`에 이미 `vitest`, `@testing-library/react`, `@testing-library/user-event`, `jsdom`, `@vitejs/plugin-react`가 설치되어 있고(`GateForm.test.tsx` 등 기존 테스트가 이미 이 스택을 사용 중), `vitest.config.ts`/`vitest.setup.ts`도 이미 존재합니다(`environment: "jsdom"`, `afterEach(cleanup)`). 별도 설정 변경 없이 `ResumeUploadForm.test.tsx` 한 파일만 추가했습니다.

## 1. 테스트가 전제하는 모듈 구조 (developer 구현 가이드)

테스트는 아직 존재하지 않는 아래 모듈을 import한다. developer 단계에서 이 경로·이름(named export)을 그대로 따라야 테스트가 통과한다.

| 모듈 | 역할 |
| --- | --- |
| `apps/web/src/app/ResumeUploadForm.tsx` | `"use client"`. `export function ResumeUploadForm()` (props 없음). 파일 선택 UI, 클라이언트 검증, 업로드 요청, 로딩/성공/에러 상태를 모두 소유 (테스트 대상, 모킹 없음) |

`next/navigation`의 `useRouter`와 전역 `fetch`는 `vi.mock`/`vi.stubGlobal`로 대체한다(`GateForm.test.tsx`와 동일 패턴).

### 1-1. 테스트가 가정하는 접근성 이름(accessible name)

스펙 문서(`이력서-업로드-UI_spec.md`)에 명시된 것을 그대로 사용했습니다.

| 요소 | 접근 방법 | 텍스트 | 근거 |
| --- | --- | --- | --- |
| 파일 선택 input | `getByLabelText("이력서 파일")` | — | 스펙 명시 (`<label htmlFor="resume-file">`) |
| 제출 버튼(평상시) | `getByRole("button", { name: "이력서 업로드하기" })` | "이력서 업로드하기" | 스펙 명시 ("제출 버튼 문구" 절, 사용자 결정) |
| 제출 버튼(로딩 중) | `getByRole("button", { name: "업로드 중..." })` | "업로드 중..." | 스펙 명시 |
| 성공 패널 | `getByRole("status")` | "이력서가 업로드되었습니다." 포함 | 스펙 명시 (`role="status"`) |
| 에러 메시지 컨테이너 | `getByRole("alert")` | 서버/클라이언트 메시지 | 스펙 명시 (`role="alert"`) |
| "면접 진행하기" 버튼 | `getByRole("button", { name: "면접 진행하기" })` | disabled + `aria-disabled="true"` + 인접 텍스트 "준비 중입니다." | 스펙 명시 |
| "다른 파일 업로드" 버튼 | `getByRole("button", { name: "다른 파일 업로드" })` | — | 스펙 명시 |

### 1-2. 스펙 내부 불일치 — 해소됨 (v1.1)

이전 버전의 이 문서에서 다음 불일치를 발견해 보고했습니다.

`이력서-업로드-UI_spec.md`의 "제출 버튼 활성화 조건" 절이 최초에는 `disabled = !selectedFile || !!errorMessage || isUploading` 공식을 명시했는데, 이를 문자 그대로 적용하면 서버 에러 응답으로 `errorMessage`가 채워진 뒤 제출 버튼이 계속 비활성 상태로 남아, 같은 문서의 `storage_upload_failed`/`unsupported_file_type` AC가 서술하는 "같은 파일로 재시도 버튼(제출 버튼 재클릭)이 가능하다"는 요구와 충돌했습니다.

**사용자 확정(스펙 v1.1 반영 완료)**: 최종 공식은 다음과 같습니다.

```
disabled = !selectedFile || isUploading || isClientValidationError
```

- `isClientValidationError`는 `errorMessage`가 **클라이언트 사전 검증**(확장자/크기)에서 설정된 경우에만 `true`다. 서버 응답으로 설정된 `errorMessage`(예: `unsupported_file_type`, `storage_upload_failed`)는 이 조건에 포함하지 않는다.
- 구현 시 `errorMessage`(표시용 문자열)와 별개로 에러 출처를 구분하는 상태(예: `errorSource: "client" | "server" | null`)를 추가로 관리해야 한다.

**이 테스트 파일에 반영한 내용**:

- `unsupported_file_type`(엣지 케이스 #14), `storage_upload_failed`(엣지 케이스 #16) 테스트는 이제 서버 에러 이후 제출 버튼이 **명시적으로 재활성화(`not.toBeDisabled()`)** 되는지, 그리고 **재선택 없이 같은 파일로 재클릭하면 실제로 두 번째 요청이 전송되는지**까지 검증합니다(더 이상 disabled 여부를 회피하지 않음).
- 클라이언트 사전 검증 실패 케이스(5MB 초과, 0바이트, .docx 확장자 — 엣지 케이스 #9, #11, #12)는 여전히 제출 버튼이 `toBeDisabled()` 상태로 남는지 검증합니다. 이는 새 공식에서도 `isClientValidationError === true`이므로 기존 단정 그대로 유효합니다.

### 1-3. `userEvent.upload()`의 `applyAccept` 필터 우회 (developer 구현 중 발견, 해결됨)

**문제**: developer 구현 중, 파일 input에 스펙대로 `accept=".pdf,.txt,application/pdf,text/plain"` 속성을 두면 `.docx` 확장자 에러 표시 테스트(엣지 케이스 #12)가 재현되지 않는 문제가 발견됐다. 원인은 `@testing-library/user-event`(v14.6.3)가 기본 설정(`applyAccept: true`)으로, `input[accept]`와 MIME/확장자가 불일치하는 파일에 대해 `change` 이벤트 자체를 발생시키지 않기 때문이다 — 즉 테스트가 우리 컴포넌트의 `selectFile` 클라이언트 검증 로직이 아니라 user-event의 accept 필터를 검증하게 되어 버린 것이다.

**택하지 않은 방법**: `accept` 속성을 컴포넌트에서 아예 생략(developer의 최초 우회). 이는 명세("파일 선택 UI" 절)에 명시된 `accept` 속성을 삭제하는 것이므로 사용자가 원치 않아 기각했다.

**최종 방법(이 테스트 파일에 반영)**: `accept` 속성은 스펙대로 컴포넌트에 유지하고, 테스트 쪽의 파일 선택 헬퍼 `selectFile()`에서 `userEvent.setup({ applyAccept: false })`로 user-event의 accept 필터만 비활성화한다.

```ts
async function selectFile(file: File) {
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText("이력서 파일"), file);
  return user;
}
```

- `applyAccept: false`는 이 테스트 파일 전역에서 파일을 선택하는 유일한 경로(`selectFile` 헬퍼)에 적용했다. 유효한 `.pdf`/`.txt` 파일 시나리오는 애초에 `accept` 필터에 걸리지 않는 파일이므로 이 옵션 변경으로 동작이 달라지지 않는다 — 실제로 정상 시나리오(#1~#8)와 5MB/0바이트 경계값 테스트(#9~#11) 전부 이 변경 후에도 그대로 통과함을 확인했다.
- **검증 방법**: `ResumeUploadForm.tsx`에 `accept=".pdf,.txt,application/pdf,text/plain"`을 임시로 복원한 뒤 21개 테스트 전부가 통과하는지 직접 확인했다(이 문서 갱신 시점 기준 developer가 아직 `accept`를 복원하지 않은 상태였으므로, test-architect가 일시적으로 복원해 재현 후 다시 원상복구함 — 구현 파일 자체는 최종적으로 변경하지 않음). 이로써 이 우회가 "accept가 실제로 존재해도" 유효함을 확인했다.
- developer가 `accept` 속성을 복원하면(이번 이슈의 본래 목적) 이 테스트는 그대로 통과한다. 반대로 `accept`를 생략한 채로 두어도 이 옵션은 무해하다(필터가 아예 없으므로).

---

## 2. 테스트 케이스 목록

### 정상 시나리오 (8개)

| # | 테스트명 | 대응 AC |
| - | --- | --- |
| 1 | 초기 렌더링 시 파일이 선택되지 않아 제출 버튼이 비활성화되어 있다 | 활성화 조건(암묵) |
| 2 | 4.9MB 크기의 유효한 .pdf 파일을 선택하면 에러 없이 제출 버튼이 활성화된다 | 정상 시나리오 #1 |
| 3 | 제출 버튼을 클릭하면 업로드 중 상태로 전환되고, apps/api에 올바른 형태(URL/method/credentials/FormData 필드명 "file"/Content-Type 미수동설정)로 요청을 보낸다 | 정상 시나리오 #2 |
| 4 | 201 응답을 받으면 폼이 사라지고 성공 패널이 나타나며 source.id/createdAt/rawText, "면접 진행하기"(disabled) 등이 표시된다 | 정상 시나리오 #2 |
| 5 | rawText 길이가 정확히 100자면 미리보기에 "..."가 붙지 않는다 | 정상 시나리오 #3 (100자 경계값) |
| 6 | rawText 길이가 101자면 미리보기는 앞 100자 + "..."로 표시된다 | 정상 시나리오 #4 (101자) |
| 7 | "다른 파일 업로드" 버튼을 클릭하면 폼이 초기화되어 다시 나타난다(파일 input 빈 값, 제출 버튼 비활성) | 정상 시나리오 #5 |
| 8 | "면접 진행하기" 버튼은 비활성화 상태이므로 클릭을 시도해도 아무 동작이 일어나지 않는다 | 정상 시나리오 #6 |

### 엣지 케이스 (8개)

| # | 테스트명 | 대응 AC |
| - | --- | --- |
| 9 | 5,242,881바이트(5MB+1) 파일 선택 → 네트워크 요청 없이 즉시 크기 초과 에러 | 엣지 #1 |
| 10 | 정확히 5,242,880바이트(5MB) 파일 → 경계값 허용, 제출 버튼 활성화 | 엣지 #2 |
| 11 | 0바이트 파일 → 네트워크 요청 없이 즉시 빈 파일 에러 | 엣지 #3 |
| 12 | 확장자 .docx → 네트워크 요청 없이 즉시 지원하지 않는 형식 에러 | 엣지 #4 |
| 13 | .docx 에러 표시 후 유효한 .txt로 재선택 → 에러 해제, 제출 버튼 활성화 | 엣지 #5 |
| 14 | 확장자는 .pdf지만 서버가 400 unsupported_file_type 반환 → message 표시, selectedFile 유지, 재선택 없이 제출 버튼이 재활성화되어 재클릭 시 2번째 요청 전송 확인 | 엣지 #6 |
| 15 | 업로드 중 제출 버튼 더블클릭 → fetch는 1회만 발생 | 엣지 #7 |
| 16 | 서버 500 storage_upload_failed → message 표시, isUploading false 복귀, selectedFile 유지, 재선택 없이 제출 버튼이 재활성화되어 같은 파일로 재클릭 시 2번째 요청 전송 확인 | 엣지 #8 |

### 에러 케이스 (5개)

| # | 테스트명 | 대응 AC |
| - | --- | --- |
| 17 | 401 unauthorized 응답 → 인라인 에러 없이 즉시 `/gate?reason=expired&next=%2F`로 `router.replace` | 에러 #1 |
| 18 | 네트워크 단절(fetch 예외) → "일시적인 오류가 발생했습니다..." 표시 | 에러 #2 |
| 19 | 200번대가 아니고 JSON 파싱 자체가 실패 → 동일 일시적 오류 메시지 | 에러 #3 |
| 20 | 400 응답 body에 message 필드 없음 → fallback "오류가 발생했습니다." | 에러 #4 |
| 21 | 파일 미선택 상태로 강제 submit 이벤트(disabled 우회 시뮬레이션) → 방어적 가드로 fetch 미호출 | 에러 #5 |

---

## 3. 실행 결과

### 3-1. 최초 작성 시점 (TDD Red 확인)

```
pnpm --filter @daily-interview-coach/web test -- ResumeUploadForm

 FAIL  src/app/ResumeUploadForm.test.tsx [ src/app/ResumeUploadForm.test.tsx ]
Error: Failed to resolve import "./ResumeUploadForm" from "src/app/ResumeUploadForm.test.tsx".
Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

`apps/web/src/app/ResumeUploadForm.tsx`가 존재하지 않아 모듈 로드 자체가 실패한다 — 구현이 전혀 없는 현재 상태에서 기대되는 정상적인 실패다.

### 3-2. developer 구현 중 `applyAccept` 이슈 수정 후 (1-3절)

```
pnpm --filter @daily-interview-coach/web test -- ResumeUploadForm

 ✓ src/app/ResumeUploadForm.test.tsx (21 tests) 373ms

 Test Files  1 passed (1)
      Tests  21 passed (21)
```

`ResumeUploadForm.tsx`가 구현된 상태에서 21/21 전부 통과함을 확인했다. `accept` 속성이 컴포넌트에 있는 상태(1-3절 검증 목적으로 test-architect가 일시 복원 후 원상복구)와 없는 상태(developer가 이슈 발견 당시 우회해 둔 현재 상태) 모두에서 동일하게 21/21 통과했다.
