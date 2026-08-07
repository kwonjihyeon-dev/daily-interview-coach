import { randomUUID } from "crypto";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import type { Source } from "@daily-interview-coach/shared-types";
import { supabase } from "../lib/supabaseClient";
import { requireAuthenticatedUser } from "../middleware/requireAuthenticatedUser";

/**
 * 대상 스펙: .claude/artifacts/spec/이력서-업로드_spec.md (v4)
 * POST /api/sources/resume — 처리 순서 12단계를 그대로 구현.
 *
 * 인증 미들웨어(requireAuthenticatedUser)는 이 라우터 자신이 POST 핸들러 체인의
 * 맨 앞에서 직접 사용한다 — 이 라우터를 마운트하는 쪽(app.ts)은 별도로 인증
 * 미들웨어를 다시 체이닝할 필요가 없다.
 */

const RESUMES_BUCKET = "resumes";
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const MIN_TEXT_LENGTH = 50;

const ALLOWED_TYPES: Record<string, { mime: string; ext: string }> = {
  ".pdf": { mime: "application/pdf", ext: "pdf" },
  ".txt": { mime: "text/plain", ext: "txt" },
};

const upload = multer({ storage: multer.memoryStorage() });

const router: ReturnType<typeof Router> = Router();

function sendError(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message });
}

function extensionOf(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

/** DB(UTC ISO 8601) → KST(+09:00) ISO 8601 문자열 변환 */
function toKstIso(utcIso: string): string {
  const utcDate = new Date(utcIso);
  const kstDate = new Date(utcDate.getTime() + 9 * 60 * 60 * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  const yyyy = kstDate.getUTCFullYear();
  const mm = pad(kstDate.getUTCMonth() + 1);
  const dd = pad(kstDate.getUTCDate());
  const hh = pad(kstDate.getUTCHours());
  const min = pad(kstDate.getUTCMinutes());
  const ss = pad(kstDate.getUTCSeconds());

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+09:00`;
}

async function handleResumeUpload(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      // 인증 미들웨어가 이 라우트 앞단에서 반드시 req.user를 설정한다고 가정한다.
      sendError(res, 401, "unauthorized", "인증되지 않은 요청입니다.");
      return;
    }

    // 2. file 필드에 파일이 정확히 1개
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      sendError(res, 400, "no_file", "업로드할 파일이 없습니다.");
      return;
    }
    if (files.length > 1) {
      sendError(res, 400, "too_many_files", "파일은 한 번에 1개만 업로드할 수 있습니다.");
      return;
    }
    const file = files[0];

    // 3. 파일 크기 0바이트 초과
    if (file.size === 0) {
      sendError(res, 400, "empty_file", "빈 파일은 업로드할 수 없습니다.");
      return;
    }

    // 4. 파일 크기 ≤ 5MB
    if (file.size > MAX_FILE_SIZE_BYTES) {
      sendError(res, 400, "file_too_large", "파일 크기는 5MB를 초과할 수 없습니다.");
      return;
    }

    // 5. 확장자·MIME 타입 허용 목록 확인 (둘 다 일치해야 함)
    const ext = extensionOf(file.originalname);
    const allowedType = ALLOWED_TYPES[ext];
    if (!allowedType || allowedType.mime !== file.mimetype) {
      sendError(
        res,
        400,
        "unsupported_file_type",
        "PDF(.pdf) 또는 텍스트(.txt) 파일만 업로드할 수 있습니다.",
      );
      return;
    }

    // 6. sourceId 생성
    const sourceId = randomUUID();
    const storagePath = `${user.id}/${sourceId}.${allowedType.ext}`;

    // 7. Supabase Storage에 파일 업로드
    const { error: uploadError } = await supabase.storage
      .from(RESUMES_BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype });

    if (uploadError) {
      sendError(
        res,
        500,
        "storage_upload_failed",
        "파일 저장에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
      return;
    }

    // 7단계 이후 실패 시 업로드된 Storage 객체를 정리(cleanup)한다.
    // 삭제 시도 자체의 실패는 서버 로그에만 남기고 원래 에러 응답을 덮지 않는다.
    const cleanupUploadedFile = async (): Promise<void> => {
      try {
        await supabase.storage.from(RESUMES_BUCKET).remove([storagePath]);
      } catch (cleanupError) {
        console.error("[resume] Storage cleanup 실패:", storagePath, cleanupError);
      }
    };

    // 8. 텍스트 추출
    let extractedText: string;
    try {
      if (allowedType.ext === "pdf") {
        const parsed = await pdfParse(file.buffer);
        extractedText = parsed.text;
      } else {
        extractedText = file.buffer.toString("utf-8");
      }
    } catch (extractionError) {
      console.error("[resume] 텍스트 추출 실패:", extractionError);
      await cleanupUploadedFile();
      sendError(
        res,
        400,
        "extraction_failed",
        "파일에서 텍스트를 추출할 수 없습니다. 파일이 손상되었을 수 있습니다.",
      );
      return;
    }

    // 9. NUL 문자 제거
    const sanitizedText = extractedText.replace(new RegExp(String.fromCharCode(0), "g"), "");

    // 10. 정제된 텍스트 길이 검증
    if (sanitizedText.trim().length < MIN_TEXT_LENGTH) {
      await cleanupUploadedFile();
      sendError(
        res,
        400,
        "text_too_short",
        "추출된 텍스트가 너무 짧습니다. 스캔 이미지로 만든 PDF인지 확인해주세요.",
      );
      return;
    }

    const sourceUrl = `${RESUMES_BUCKET}/${storagePath}`;

    // 11. sources 테이블에 insert
    const { data, error: insertError } = await supabase
      .from("sources")
      .insert({
        id: sourceId,
        user_id: user.id,
        type: "resume",
        raw_text: sanitizedText,
        source_url: sourceUrl,
      })
      .select()
      .single();

    if (insertError || !data) {
      console.error("[resume] sources insert 실패:", insertError);
      await cleanupUploadedFile();
      sendError(
        res,
        500,
        "internal_error",
        "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.",
      );
      return;
    }

    // 12. 성공 응답
    const source: Source = {
      id: data.id as string,
      userId: data.user_id as string,
      type: data.type as Source["type"],
      rawText: data.raw_text as string,
      sourceUrl: data.source_url as string,
      createdAt: toKstIso(data.created_at as string),
    };

    res.status(201).json({ source });
  } catch (err) {
    console.error("[resume] 처리 중 예상치 못한 오류:", err);
    sendError(res, 500, "internal_error", "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
  }
}

router.post("/", requireAuthenticatedUser, upload.array("file"), handleResumeUpload);

export default router;
