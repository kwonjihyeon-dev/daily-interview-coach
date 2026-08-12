import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import type { Question, Source } from "@daily-interview-coach/shared-types";
import { ResumeUploadForm } from "./ResumeUploadForm";

/**
 * 대상 스펙: .claude/artifacts/spec/이력서-업로드-UI_spec.md (Approved),
 * .claude/artifacts/spec/클라이언트-데이터-계층-전환_spec.md "설계 판단 2/3" +
 * Acceptance Criteria B/C.
 *
 * v2까지는 브라우저가 apps/api를 `${NEXT_PUBLIC_API_BASE_URL}/api/sources/resume`로
 * `credentials:"include"` 직접 호출했지만, 이번 전환으로 업로드는 Server Action
 * (`./resumeActions`의 `uploadResume`)을 호출하는 것으로 바뀌었다. `uploadResume` 내부의
 * apiPost 호출·상태코드 매핑(성공/실패/401)은 이 컴포넌트의 관심사가 아니므로(스코프
 * 결정 — resumeActions.ts 자체는 별도 유닛 테스트를 만들지 않음), 이 파일은
 * `uploadResume`을 모듈째로 모킹하고 ResumeUploadForm이 그 반환값(`UploadResumeResult`)의
 * `kind`에 따라 올바르게 분기하는지만 검증한다.
 *
 * 반면 질문 생성(`POST /api/questions/generate`)은 Server Action이 아니라 Route Handler로
 * 전환되므로(설계 판단 3 — Server Action 전역 직렬 처리 문제 회피), 여전히 `global.fetch`를
 * 직접 호출한다. 다만 호출 URL이 절대경로(`${NEXT_PUBLIC_API_BASE_URL}/...`)에서 상대경로
 * (`/api/questions/generate`)로 바뀌고, 동일 출처 요청이라 `credentials:"include"`도
 * 제거된다.
 *
 * ## 이 테스트가 스펙 문구를 다루는 방식에 대한 메모
 *
 * 1. 제출 버튼의 접근성 이름(accessible name): 평상시 "이력서 업로드하기", 로딩 중
 *    "업로드 중..."로 스펙에 확정되어 있다("제출 버튼 문구" 절, 사용자 결정).
 * 2. **제출 버튼 활성화 조건 (v1.1에서 해소됨)**: 최종 공식은
 *    `disabled = !selectedFile || isUploading || isClientValidationError`다.
 *    `isClientValidationError`는 errorMessage가 클라이언트 사전 검증(확장자/크기)에서
 *    설정된 경우에만 true이며, 서버 응답으로 설정된 errorMessage(예:
 *    unsupported_file_type, storage_upload_failed — 이제는 `uploadResume`이 반환하는
 *    `{kind:"failed", message}`)는 이 조건에 포함되지 않는다. 즉 서버 에러 응답 직후에는
 *    파일을 다시 선택하지 않아도 제출 버튼이 즉시 재활성화되어 같은 파일로 바로 재클릭할
 *    수 있어야 한다(스펙 "제출 버튼 활성화 조건" 절 참고). 반면 클라이언트 사전 검증 실패
 *    (예: .docx 확장자, 5MB 초과)는 파일을 다시 선택하기 전까지 제출 버튼이 계속 비활성
 *    상태로 남아야 한다.
 *
 * ## v1(fetch 기반)에서 사라진 테스트 케이스에 대한 메모
 *
 * - "서버 응답이 200번대가 아니고 JSON 파싱 자체가 실패하는" 케이스는 더 이상 성립하지
 *   않는다(스펙 "파일 변경 목록" 절 "v1(fetch)에서 사라지는 케이스" 참고) — Server Action의
 *   반환값은 이미 구조화된 객체이므로, 그 파싱은 액션 내부에서 일어나고 실패 시 액션 내부
 *   try/catch가 흡수해 `{kind:"failed", message: 일반 오류}`로 돌려준다. 클라이언트는 별도로
 *   "JSON 파싱 실패"를 구분할 필요가 없어 이 파일에서 제거했다.
 * - "서버가 400을 반환하지만 body에 message 필드가 없으면 fallback 메시지가 표시된다" 케이스도
 *   제거했다 — 그 fallback 로직(`body.message ?? "오류가 발생했습니다."`)은
 *   `resumeActions.ts` 내부에 있고, 이 파일은 `uploadResume`을 모듈째로 모킹하므로 그
 *   내부 로직을 컴포넌트 테스트로는 검증할 수 없다(스코프 결정 — resumeActions.ts는 별도
 *   유닛 테스트 대상이 아님). developer 단계는 스펙 문구를 근거로 구현한다.
 */

const routerReplaceMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: routerReplaceMock, push: routerPushMock }),
}));

const uploadResumeMock = vi.hoisted(() => vi.fn());
vi.mock("./resumeActions", () => ({
  uploadResume: uploadResumeMock,
}));

const fetchMock = vi.hoisted(() => vi.fn());

const FIVE_MB = 5 * 1024 * 1024; // 5,242,880

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function createFile(name: string, sizeInBytes: number, type = "application/octet-stream"): File {
  return new File([new Uint8Array(sizeInBytes)], name, { type });
}

function buildSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "b7e6c1d2-4f3a-4e2b-9c1a-1234567890ab",
    userId: "user-1",
    type: "resume",
    rawText: "안녕하세요, 저는 프론트엔드 개발자입니다.",
    sourceUrl: null,
    createdAt: "2026-08-08T10:00:00+09:00",
    ...overrides,
  };
}

async function selectFile(file: File) {
  // 스펙대로 파일 input에 accept=".pdf,.txt,application/pdf,text/plain"이 설정되면,
  // @testing-library/user-event는 기본값(applyAccept: true)으로 accept와 불일치하는
  // 파일(.docx 등)에 대해 change 이벤트 자체를 억제한다. 이 테스트는 "브라우저가 애초에
  // 막는 파일"이 아니라 "우리 컴포넌트의 selectFile 클라이언트 검증 로직"을 검증하는
  // 것이 목적이므로, applyAccept: false로 user-event의 accept 필터를 끄고 change 이벤트가
  // 항상 발생하도록 한다(유효한 .pdf/.txt 파일 시나리오에는 영향 없음 — 애초에
  // 필터에 걸리지 않는 파일이기 때문).
  const user = userEvent.setup({ applyAccept: false });
  await user.upload(screen.getByLabelText("이력서 파일"), file);
  return user;
}

function buildQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "question-id-1",
    userId: "user-1",
    sourceId: "b7e6c1d2-4f3a-4e2b-9c1a-1234567890ab",
    category: "Next.js/SSR",
    text: "SSR의 트레이드오프에 대해 어떻게 생각하나요?",
    origin: "ai",
    createdAt: "2026-08-08T10:00:05+09:00",
    ...overrides,
  };
}

/** 절대 resolve/reject 되지 않는 Promise — "아직 응답 전" 상태를 고정하기 위함. */
function pendingForever(): Promise<never> {
  return new Promise(() => undefined);
}

function submitButton() {
  return screen.getByRole("button", { name: "이력서 업로드하기" });
}

function fileInput() {
  return screen.getByLabelText("이력서 파일") as HTMLInputElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ResumeUploadForm", () => {
  describe("정상 시나리오", () => {
    it("초기 렌더링 시 파일이 선택되지 않아 제출 버튼이 비활성화되어 있다", () => {
      // Given / When
      render(<ResumeUploadForm />);

      // Then
      expect(submitButton()).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("4.9MB 크기의 유효한 .pdf 파일을 선택하면 에러 없이 제출 버튼이 활성화된다", async () => {
      // Given
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 4.9 * 1024 * 1024, "application/pdf");

      // When
      await selectFile(file);

      // Then
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(submitButton()).not.toBeDisabled();
    });

    it("제출 버튼을 클릭하면 업로드 중 상태로 전환되고, uploadResume이 file을 담은 FormData로 호출된다", async () => {
      // Given: uploadResume이 즉시 resolve되지 않도록 제어
      let resolveUpload: (value: unknown) => void = () => undefined;
      uploadResumeMock.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      );
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then: 로딩 상태
      expect(await screen.findByRole("button", { name: "업로드 중..." })).toBeDisabled();
      expect(fileInput()).toBeDisabled();

      // And: uploadResume이 file을 포함한 FormData로 1회 호출된다
      expect(uploadResumeMock).toHaveBeenCalledTimes(1);
      const formData = uploadResumeMock.mock.calls[0][0] as FormData;
      expect(formData).toBeInstanceOf(FormData);
      expect(formData.get("file")).toBe(file);

      // cleanup: 대기 중인 uploadResume을 마무리한다
      resolveUpload({ kind: "success", source: buildSource() });
    });

    it("uploadResume이 {kind:'success', source}를 반환하면 폼이 사라지고 성공 패널이 나타나며 source 정보가 표시된다", async () => {
      // Given: 업로드는 성공하지만, 뒤이어 자동으로 트리거되는 질문 생성 요청(Route Handler)은
      // 이 테스트의 관심사가 아니므로 응답하지 않는 상태로 묶어둔다.
      const source = buildSource({
        id: "source-id-123",
        createdAt: "2026-08-08T10:00:00+09:00",
        rawText: "짧은 이력서 본문입니다.",
      });
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then: 폼은 사라지고 성공 패널(role="status")이 나타난다
      const successPanel = await screen.findByRole("status");
      expect(screen.queryByLabelText("이력서 파일")).not.toBeInTheDocument();
      expect(successPanel).toHaveTextContent("이력서가 업로드되었습니다.");
      expect(successPanel).toHaveTextContent(source.id);
      expect(successPanel).toHaveTextContent(source.createdAt);
      expect(successPanel).toHaveTextContent(source.rawText);

      // And(v2 — 질문-생성_spec.md): 업로드 직후 자동으로 질문 생성이 트리거되며, 아직
      // 응답 전이므로 "면접 진행하기" 버튼은 비활성화 상태고 생성 중 문구가 보인다.
      const proceedButton = screen.getByRole("button", { name: "면접 진행하기" });
      expect(proceedButton).toBeDisabled();
      expect(
        screen.getByText("이력서 저장 완료 · 질문을 생성 중입니다"),
      ).toBeInTheDocument();
    });

    it("rawText 길이가 정확히 100자면 미리보기에 '...'가 붙지 않는다", async () => {
      // Given
      const rawText = "가".repeat(100);
      const source = buildSource({ rawText });
      uploadResumeMock.mockResolvedValue({ kind: "success", source });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());

      // Then
      const successPanel = await screen.findByRole("status");
      expect(successPanel).toHaveTextContent(rawText);
      expect(successPanel.textContent).not.toContain(`${rawText}...`);
      expect(successPanel.textContent?.includes("...")).toBe(false);
    });

    it("rawText 길이가 101자면 미리보기는 앞 100자 + '...'로 표시된다", async () => {
      // Given
      const rawText = "나".repeat(101);
      const expectedPreview = `${rawText.slice(0, 100)}...`;
      const source = buildSource({ rawText });
      uploadResumeMock.mockResolvedValue({ kind: "success", source });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());

      // Then
      const successPanel = await screen.findByRole("status");
      expect(successPanel).toHaveTextContent(expectedPreview);
    });

    it("'다른 파일 업로드' 버튼을 클릭하면 폼이 초기화되어 다시 나타난다", async () => {
      // Given: 업로드 성공 후 성공 패널이 보이는 상태
      uploadResumeMock.mockResolvedValue({ kind: "success", source: buildSource() });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));
      await user.click(submitButton());
      await screen.findByRole("status");

      // When
      await user.click(screen.getByRole("button", { name: "다른 파일 업로드" }));

      // Then: 성공 패널이 사라지고 폼이 다시 나타난다
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      const resetInput = fileInput();
      expect(resetInput).toBeInTheDocument();
      expect(resetInput.value).toBe("");
      expect(submitButton()).toBeDisabled();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("질문 생성이 진행 중(questionGenerationStatus='generating')인 동안에는 '면접 진행하기' 버튼이 비활성화 상태이므로 클릭을 시도해도 아무 동작이 일어나지 않는다", async () => {
      // Given(v2 — 질문-생성_spec.md): 업로드는 성공했지만 질문 생성 요청이 아직 응답하지
      // 않은 상태(CTA가 활성화되는 것은 생성까지 완료된 "ready" 상태부터다).
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));
      await user.click(submitButton());
      await screen.findByRole("status");
      fetchMock.mockClear();
      routerReplaceMock.mockClear();

      // When
      await user.click(screen.getByRole("button", { name: "면접 진행하기" }));

      // Then: 네비게이션도, 추가 API 호출도 발생하지 않는다
      expect(fetchMock).not.toHaveBeenCalled();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });
  });

  describe("엣지 케이스", () => {
    it("5,242,881바이트(5MB+1) 파일을 선택하면 네트워크 요청 없이 즉시 크기 초과 에러가 표시된다", async () => {
      // Given
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", FIVE_MB + 1, "application/pdf");

      // When
      await selectFile(file);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "파일 크기는 5MB를 초과할 수 없습니다.",
      );
      expect(submitButton()).toBeDisabled();
      expect(uploadResumeMock).not.toHaveBeenCalled();
    });

    it("정확히 5,242,880바이트(5MB) 파일은 경계값으로 허용되어 제출 버튼이 활성화된다", async () => {
      // Given
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", FIVE_MB, "application/pdf");

      // When
      await selectFile(file);

      // Then
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(submitButton()).not.toBeDisabled();
    });

    it("0바이트 파일을 선택하면 네트워크 요청 없이 즉시 빈 파일 에러가 표시된다", async () => {
      // Given
      render(<ResumeUploadForm />);
      const file = createFile("empty.pdf", 0, "application/pdf");

      // When
      await selectFile(file);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "빈 파일은 업로드할 수 없습니다.",
      );
      expect(submitButton()).toBeDisabled();
      expect(uploadResumeMock).not.toHaveBeenCalled();
    });

    it("확장자가 .docx인 파일을 선택하면 네트워크 요청 없이 즉시 지원하지 않는 형식 에러가 표시된다", async () => {
      // 의도: accept 속성은 권고 UI일 뿐(모든 파일 선택/드래그드롭으로 우회 가능)이라,
      // 우회해 들어온 비허용 파일을 클라 검증(validateResumeFile)이 잡는지 확인한다
      // (그래서 selectFile 헬퍼가 applyAccept:false로 accept 필터를 끈다).
      // Given
      render(<ResumeUploadForm />);
      const file = createFile(
        "resume.docx",
        1024,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );

      // When
      await selectFile(file);

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다.",
      );
      expect(submitButton()).toBeDisabled();
      expect(uploadResumeMock).not.toHaveBeenCalled();
    });

    it(".docx 파일로 에러가 표시된 후 유효한 .txt 파일을 다시 선택하면 에러가 사라지고 제출 버튼이 활성화된다", async () => {
      // Given
      render(<ResumeUploadForm />);
      const invalidFile = createFile(
        "resume.docx",
        1024,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
      const user = await selectFile(invalidFile);
      await screen.findByRole("alert");

      // When
      const validFile = createFile("resume.txt", 1024, "text/plain");
      await user.upload(fileInput(), validFile);

      // Then
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(submitButton()).not.toBeDisabled();
    });

    it("확장자는 .pdf이지만 uploadResume이 {kind:'failed', message}를 반환하면 그 message가 표시되고, 재선택 없이 제출 버튼이 다시 활성화되어 재클릭할 수 있다", async () => {
      // Given: 클라이언트는 확장자만 검사하므로 통과, 서버가 실제 내용 검증에서 거부
      uploadResumeMock.mockResolvedValue({
        kind: "failed",
        message: "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다.",
      });
      render(<ResumeUploadForm />);
      const file = createFile("corrupted.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then: 서버 에러 메시지가 그대로 표시된다
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다.",
      );
      // And: 폼은 사라지지 않는다(성공 패널 없음)
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      // And: isUploading이 false로 돌아왔다(파일 input이 다시 활성화됨)
      expect(fileInput()).not.toBeDisabled();
      // And: selectedFile이 유지된다(네이티브 input 값이 그대로 유지됨 — resetForm이 호출되지 않음)
      expect(fileInput().files?.[0]?.name).toBe("corrupted.pdf");
      // And: 서버 에러는 isClientValidationError가 아니므로 재선택 없이 제출 버튼이
      // 곧바로 재활성화되어(disabled=false) 같은 파일로 재클릭할 수 있다.
      const retryButton = screen.getByRole("button", { name: "이력서 업로드하기" });
      expect(retryButton).not.toBeDisabled();

      // And: 실제로 재클릭하면 두 번째 요청이 전송된다.
      await user.click(retryButton);
      expect(uploadResumeMock).toHaveBeenCalledTimes(2);
    });

    it("업로드 요청 중 제출 버튼을 다시 클릭(더블클릭)해도 uploadResume은 1회만 호출된다", async () => {
      // Given: uploadResume이 즉시 resolve되지 않도록 제어
      let resolveUpload: (value: unknown) => void = () => undefined;
      uploadResumeMock.mockReturnValue(
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
      );
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When: 첫 클릭 후 로딩 상태에서 다시 클릭 시도
      await user.click(submitButton());
      const loadingButton = await screen.findByRole("button", { name: "업로드 중..." });
      await user.click(loadingButton);

      // Then
      expect(uploadResumeMock).toHaveBeenCalledTimes(1);

      // cleanup
      resolveUpload({ kind: "success", source: buildSource() });
    });

    it("uploadResume이 {kind:'failed'}(예: 저장 실패)를 반환하면 message가 표시되고, 재선택 없이 같은 파일로 제출 버튼을 재클릭해 재시도할 수 있다", async () => {
      // Given
      uploadResumeMock.mockResolvedValue({
        kind: "failed",
        message: "파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
      });
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
      // And: isUploading이 false로 돌아왔다(파일 input이 다시 활성화됨)
      expect(fileInput()).not.toBeDisabled();
      expect(fileInput().files?.[0]?.name).toBe("resume.pdf");
      // And: 서버 에러이므로(isClientValidationError=false) 재선택 없이 제출 버튼이
      // 곧바로 재활성화되어 "같은 파일로 재시도 버튼(제출 버튼 재클릭)"이 가능하다.
      const retryButton = screen.getByRole("button", { name: "이력서 업로드하기" });
      expect(retryButton).not.toBeDisabled();

      // And: 재클릭하면 같은 파일로 두 번째 업로드 요청이 전송된다. 이번에는 업로드가
      // 성공하므로 곧바로 자동 질문 생성 Route Handler 호출도 트리거되지만, 이 테스트의
      // 관심사는 "두 번째 uploadResume 호출(업로드 재시도)"이므로 생성 요청은 응답하지
      // 않는 상태로 묶어둔다.
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockReturnValue(pendingForever());
      await user.click(retryButton);
      expect(uploadResumeMock).toHaveBeenCalledTimes(2);
      const secondCallFormData = uploadResumeMock.mock.calls[1][0] as FormData;
      expect((secondCallFormData.get("file") as File).name).toBe("resume.pdf");
    });
  });

  describe("에러 케이스", () => {
    it("uploadResume이 {kind:'unauthenticated', redirectTo}를 반환하면 인라인 에러 없이 즉시 그 경로로 이동한다", async () => {
      // Given
      uploadResumeMock.mockResolvedValue({
        kind: "unauthenticated",
        redirectTo: "/gate?reason=expired&next=%2F",
      });
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then
      await vi.waitFor(() =>
        expect(routerReplaceMock).toHaveBeenCalledWith("/gate?reason=expired&next=%2F"),
      );
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("uploadResume이 {kind:'failed', message:'일시적인 오류...'}로 resolve되면(액션 내부에서 네트워크 단절을 흡수한 경우) 그 메시지가 표시된다", async () => {
      // Given
      uploadResumeMock.mockResolvedValue({
        kind: "failed",
        message: "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
      });
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(fileInput()).not.toBeDisabled();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it("uploadResume(formData) 호출 자체가 reject되면(프레임워크 레벨 실패 — 예: 클라이언트 검증을 우회해 6MB를 초과하는 바디가 전송되어 Next가 액션 실행 전 요청을 거부한 경우) 호출부의 catch가 일시적 오류 메시지를 표시하고 isUploading은 false로 복귀한다", async () => {
      // Given
      uploadResumeMock.mockRejectedValue(new Error("Body exceeded 6mb limit"));
      render(<ResumeUploadForm />);
      const file = createFile("resume.pdf", 1024, "application/pdf");
      const user = await selectFile(file);

      // When
      await user.click(submitButton());

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(fileInput()).not.toBeDisabled();
      expect(routerReplaceMock).not.toHaveBeenCalled();
    });

    it("파일이 선택되지 않은 채로 폼 제출 이벤트가 강제로 발생해도 방어적 가드에 의해 uploadResume이 호출되지 않는다", () => {
      // Given: 개발자 도구 등으로 disabled 속성이 제거되었다고 가정하고, 파일 미선택 상태에서
      // 네이티브 submit 이벤트를 직접 발생시킨다(userEvent로는 disabled 버튼 클릭을 통한
      // 우회를 표현할 수 없으므로 fireEvent로 DOM 이벤트 자체를 시뮬레이션한다).
      const { container } = render(<ResumeUploadForm />);
      const form = container.querySelector("form");
      expect(form).not.toBeNull();

      // When
      fireEvent.submit(form as HTMLFormElement);

      // Then
      expect(uploadResumeMock).not.toHaveBeenCalled();
    });
  });

  /**
   * 대상 스펙: .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 —
   * ResumeUploadForm.tsx 확장" 절 + 클라이언트-데이터-계층-전환_spec.md 설계 판단 3.
   * 업로드 성공 직후 자동으로 트리거되는 질문 생성은 Route Handler
   * (`/api/questions/generate`, 상대경로)를 여전히 `global.fetch`로 호출한다.
   */
  describe("질문 생성 자동 트리거 — 정상 시나리오", () => {
    it("업로드 성공 직후 클릭 없이 자동으로 POST /api/questions/generate(상대경로)가 { sourceId: uploadedSource.id }로 1회 호출된다(credentials 옵션 없음)", async () => {
      // Given
      const source = buildSource({ id: "uploaded-source-id" });
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source });
      fetchMock.mockReturnValue(pendingForever());
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/questions/generate");
      expect(options).toMatchObject({ method: "POST" });
      expect(options.credentials).toBeUndefined();
      expect(JSON.parse(options.body as string)).toEqual({ sourceId: source.id });
    });

    it("질문 생성이 201로 성공하면 '질문이 준비됐어요 · 면접 준비를 시작할까요?' 문구로 바뀌고 '면접 진행하기' 버튼이 활성화되며, 응답의 question 필드는 화면에 사용되지 않는다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, { questions: [buildQuestion()], question: buildQuestion() }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      expect(
        await screen.findByText("질문이 준비됐어요 · 면접 준비를 시작할까요?"),
      ).toBeInTheDocument();
      const proceedButton = screen.getByRole("button", { name: "면접 진행하기" });
      expect(proceedButton).not.toBeDisabled();
      // And: question.text 등 응답 내용이 화면 어디에도 렌더링되지 않는다(무시됨)
      expect(screen.queryByText(buildQuestion().text)).not.toBeInTheDocument();
    });

    it("'면접 진행하기' 버튼이 활성화된 상태에서 클릭하면 router.push('/today')가 호출된다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, { questions: [buildQuestion()], question: buildQuestion() }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));
      await user.click(submitButton());
      await screen.findByText("질문이 준비됐어요 · 면접 준비를 시작할까요?");

      // When
      await user.click(screen.getByRole("button", { name: "면접 진행하기" }));

      // Then
      expect(routerPushMock).toHaveBeenCalledWith("/today");
    });
  });

  describe("질문 생성 자동 트리거 — 엣지 케이스", () => {
    it("질문 생성이 500 generation_failed로 실패하면 '질문 생성에 실패했어요'와 서버 message, '다시 시도' 버튼이 표시된다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, {
          error: "generation_failed",
          message: "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      expect(await screen.findByText("질문 생성에 실패했어요")).toBeInTheDocument();
      expect(
        screen.getByText("질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    });

    it("생성 실패 후 '다시 시도'를 클릭하면 동일한 sourceId로 재요청하고, 화면은 다시 '생성 중' 상태로 돌아간다", async () => {
      // Given
      const source = buildSource({ id: "retry-source-id" });
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, {
          error: "generation_failed",
          message: "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));
      await user.click(submitButton());
      await screen.findByText("질문 생성에 실패했어요");
      fetchMock.mockClear();
      fetchMock.mockReturnValue(pendingForever());

      // When
      await user.click(screen.getByRole("button", { name: "다시 시도" }));

      // Then
      expect(
        await screen.findByText("이력서 저장 완료 · 질문을 생성 중입니다"),
      ).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("/api/questions/generate");
      expect(JSON.parse(options.body as string)).toEqual({ sourceId: source.id });
    });

    it("생성 요청이 진행 중인 상태에서 '다른 파일 업로드'로 리셋하면, 이후 뒤늦게 도착한 생성 응답은 화면에 반영되지 않는다", async () => {
      // Given
      let resolveGenerate: (value: unknown) => void = () => undefined;
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveGenerate = resolve;
        }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));
      await user.click(submitButton());
      await screen.findByRole("status");
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

      // When: 생성 응답이 도착하기 전에 폼을 리셋한다
      await user.click(screen.getByRole("button", { name: "다른 파일 업로드" }));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      // 그 후 이전 생성 요청의 응답이 뒤늦게 도착한다
      resolveGenerate(jsonResponse(201, { questions: [], question: null }));
      await new Promise((resolve) => setImmediate(resolve));

      // Then: 이미 리셋되었으므로 응답은 무시되고 화면 상태가 바뀌지 않는다
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(
        screen.queryByText("질문이 준비됐어요 · 면접 준비를 시작할까요?"),
      ).not.toBeInTheDocument();
    });

    it("React StrictMode로 effect가 2회 실행되어도 POST /api/questions/generate 호출은 정확히 1회만 발생한다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockReturnValue(pendingForever());
      render(
        <StrictMode>
          <ResumeUploadForm />
        </StrictMode>,
      );
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("질문 생성 자동 트리거 — 에러 케이스", () => {
    it("질문 생성 요청 중 서버가 401을 반환하면 즉시 router.replace('/gate?reason=expired&next=%2F')로 리다이렉트된다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockResolvedValueOnce(
        jsonResponse(401, { error: "unauthorized", message: "인증이 만료되었습니다." }),
      );
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      await vi.waitFor(() =>
        expect(routerReplaceMock).toHaveBeenCalledWith("/gate?reason=expired&next=%2F"),
      );
    });

    it("질문 생성 요청 중 네트워크가 단절되면 일시적 오류 메시지와 '다시 시도' 버튼이 표시된다", async () => {
      // Given
      uploadResumeMock.mockResolvedValueOnce({ kind: "success", source: buildSource() });
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      render(<ResumeUploadForm />);
      const user = await selectFile(createFile("resume.pdf", 1024, "application/pdf"));

      // When
      await user.click(submitButton());
      await screen.findByRole("status");

      // Then
      expect(
        await screen.findByText("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요."),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
    });
  });
});
