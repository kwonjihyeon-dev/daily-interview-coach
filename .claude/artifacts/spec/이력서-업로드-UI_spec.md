# 기능 명세: 이력서 업로드 UI

## 개요

`POST /api/sources/resume`(이미 구현·승인됨, `.claude/artifacts/spec/이력서-업로드_spec.md` v4)를 호출하는 화면을 만든다. 이 명세는 **화면(UI)만** 다루며, 백엔드 검증 순서·에러 코드·Storage 정책은 재정의하지 않고 그대로 인용한다.

이 화면은 이메일 기반 방문자 게이트(`apps/web/src/middleware.ts`)로 이미 보호되는 경로에 위치한다 — 화면에 진입했다는 것 자체가 유효한 `dic_visitor_email` 쿠키(형식 검사 통과)를 보유한 상태임을 전제한다. 단, 쿠키가 페이지 로드 이후 세션 중간에 무효화될 수 있는 경우(관리자가 `users` 테이블에서 row 삭제 등)를 대비해 업로드 요청 자체의 401 응답은 별도로 처리한다(아래 "인증 만료 처리" 참고).

### 라우트 결정

**채택: 기존 `/` 라우트(`apps/web/src/app/page.tsx`)를 이력서 업로드 화면으로 교체한다. 신규 `/upload` 라우트는 만들지 않는다.**

근거:
- PRD 1차 범위 ①("입력 페이지: 이력서 업로드 + Notion 링크 → AI 질문 생성")이 정의하는 화면이 정확히 이것이다. 현재 `page.tsx`는 "Phase 3에서 구현" 안내문만 있는 미사용 placeholder다.
- 이 프로젝트에는 아직 네비게이션 바/링크 구조가 전혀 없다. `/upload`라는 별도 라우트를 만들면 그리로 이동할 진입점을 함께 설계해야 하는데, 이는 이번 스코프(YAGNI)를 벗어난다.
- Notion 링크 입력은 다음 기능(별도 스펙)이며, 완료되면 같은 `/` 페이지에 두 번째 입력 섹션으로 추가될 가능성이 높다 — 지금 별도 라우트로 분리하면 나중에 다시 합쳐야 한다.

### 대상 파일

| 구분 | 경로 | 역할 |
| --- | --- | --- |
| 수정 | `apps/web/src/app/page.tsx` | Server Component. placeholder 텍스트 제거, `<ResumeUploadForm />` 렌더링만 담당(인증 재검사 없음 — 미들웨어가 이미 처리) |
| 신규 | `apps/web/src/app/ResumeUploadForm.tsx` | Client Component(`"use client"`). 파일 선택, 클라이언트 검증, 업로드 요청, 로딩/성공/에러 상태를 모두 소유 |

`gate/page.tsx` + `gate/GateForm.tsx`의 "Server Component page + Client Component form" 분리를 그대로 따른다.

## 상세 명세

### 화면 상태 (state machine)

`ResumeUploadForm`은 아래 상태를 관리한다:

| 상태 변수 | 타입 | 설명 |
| --- | --- | --- |
| `selectedFile` | `File \| null` | 사용자가 파일 선택 input에서 고른 파일(유효/무효 무관하게 저장 — 파일명 표시용) |
| `errorMessage` | `string \| null` | 클라이언트 검증 실패 또는 서버 에러 메시지. 둘은 동일한 문구 매핑 테이블을 공유한다 |
| `isUploading` | `boolean` | 업로드 요청 진행 중 여부 |
| `uploadedSource` | `Source \| null` (from `@daily-interview-coach/shared-types`) | 업로드 성공 시 서버가 반환한 `source` 전체 |

`uploadedSource`가 `null`이 아니면 폼 대신 성공 패널을 렌더링한다(두 UI는 동시에 보이지 않는다).

### 파일 선택 UI

```html
<input
  type="file"
  accept=".pdf,.txt,application/pdf,text/plain"
  onChange={selectFile}
/>
```

- `multiple` 속성을 두지 않는다 — 한 번에 1개만 선택 가능(백엔드의 "1개만 허용" 정책과 UI 레벨에서부터 일치).
- 드래그 앤 드롭은 지원하지 않는다(YAGNI, 클릭 기반 파일 선택만).
- 파일 선택 input은 React에서 비제어(uncontrolled) 컴포넌트다 — "다른 파일 업로드"로 리셋할 때 `value`를 코드로 지울 수 없으므로, `ref.current.value = ""`를 호출하거나 `key` prop을 변경해 강제 리마운트하는 방식으로 구현한다(개발자 구현 시 유의사항으로 남김, 방식 선택은 developer 재량).

### 클라이언트 사전 검증 (선택 즉시 실행, `selectFile` 함수)

**범위 결정: 확장자와 파일 크기만 클라이언트에서 검증한다. MIME 타입은 검증하지 않는다.**

근거:
- 확장자와 크기(0바이트 초과, 5,242,880바이트 이하)는 `File` 객체(`file.name`, `file.size`)에서 100% 신뢰 가능한 값이다. 이 두 가지를 업로드 전에 걸러주면 5MB짜리 잘못된 파일을 무의미하게 네트워크로 보내는 낭비를 막고, 사용자에게 즉시 피드백을 줄 수 있다.
- `file.type`(MIME)은 브라우저·OS 조합에 따라 빈 문자열로 오는 경우가 실무적으로 흔해(예: 일부 환경에서 `.txt` 파일의 `file.type`이 `""`) 신뢰할 수 없다. 클라이언트에서 이를 검사해 false positive(유효한 파일을 잘못 차단)를 만드는 것보다, MIME 검증은 서버(확장자+MIME 둘 다 확인)에 전적으로 위임한다.
- 이 사전 검증은 **UX 보조 수단일 뿐 보안 경계가 아니다** — 클라이언트 검증을 우회해 요청을 보내더라도 서버가 동일한 규칙(더 엄격하게, MIME까지)으로 다시 검증하므로 데이터 무결성에는 영향이 없다.

검증 순서 및 문구(서버 에러 메시지와 동일한 한글 문구를 재사용해 사용자가 같은 개념을 다른 표현으로 두 번 배우지 않게 한다):

| 순서 | 조건 | `errorMessage` |
| --- | --- | --- |
| 1 | `file.size === 0` | `"빈 파일은 업로드할 수 없습니다."` |
| 2 | `file.size > 5_242_880` | `"파일 크기는 5MB를 초과할 수 없습니다."` |
| 3 | 파일명 확장자가 `.pdf`/`.txt`(대소문자 무관)가 아님 | `"PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다."` |
| — | 위 모두 통과 | `errorMessage = null` |

- 정확히 5,242,880바이트(5MB)는 **허용**(백엔드 스펙의 경계값 정의와 동일: `≤ 5MB`).
- 확장자 비교는 대소문자를 구분하지 않는다(`.PDF`도 허용).
- 검증은 파일을 **다시 선택할 때마다** 재실행되며, 이전 `errorMessage`를 덮어쓴다.

### 제출 버튼 활성화 조건

```
disabled = !selectedFile || isUploading || isClientValidationError
```

- `isClientValidationError`: `errorMessage`가 **클라이언트 사전 검증**(확장자/크기)에서 설정된 경우에만 `true`. 서버 응답으로 설정된 `errorMessage`(예: `unsupported_file_type`, `storage_upload_failed` 등)는 이 조건에 포함하지 않는다.
- 즉 파일이 없거나, 업로드 중이거나, **클라이언트 사전 검증에 실패한 상태**면 비활성화한다. **서버 에러 응답을 받은 직후에는 파일을 다시 선택하지 않아도 버튼이 다시 활성화되어**, 같은 파일로 즉시 재시도할 수 있다(사용자 결정: 서버 일시 오류 등에서 재선택을 강제하는 것은 불필요한 마찰이라 판단).
- 구현 시 `errorMessage`(표시용 문자열)와 별개로 에러 출처를 구분하는 상태(예: `errorSource: "client" | "server" | null`)를 추가로 관리해야 한다 — `errorMessage` 문자열만으로는 출처를 구분할 수 없다.
- 이 조건 때문에 백엔드의 `no_file`/`too_many_files`는 정상적인 UI 흐름에서는 도달하지 않는다(아래 "도달 불가능한 에러 코드" 참고).

**(v1.1 수정 — test-architect가 발견한 내부 모순 해소)**: 최초 버전은 `disabled = !selectedFile || !!errorMessage || isUploading`였으나, 이 공식대로면 서버 에러 후 `errorMessage`가 채워져 제출 버튼이 계속 막혀 "같은 파일로 재시도 가능"이라는 Acceptance Criteria와 충돌했다. 위 공식으로 수정해 해소함.

### 업로드 요청 (`uploadResume` 함수)

```ts
async function uploadResume(event: FormEvent<HTMLFormElement>): Promise<void> {
  event.preventDefault();
  if (!selectedFile || errorMessage) return; // 방어적 가드, 버튼 disabled로 정상 흐름에서는 도달 안 함

  setIsUploading(true);
  setErrorMessage(null);

  const formData = new FormData();
  formData.append("file", selectedFile); // 필드명 반드시 "file" (백엔드 스펙 고정)

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/sources/resume`,
      { method: "POST", credentials: "include", body: formData }
      // Content-Type 헤더를 수동으로 설정하지 않는다 — FormData를 body로 넘기면
      // 브라우저가 multipart 경계(boundary)를 포함한 Content-Type을 자동 생성한다.
      // 수동 설정 시 boundary 누락으로 서버가 파싱하지 못한다.
    );

    if (response.status === 401) {
      router.replace("/gate?reason=expired&next=%2F");
      return;
    }

    const body = await response.json();

    if (!response.ok) {
      setErrorMessage(body.message ?? "오류가 발생했습니다.");
      setIsUploading(false);
      return;
    }

    setUploadedSource(body.source);
    setIsUploading(false);
  } catch {
    // 네트워크 단절, apps/api 무응답, CORS 차단, JSON 파싱 실패를 모두 동일하게 처리한다.
    // (GateForm과 동일한 패턴)
    setErrorMessage("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    setIsUploading(false);
  }
}
```

### 인증 만료 처리 (401)

- 이 화면은 미들웨어로 보호되므로 정상 흐름에서는 401을 받을 일이 거의 없지만, 페이지를 열어둔 채 오래 방치하거나 관리자가 `users` 테이블에서 row를 삭제하는 등 세션 중간 무효화 시나리오가 있다.
- **결정(사용자 승인): 401 응답은 인라인 에러 메시지로 보여주지 않고 `router.replace("/gate?reason=expired&next=%2F")`로 즉시 리다이렉트한다.**
- 근거: `.claude/artifacts/spec/이메일-방문자-게이트_spec.md`(v2)가 "브라우저가 apps/api를 직접 호출하며 401을 받는 기능이 생기면, 그 기능의 스펙에서 이 리다이렉트 컨벤션(`/gate?reason=expired&next=...`)을 따를지 결정한다"고 명시적으로 열어둔 지점이며, 이 화면이 바로 그 첫 사례다. `apiClient.ts`(SSR 헬퍼)가 이미 동일한 `redirectTo` 포맷(`/gate?reason=expired&next=${encodeURIComponent(currentPath)}`)을 쓰고 있어 일관성이 있다.
- `next` 값은 이 화면이 항상 `/`이므로 하드코딩된 `%2F`(= `/`의 URL 인코딩)를 사용한다(동적 계산 불필요, YAGNI).

### 제출 버튼 문구

| 상태 | 문구 |
| --- | --- |
| 평상시(업로드 전, `isUploading === false`) | `"이력서 업로드하기"` (사용자 결정) |
| 업로드 중(`isUploading === true`) | `"업로드 중..."` |

### 로딩 상태

- `isUploading === true`인 동안:
  - 제출 버튼은 비활성화되고 텍스트가 `"업로드 중..."`으로 바뀐다.
  - 파일 선택 input도 비활성화한다(업로드 중 파일 변경 방지).
- 중복 클릭/중복 제출 방지: 버튼이 비활성화되므로 동일 요청이 2번 발생하지 않는다.

### 성공 상태

`uploadedSource`가 채워지면 폼을 숨기고 아래 정보를 보여주는 성공 패널을 렌더링한다:

| 표시 항목 | 내용 |
| --- | --- |
| 안내 문구 | `"이력서가 업로드되었습니다."` |
| 추출 텍스트 미리보기 | `uploadedSource.rawText`의 **앞 100자** (사용자 결정). 100자를 초과하면 `"..."`을 이어붙인다. 정확히 100자면 `"..."`를 붙이지 않는다 |
| 저장 식별자 | `uploadedSource.id` (전체 UUID 그대로 표시) |
| 업로드 시각 | `uploadedSource.createdAt` (KST ISO 8601 문자열을 그대로 표시하거나 사람이 읽기 쉬운 형식으로 가공 — 가공 방식은 developer 재량, YAGNI로 우선 원문 표시도 허용) |
| "면접 진행하기" 버튼 | **항상 비활성화(`disabled`) 상태로 렌더링.** 버튼 옆/아래에 `"준비 중입니다."` 보조 문구를 함께 표시한다 |
| 재시도 버튼 | `"다른 파일 업로드"` — 클릭 시 `resetForm()` 호출, 폼 상태 전체 초기화(선택 파일 없음, 에러 없음, `uploadedSource=null`) 후 폼 재표시 |

**"면접 진행하기" 버튼에 대한 스코프 결정**: AI 질문 생성/오늘의 질문 화면(PRD 3.5)이 아직 구현되어 있지 않으므로, 이번 스코프에서는 버튼을 **UI 요소로만 배치**하고 클릭 동작(onClick, 라우팅, API 호출)은 구현하지 않는다 — `disabled` 속성으로 고정해 클릭 자체가 불가능하게 한다. 실제 동작 연결은 AI 질문 생성 기능(별도 스펙)의 책임이며, 그 기능이 구현될 때 이 버튼의 `disabled`를 해제하고 이동 로직을 추가한다. 지금 클릭 가능하게 만들면 이동할 대상이 없어 죽은 링크가 된다(사용자 승인: "버튼은 넣되 비활성화 상태로").

**성공 후 다른 화면으로 자동 이동하지 않는다.** 사용자는 같은 화면에서 원하면 이력서를 추가로 더 업로드할 수 있다 — 백엔드가 이미 "새 업로드는 항상 새 row 추가, 기존 것 삭제 안 함"을 허용하므로 UI도 이를 막지 않는다.

### 에러 메시지 매핑 (서버 → 화면, 그대로 인용)

`response.ok === false`이고 401이 아닌 경우, `body.message`를 그대로 `errorMessage`에 표시한다(서버가 이미 한글 사용자 노출용 메시지를 내려주므로 클라이언트에서 재매핑하지 않는다 — 문구 중복 관리 방지). 아래 표는 백엔드 스펙(`이력서-업로드_spec.md`)의 에러 코드 표를 참고용으로 재확인한 것이며, 화면 구현이 이 값을 하드코딩하지 않고 `body.message`를 신뢰함을 명시한다:

| `error` 코드 | 상태코드 | `message` (서버가 내려주는 값, 화면은 그대로 표시) | 정상 UI 흐름에서 도달 가능? |
| --- | --- | --- | --- |
| `no_file` | 400 | "업로드할 파일이 없습니다." | 아니오 — 제출 버튼이 파일 미선택 시 비활성화됨 |
| `too_many_files` | 400 | "파일은 한 번에 1개만 업로드할 수 있습니다." | 아니오 — `multiple` 속성 없음 |
| `empty_file` | 400 | "빈 파일은 업로드할 수 없습니다." | 아니오 — 클라이언트 사전 검증이 먼저 차단 |
| `file_too_large` | 400 | "파일 크기는 5MB를 초과할 수 없습니다." | 아니오 — 클라이언트 사전 검증이 먼저 차단 |
| `unsupported_file_type` | 400 | "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다." | **예** — 확장자는 맞지만 실제 내용/MIME이 다른 경우(클라이언트는 확장자만 검사) |
| `storage_upload_failed` | 500 | "파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요." | 예 — 서버측 일시 장애 |
| `extraction_failed` | 400 | "파일에서 텍스트를 추출할 수 없습니다. 파일이 손상되었을 수 있습니다." | 예 |
| `text_too_short` | 400 | "추출된 텍스트가 너무 짧습니다. 스캔 이미지로 만든 PDF인지 확인해주세요." | 예 |
| `internal_error` | 500 | "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." | 예 |
| `unauthorized` | 401 | (인라인 표시 안 함 — 위 "인증 만료 처리" 참고, `/gate`로 리다이렉트) | 예(세션 만료 시) |

- `no_file`/`too_many_files`/`empty_file`/`file_too_large`가 "정상 흐름에서 도달 불가능"이라는 것은 **UI 우회(개발자 도구로 disabled 속성 제거, 프로그래밍적 폼 제출 등)까지 막는다는 뜻은 아니다** — 그런 우회 시에도 `uploadResume` 함수의 방어적 가드와 서버의 진짜 검증이 최종적으로 막는다. 다만 이 네 가지 코드에 대한 UI 레벨 테스트는 "도달 불가능"을 근거로 test-architect가 우선순위를 낮춰도 무방하다.
- 서버가 예상치 못한 형식의 에러 바디를 반환하거나 `message` 필드가 없는 경우, `"오류가 발생했습니다."`를 fallback으로 표시한다(`body.message ?? "오류가 발생했습니다."`, GateForm과 동일 패턴).

### 접근성(accessibility) 최소 요건

- 에러 메시지 컨테이너는 `role="alert"`로 렌더링한다(GateForm과 동일 패턴, 스크린리더가 즉시 읽도록).
- 성공 패널은 `role="status"`로 렌더링한다.
- 파일 선택 input에는 `<label htmlFor="resume-file">이력서 파일</label>`을 연결한다.
- "면접 진행하기" 버튼은 `disabled` 속성과 함께 `aria-disabled="true"`도 명시한다.

### 스코프 외

- Notion 링크 입력(별도 기능, 이번 화면에 함께 넣지 않음).
- AI 질문 생성 트리거/실제 이동 로직(별도 기능, PRD 3.5) — "면접 진행하기" 버튼은 이번 스코프에서 배치만 하고 비활성화 상태로 둠.
- 업로드된 이력서 목록 조회, "최신 이력서" 표시, 삭제 기능.
- 드래그 앤 드롭 업로드.
- 업로드 진행률(progress bar) — `fetch`는 네이티브로 업로드 진행률을 제공하지 않으며(XHR 필요), 5MB 이하 소용량 파일에서는 체감 효과가 낮아 이번 스코프에서 제외(YAGNI). 필요해지면 `XMLHttpRequest`로 전환 검토.
- 다국어(i18n) — 한글 고정.

## 일관성 검증

- `Source` 타입(`packages/shared-types/src/index.ts`)을 수정 없이 그대로 사용(`id`, `userId`, `type`, `rawText`, `sourceUrl`, `createdAt`) — 필드명/구조 충돌 없음.
- `NEXT_PUBLIC_API_BASE_URL`, `credentials:"include"` 직접 호출 패턴은 `GateForm.tsx`와 완전히 동일한 아키텍처(이메일-방문자-게이트 v2 스펙의 "브라우저 직접 호출" 결정)를 재사용 — 새로운 아키텍처 패턴을 만들지 않는다.
- 401 처리 시 리다이렉트 대상(`/gate?reason=expired&next=...`)은 `apps/web/src/lib/apiClient.ts`가 이미 쓰는 포맷과 동일한 문자열 규칙을 따른다.
- 함수명은 `동사+목적어`(`selectFile`, `uploadResume`, `resetForm`) — `handleSubmit` 같은 접두사 형태를 쓰지 않음(CLAUDE.md 컨벤션 준수).
- 불리언 상태는 `is` 접두사(`isUploading`) 사용.
- 시간 표시는 서버가 이미 KST(+09:00) ISO 8601로 내려준 `createdAt`을 그대로 사용 — 화면에서 별도 시간대 변환 로직 불필요.

## Acceptance Criteria

### 정상 시나리오

```
Given 방문자가 유효한 게이트 쿠키로 "/"에 접근해 이력서 업로드 화면을 보고 있다
When 4.9MB 크기의 유효한 .pdf 파일을 선택한다
Then 클라이언트 검증을 통과해 에러 메시지가 표시되지 않고, 제출 버튼이 활성화된다
```

```
Given 유효한 .pdf 파일이 선택되어 제출 버튼이 활성화된 상태다
When 제출 버튼을 클릭한다
Then 버튼 텍스트가 "업로드 중..."으로 바뀌고 비활성화되며, 파일 input도 비활성화된다
And POST 요청이 NEXT_PUBLIC_API_BASE_URL + "/api/sources/resume"로, method:"POST", credentials:"include", body에 FormData(필드명 "file")로 전송된다
And 서버가 201과 { source: {...} }를 반환하면 폼이 사라지고 성공 패널이 나타난다
And 성공 패널에 source.id, source.createdAt, source.rawText의 앞 100자(+"...")가 표시된다
And 성공 패널에 "면접 진행하기" 버튼이 비활성화(disabled) 상태로 표시된다
```

```
Given rawText 길이가 정확히 100자인 source로 업로드가 성공했다
When 성공 패널이 렌더링된다
Then 미리보기 텍스트는 100자 전체이며 "..."가 붙지 않는다
```

```
Given rawText 길이가 101자인 source로 업로드가 성공했다
When 성공 패널이 렌더링된다
Then 미리보기 텍스트는 앞 100자 + "..."로 표시된다
```

```
Given 이력서 업로드가 성공해 성공 패널이 보이는 상태다
When "다른 파일 업로드" 버튼을 클릭한다
Then 성공 패널이 사라지고 폼이 다시 나타나며, 파일 선택 input이 비어 있고 제출 버튼이 비활성화 상태다
```

```
Given 이력서 업로드가 성공해 성공 패널이 보이는 상태다
When "면접 진행하기" 버튼을 클릭을 시도한다
Then 버튼이 disabled 상태이므로 아무 동작(네비게이션, API 호출)도 발생하지 않는다
```

### 엣지 케이스

```
Given 업로드 화면이 열려 있다
When 5,242,881바이트(5MB+1바이트) 크기의 .pdf 파일을 선택한다
Then 네트워크 요청 없이 즉시 "파일 크기는 5MB를 초과할 수 없습니다." 에러가 표시되고, 제출 버튼이 비활성화 상태로 유지된다
```

```
Given 업로드 화면이 열려 있다
When 정확히 5,242,880바이트(5MB) 크기의 .pdf 파일을 선택한다
Then 클라이언트 검증을 통과해 제출 버튼이 활성화된다(경계값 허용)
```

```
Given 업로드 화면이 열려 있다
When 0바이트 크기의 파일을 선택한다
Then 네트워크 요청 없이 즉시 "빈 파일은 업로드할 수 없습니다." 에러가 표시된다
```

```
Given 업로드 화면이 열려 있다
When 확장자가 .docx인 파일을 선택한다
Then 네트워크 요청 없이 즉시 "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다." 에러가 표시된다
```

```
Given 확장자가 .docx인 파일을 선택해 에러가 표시된 상태다
When 유효한 .txt 파일로 다시 선택한다
Then 이전 에러 메시지가 사라지고 제출 버튼이 활성화된다
```

```
Given 확장자는 .pdf이지만 실제 내용이 PDF가 아닌 손상된 파일을 선택했다(클라이언트는 확장자만 보므로 통과)
When 제출 버튼을 클릭한다
Then 요청이 전송되고, 서버가 400과 error="unsupported_file_type" 또는 "extraction_failed"를 반환하면 그 message가 그대로 화면에 표시된다
And 폼은 사라지지 않고 selectedFile이 유지되어 재시도(다른 파일 선택 또는 재제출)가 가능하다
```

```
Given 업로드 요청 중(isUploading=true) 상태다
When 사용자가 제출 버튼을 다시 클릭(더블클릭)한다
Then 버튼이 비활성화되어 있으므로 두 번째 요청은 발생하지 않고, fetch 호출 횟수는 1회로 유지된다
```

```
Given 서버가 500과 { error: "storage_upload_failed", message: "파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요." }를 반환한다
When 응답을 받는다
Then 해당 message가 그대로 표시되고, isUploading이 false로 돌아오며, selectedFile은 유지되어 같은 파일로 재시도 버튼(제출 버튼 재클릭)이 가능하다
```

### 에러 케이스

```
Given 업로드 요청 도중 서버가 401과 { error: "unauthorized", message: "..." }를 반환한다
When 응답을 받는다
Then 인라인 에러 메시지를 표시하지 않고 즉시 "/gate?reason=expired&next=%2F"로 라우팅(router.replace)된다
```

```
Given 서버 요청 중 네트워크가 단절되어 fetch가 예외를 던진다
When 업로드를 시도한다
Then "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." 메시지가 표시되고 isUploading이 false로 돌아온다
```

```
Given 서버 응답이 200번대가 아니고 JSON 파싱 자체가 실패한다(예: 빈 바디)
When 업로드 응답을 처리한다
Then catch 블록으로 흘러 "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요." 메시지가 표시된다
```

```
Given 서버가 400을 반환하지만 body에 message 필드가 없다
When 응답을 처리한다
Then fallback 메시지 "오류가 발생했습니다."가 표시된다
```

```
Given 개발자 도구 등으로 제출 버튼의 disabled 속성이 강제로 해제되어, 파일이 선택되지 않은 채로 폼 제출(submit) 이벤트가 강제로 발생한다
When uploadResume 함수가 실행된다
Then 함수 최상단의 방어적 가드(!selectedFile 체크)에 의해 즉시 return되어, fetch 요청이 전혀 발생하지 않는다
```

---
**Status**: Specification Complete (사용자 승인 반영: 401 즉시 리다이렉트, 미리보기 100자, "면접 진행하기" 버튼 배치만 하고 비활성화) — Approved
