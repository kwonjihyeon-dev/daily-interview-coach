"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Source } from "@daily-interview-coach/shared-types";
import styles from "./ResumeUploadForm.module.scss";

/**
 * 대상 스펙: .claude/artifacts/spec/이력서-업로드-UI_spec.md (v1.1, Approved),
 * .claude/artifacts/spec/질문-생성_spec.md (v2) "프론트엔드 — ResumeUploadForm.tsx 확장" 절.
 *
 * 아키텍처는 GateForm.tsx와 동일: 브라우저가 apps/api를
 * `${NEXT_PUBLIC_API_BASE_URL}/api/sources/resume`로 credentials:"include" 직접 호출한다.
 *
 * 제출 버튼 활성화 조건(v1.1): disabled = !selectedFile || isUploading || isClientValidationError.
 * `errorSource`는 errorMessage(표시용 문자열)와 별개로 에러의 출처(client/server)를
 * 구분하기 위한 상태다 — 서버 에러 이후에는 재선택 없이 곧바로 재시도할 수 있어야 하므로
 * "client" 사전 검증 실패일 때만 제출 버튼을 잠근다.
 *
 * 업로드 성공(201) 직후 자동으로 POST /api/questions/generate를 트리거한다
 * (`questionGenerationStatus`). `uploadedSourceRef`는 응답 도착 시점의 "현재" uploadedSource를
 * 참조하기 위한 stale-response 가드용 ref이고, `generationRequestedSourceIdRef`는 동일
 * sourceId에 대해 자동 트리거가 중복 발생(StrictMode 등)하지 않도록 막는 가드다.
 */

const MAX_FILE_SIZE_BYTES = 5_242_880; // 5MB
const ALLOWED_EXTENSION_PATTERN = /\.(pdf|txt)$/i;

type ErrorSource = "client" | "server" | null;
type QuestionGenerationStatus = "idle" | "generating" | "ready" | "error";

function validateResumeFile(file: File): string | null {
  if (file.size === 0) {
    return "빈 파일은 업로드할 수 없습니다.";
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return "파일 크기는 5MB를 초과할 수 없습니다.";
  }
  if (!ALLOWED_EXTENSION_PATTERN.test(file.name)) {
    return "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다.";
  }
  return null;
}

function buildResumePreview(rawText: string): string {
  return rawText.length > 100 ? `${rawText.slice(0, 100)}...` : rawText;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

export function ResumeUploadForm() {
  const router = useRouter();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorSource, setErrorSource] = useState<ErrorSource>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedSource, setUploadedSource] = useState<Source | null>(null);
  const [questionGenerationStatus, setQuestionGenerationStatus] =
    useState<QuestionGenerationStatus>("idle");
  const [generationErrorMessage, setGenerationErrorMessage] = useState<string | null>(null);

  const isClientValidationError = errorSource === "client";
  const isSubmitDisabled = !selectedFile || isUploading || isClientValidationError;

  // stale-response 가드: 응답 도착 시점의 "현재" uploadedSource를 참조하기 위한 ref.
  // React 19부터 렌더링 중 ref 대입이 금지되어(concurrent 렌더링에서 안전하지 않음) useEffect로 동기화한다.
  const uploadedSourceRef = useRef<Source | null>(uploadedSource);
  useEffect(() => {
    uploadedSourceRef.current = uploadedSource;
  }, [uploadedSource]);

  // 동일 sourceId에 대한 자동 생성 트리거 중복 호출 가드(React StrictMode 등).
  const generationRequestedSourceIdRef = useRef<string | null>(null);

  async function generateQuestions(sourceId: string): Promise<void> {
    setQuestionGenerationStatus("generating");
    setGenerationErrorMessage(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/questions/generate`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId }),
        },
      );

      if (uploadedSourceRef.current?.id !== sourceId) return;

      if (response.status === 401) {
        router.replace("/gate?reason=expired&next=%2F");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        setQuestionGenerationStatus("error");
        setGenerationErrorMessage(
          body.message ?? "질문 생성에 실패했습니다. 잠시 후 다시 시도해주세요.",
        );
        return;
      }

      setQuestionGenerationStatus("ready");
    } catch {
      if (uploadedSourceRef.current?.id !== sourceId) return;
      setQuestionGenerationStatus("error");
      setGenerationErrorMessage("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    }
  }

  useEffect(() => {
    if (!uploadedSource) return;
    if (generationRequestedSourceIdRef.current === uploadedSource.id) return;
    generationRequestedSourceIdRef.current = uploadedSource.id;
    void generateQuestions(uploadedSource.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadedSource]);

  function selectFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);

    if (!file) {
      setErrorMessage(null);
      setErrorSource(null);
      return;
    }

    const validationError = validateResumeFile(file);
    setErrorMessage(validationError);
    setErrorSource(validationError ? "client" : null);
  }

  async function uploadResume(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedFile || isUploading || isClientValidationError) return;

    setIsUploading(true);
    setErrorMessage(null);
    setErrorSource(null);

    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE_URL}/api/sources/resume`,
        { method: "POST", credentials: "include", body: formData },
      );

      if (response.status === 401) {
        router.replace("/gate?reason=expired&next=%2F");
        return;
      }

      const body = await response.json();

      if (!response.ok) {
        setErrorMessage(body.message ?? "오류가 발생했습니다.");
        setErrorSource("server");
        setIsUploading(false);
        return;
      }

      setUploadedSource(body.source);
      setIsUploading(false);
    } catch {
      // 네트워크 단절, apps/api 무응답, CORS 차단, JSON 파싱 실패를 모두 동일하게 처리한다.
      setErrorMessage("일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setErrorSource("server");
      setIsUploading(false);
    }
  }

  function resetForm(): void {
    setSelectedFile(null);
    setErrorMessage(null);
    setErrorSource(null);
    setUploadedSource(null);
    setQuestionGenerationStatus("idle");
    setGenerationErrorMessage(null);
    generationRequestedSourceIdRef.current = null;
  }

  function proceedToToday(): void {
    if (questionGenerationStatus !== "ready") return;
    router.push("/today");
  }

  if (uploadedSource) {
    return (
      <div className={`${styles.card} relative w-full max-w-md p-8 sm:p-10`}>
        <span aria-hidden className={styles.cornerFold} />
        <div role="status" className={`${styles.ticket} space-y-5`}>
          <div className="space-y-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium tracking-[0.2em] text-moss">
              <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-moss" />
              접수 완료 · INTAKE
            </p>
            <p className="font-display text-lg font-semibold leading-snug">
              이력서가 업로드되었습니다.
            </p>
          </div>

          <p className="rounded-sm bg-stone/60 p-4 font-mono text-sm leading-relaxed text-ink/80">
            {buildResumePreview(uploadedSource.rawText)}
          </p>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs text-mute">
            <dt className="uppercase tracking-wide">ID</dt>
            <dd className="truncate text-ink/70">{uploadedSource.id}</dd>
            <dt className="uppercase tracking-wide">시각</dt>
            <dd className="text-ink/70">{uploadedSource.createdAt}</dd>
          </dl>

          <div className={`${styles.perforation} mx-2`} />

          <div className="flex items-center justify-between gap-4 pt-1">
            <div className="space-y-1.5">
              <button
                type="button"
                disabled={questionGenerationStatus !== "ready"}
                aria-disabled={questionGenerationStatus !== "ready"}
                onClick={proceedToToday}
                className="rounded-sm bg-ink/10 px-4 py-2 text-sm font-medium text-mute disabled:cursor-not-allowed"
              >
                면접 진행하기
              </button>
              {questionGenerationStatus === "generating" && (
                <p className="text-xs text-mute">이력서 저장 완료 · 질문을 생성 중입니다</p>
              )}
              {questionGenerationStatus === "ready" && (
                <p className="text-xs text-mute">질문이 준비됐어요 · 면접 준비를 시작할까요?</p>
              )}
              {questionGenerationStatus === "error" && (
                <>
                  <p className="text-xs text-clay">질문 생성에 실패했어요</p>
                  {generationErrorMessage && (
                    <p className="text-xs text-clay">{generationErrorMessage}</p>
                  )}
                  <button
                    type="button"
                    onClick={() => void generateQuestions(uploadedSource.id)}
                    className="text-xs font-medium text-indigo underline-offset-4 hover:underline focus-visible:underline"
                  >
                    다시 시도
                  </button>
                </>
              )}
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="text-sm font-medium text-indigo underline-offset-4 hover:underline focus-visible:underline"
            >
              다른 파일 업로드
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.card} relative w-full max-w-md p-8 sm:p-10`}>
      <span aria-hidden className={styles.cornerFold} />
      <form onSubmit={uploadResume} noValidate className="space-y-6">
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-[0.2em] text-mute">0일차 · 접수</p>
          <h2 className="font-display text-xl font-semibold leading-snug">
            이력서를 업로드하세요
          </h2>
          <p className="text-sm leading-relaxed text-mute">
            오늘의 코치가 당신을 알아볼 수 있도록 PDF 또는 텍스트 파일을 전달해주세요.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="resume-file" className="block text-sm font-medium text-ink">
            이력서 파일
          </label>
          <input
            id="resume-file"
            type="file"
            accept=".pdf,.txt,application/pdf,text/plain"
            onChange={selectFile}
            disabled={isUploading}
            className="block w-full text-sm text-mute file:mr-4 file:rounded-sm file:border-0 file:bg-indigo file:px-4 file:py-2 file:text-sm file:font-medium file:text-paper file:transition-opacity hover:file:opacity-90 disabled:opacity-60"
          />
          {selectedFile && !isClientValidationError && (
            <p className="font-mono text-xs text-mute">
              {selectedFile.name} · {formatFileSize(selectedFile.size)}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitDisabled}
          className="w-full rounded-sm bg-indigo px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:enabled:bg-ink disabled:cursor-not-allowed disabled:bg-ink/20 disabled:text-mute"
        >
          {isUploading ? "업로드 중..." : "이력서 업로드하기"}
        </button>

        {errorMessage && (
          <p role="alert" className="rounded-sm bg-clay-dim px-3 py-2 text-sm text-clay">
            {errorMessage}
          </p>
        )}
      </form>
    </div>
  );
}
