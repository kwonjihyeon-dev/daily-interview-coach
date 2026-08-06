import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";
import resumeRouter from "./resume";

/**
 * 대상 스펙: .claude/artifacts/spec/이력서-업로드_spec.md (v4)
 *
 * ## 인증 미들웨어에 대한 테스트 범위 결정
 * `x-user-email` 헤더 → `users` 테이블 DB 조회 → `req.user` 설정 로직은 "이메일 기반
 * 방문자 게이트"라는 별도 기능(아직 스펙 미작성)의 책임이다. 이 테스트 파일은 그 미들웨어
 * 자체(`../middleware/requireAuthenticatedUser`)를 완전히 모킹해서, 이력서 업로드
 * 라우트 로직(파일 검증 → Storage 업로드 → 텍스트 추출 → DB 저장)만 독립적으로 검증한다.
 * "인증 실패 시 401을 반환하고 이후 로직이 전혀 실행되지 않는다"는 계약만 이 파일에서
 * 검증하며, DB 조회 세부 동작(이메일 존재/미존재 판별 등)은 그 기능의 자체 테스트에서
 * 다뤄질 것을 전제한다.
 */

type MockedUser = { id: string; email: string };

const TEST_USER: MockedUser = {
  id: "1a2b3c4d-1111-4111-8111-111111111111",
  email: "visitor@example.com",
};

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

// ---------------------------------------------------------------------------
// 인증 미들웨어 모킹
// ---------------------------------------------------------------------------
const authMock = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
}));
vi.mock("../middleware/requireAuthenticatedUser", () => authMock);

// ---------------------------------------------------------------------------
// Supabase 클라이언트 모킹 (Storage + DB)
// ---------------------------------------------------------------------------
const supabaseMock = vi.hoisted(() => {
  const upload = vi.fn();
  const remove = vi.fn();
  const storageFrom = vi.fn(() => ({ upload, remove }));

  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn((_row: Record<string, unknown>) => ({ select }));
  const from = vi.fn(() => ({ insert }));

  return { upload, remove, storageFrom, single, select, insert, from };
});
vi.mock("../lib/supabaseClient", () => ({
  supabase: {
    storage: { from: supabaseMock.storageFrom },
    from: supabaseMock.from,
  },
}));

// ---------------------------------------------------------------------------
// pdf-parse 모킹
// ---------------------------------------------------------------------------
const pdfParseMock = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("pdf-parse", () => ({ default: pdfParseMock.parse }));

function buildApp() {
  const app = express();
  app.use("/api/sources/resume", resumeRouter);
  return app;
}

function textOfLength(length: number): string {
  return "가".repeat(length);
}

/** insert()에 마지막으로 전달된 row 객체 (snake_case) */
function lastInsertedRow(): Record<string, unknown> | undefined {
  const calls = supabaseMock.insert.mock.calls;
  return calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
}

/** upload()에 전달된 path(버킷 상대 경로) 목록 */
function uploadedPaths(): string[] {
  return supabaseMock.upload.mock.calls.map((call) => call[0] as string);
}

const CREATED_AT_UTC = "2026-08-06T00:12:00+00:00";
const CREATED_AT_KST = "2026-08-06T09:12:00+09:00";

beforeEach(() => {
  vi.clearAllMocks();

  // 기본: 인증 통과, req.user 설정
  authMock.requireAuthenticatedUser.mockImplementation(
    (req: Request & { user?: MockedUser }, _res: Response, next: NextFunction) => {
      req.user = TEST_USER;
      next();
    },
  );

  // 기본: Storage 업로드/삭제 성공
  supabaseMock.upload.mockResolvedValue({ data: { path: "ok" }, error: null });
  supabaseMock.remove.mockResolvedValue({ data: [{}], error: null });

  // 기본: pdf-parse는 충분히 긴 텍스트를 반환
  pdfParseMock.parse.mockResolvedValue({ text: textOfLength(200) });

  // 기본: DB insert는 방금 insert 호출에 전달된 row를 그대로 "저장된 행"처럼 되돌려준다
  // (id는 라우트가 crypto.randomUUID()로 미리 생성해 insert payload에 포함시킨 값을 그대로 사용)
  supabaseMock.single.mockImplementation(async () => ({
    data: { ...lastInsertedRow(), created_at: CREATED_AT_UTC },
    error: null,
  }));
});

describe("POST /api/sources/resume", () => {
  describe("정상 시나리오", () => {
    it("정상적인 텍스트 기반 PDF(추출 텍스트 200자)를 업로드하면 201과 함께 저장된 source를 반환한다", async () => {
      // Given: 유효한 인증, 추출 텍스트 200자짜리 PDF
      const app = buildApp();
      const pdfText = textOfLength(200);
      pdfParseMock.parse.mockResolvedValueOnce({ text: pdfText });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake pdf bytes"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.source.type).toBe("resume");
      expect(res.body.source.rawText).toBe(pdfText);
      expect(res.body.source.userId).toBe(TEST_USER.id);
      expect(res.body.source.id).toMatch(new RegExp(`^${UUID_PATTERN}$`));
      expect(res.body.source.sourceUrl).toBe(
        `resumes/${TEST_USER.id}/${res.body.source.id}.pdf`,
      );
      // And: createdAt은 KST(+09:00) ISO 8601 문자열이다 (DB는 UTC로 저장/반환한다고 가정)
      expect(res.body.source.createdAt).toBe(CREATED_AT_KST);

      // And: Supabase Storage의 resumes 버킷, 해당 경로로 실제 업로드가 호출된다
      expect(supabaseMock.storageFrom).toHaveBeenCalledWith("resumes");
      expect(supabaseMock.upload).toHaveBeenCalledTimes(1);
      expect(uploadedPaths()[0]).toBe(`${TEST_USER.id}/${res.body.source.id}.pdf`);

      // And: sources 테이블에 해당 row가 실제로 추가된다
      expect(supabaseMock.from).toHaveBeenCalledWith("sources");
      expect(lastInsertedRow()).toMatchObject({
        id: res.body.source.id,
        user_id: TEST_USER.id,
        type: "resume",
        raw_text: pdfText,
        source_url: res.body.source.sourceUrl,
      });
    });

    it("UTF-8 .txt 파일(내용 100자)을 업로드하면 201과 함께 파일 내용이 그대로 rawText로 저장된다", async () => {
      // Given: 유효한 인증, 100자 텍스트 파일
      const app = buildApp();
      const txtContent = "a".repeat(100);

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from(txtContent, "utf-8"), {
          filename: "resume.txt",
          contentType: "text/plain",
        });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.source.rawText).toBe(txtContent);
      expect(res.body.source.sourceUrl).toBe(
        `resumes/${TEST_USER.id}/${res.body.source.id}.txt`,
      );
      // .txt는 pdf-parse를 거치지 않는다
      expect(pdfParseMock.parse).not.toHaveBeenCalled();
    });

    it("이미 이력서가 있는 사용자가 새 이력서를 업로드하면 기존 row/파일을 건드리지 않고 새 row/파일이 추가된다", async () => {
      // Given: 동일 사용자로 이력서를 두 번 업로드한다
      const app = buildApp();
      const attachPdf = (r: request.Test) =>
        r
          .set("x-user-email", TEST_USER.email)
          .attach("file", Buffer.from("%PDF-1.4 fake"), {
            filename: "resume.pdf",
            contentType: "application/pdf",
          });

      // When
      const first = await attachPdf(request(app).post("/api/sources/resume"));
      const second = await attachPdf(request(app).post("/api/sources/resume"));

      // Then: 두 요청 모두 201, 서로 다른 source가 생성된다
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(first.body.source.id).not.toBe(second.body.source.id);
      expect(first.body.source.sourceUrl).not.toBe(second.body.source.sourceUrl);

      // And: 해당 유저의 resume source 개수가 2개(insert 2회 호출)가 된다
      expect(supabaseMock.insert).toHaveBeenCalledTimes(2);
      expect(supabaseMock.upload).toHaveBeenCalledTimes(2);

      // And: 기존 source/파일은 삭제되거나 변경되지 않는다
      expect(supabaseMock.remove).not.toHaveBeenCalled();
    });

    it("정확히 5,242,880바이트(5MB) 크기의 PDF는 그대로 Storage에 업로드된다", async () => {
      // Given: 정확히 5MB 크기의 유효한 PDF 파일
      const app = buildApp();
      const fiveMb = Buffer.alloc(5 * 1024 * 1024, "a");

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", fiveMb, { filename: "resume.pdf", contentType: "application/pdf" });

      // Then
      expect(res.status).toBe(201);
      const uploadedBuffer = supabaseMock.upload.mock.calls[0][1] as Buffer;
      expect(Buffer.isBuffer(uploadedBuffer)).toBe(true);
      expect(uploadedBuffer.length).toBe(5 * 1024 * 1024);
    });
  });

  describe("엣지 케이스", () => {
    it("스캔 이미지 PDF처럼 추출 텍스트가 30자(trim 후)이면 text_too_short를 반환하고 업로드된 파일을 정리한다", async () => {
      // Given: 텍스트 추출 결과가 30자인 PDF
      const app = buildApp();
      pdfParseMock.parse.mockResolvedValueOnce({ text: textOfLength(30) });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "scan.pdf",
          contentType: "application/pdf",
        });

      // Then: Storage 업로드는 먼저 성공했었지만 이후 400 text_too_short
      expect(supabaseMock.upload).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("text_too_short");

      // And: 업로드했던 파일을 삭제 시도한다
      expect(supabaseMock.remove).toHaveBeenCalledWith([uploadedPaths()[0]]);

      // And: sources 테이블에 어떤 row도 추가되지 않는다
      expect(supabaseMock.insert).not.toHaveBeenCalled();
    });

    it("추출 텍스트가 정확히 50자(trim 후, 경계값)이면 201로 성공 처리된다", async () => {
      // Given
      const app = buildApp();
      pdfParseMock.parse.mockResolvedValueOnce({ text: textOfLength(50) });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.source.rawText).toBe(textOfLength(50));
      // 성공 케이스이므로 정리(cleanup)가 일어나지 않는다
      expect(supabaseMock.remove).not.toHaveBeenCalled();
    });

    it("추출 텍스트가 49자(trim 후)이면 text_too_short를 반환하고 업로드된 파일을 정리한다", async () => {
      // Given
      const app = buildApp();
      pdfParseMock.parse.mockResolvedValueOnce({ text: textOfLength(49) });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("text_too_short");
      expect(supabaseMock.remove).toHaveBeenCalledWith([uploadedPaths()[0]]);
    });

    it("5,242,881바이트(5MB+1바이트) 파일은 file_too_large를 반환하고 Storage 업로드를 시도하지 않는다", async () => {
      // Given
      const app = buildApp();
      const overLimit = Buffer.alloc(5 * 1024 * 1024 + 1, "a");

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", overLimit, { filename: "resume.pdf", contentType: "application/pdf" });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("file_too_large");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("0바이트 파일은 empty_file을 반환하고 Storage 업로드를 시도하지 않는다", async () => {
      // Given
      const app = buildApp();

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.alloc(0), {
          filename: "empty.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("empty_file");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("file 필드 없이 multipart 요청을 보내면 no_file을 반환한다", async () => {
      // Given / When: file 필드는 없고 다른 필드만 있는 multipart 요청
      const app = buildApp();
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .field("note", "파일을 첨부하지 않음");

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("no_file");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("file 필드에 파일 2개를 첨부하면 too_many_files를 반환한다", async () => {
      // Given / When
      const app = buildApp();
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("a"), { filename: "a.pdf", contentType: "application/pdf" })
        .attach("file", Buffer.from("b"), { filename: "b.pdf", contentType: "application/pdf" });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("too_many_files");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("확장자가 .docx인 파일은 unsupported_file_type을 반환하고 Storage 업로드를 시도하지 않는다", async () => {
      // Given / When
      const app = buildApp();
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("fake docx bytes"), {
          filename: "resume.docx",
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unsupported_file_type");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("확장자는 .pdf이지만 MIME 타입이 image/png이면 unsupported_file_type을 반환한다", async () => {
      // Given / When: 확장자와 MIME이 모두 허용 목록과 일치해야 하므로, 하나만 맞아도 거부
      const app = buildApp();
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("fake png bytes"), {
          filename: "resume.pdf",
          contentType: "image/png",
        });

      // Then
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("unsupported_file_type");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
    });

    it("확장자·MIME이 .pdf/application/pdf로 정상이지만 손상된 PDF라 추출이 예외를 던지면 extraction_failed를 반환하고 파일을 정리한다", async () => {
      // Given: pdf-parse가 예외를 던지는 손상된 PDF
      const app = buildApp();
      pdfParseMock.parse.mockRejectedValueOnce(new Error("Invalid PDF structure"));

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("corrupted"), {
          filename: "broken.pdf",
          contentType: "application/pdf",
        });

      // Then: Storage 업로드는 먼저 성공한다
      expect(supabaseMock.upload).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("extraction_failed");

      // And: 업로드했던 파일을 삭제 시도한다
      expect(supabaseMock.remove).toHaveBeenCalledWith([uploadedPaths()[0]]);

      // And: sources 테이블에 어떤 row도 추가되지 않는다
      expect(supabaseMock.insert).not.toHaveBeenCalled();
    });

    it("추출된 텍스트에 NUL 문자가 포함되어도 제거된 텍스트로 저장되고 DB insert가 에러 없이 성공한다", async () => {
      // Given: NUL 제거 후 남은 텍스트 길이가 80자인 PDF
      const app = buildApp();
      const withNul = `${textOfLength(40)}${"\u0000".repeat(5)}${textOfLength(40)}`;
      pdfParseMock.parse.mockResolvedValueOnce({ text: withNul });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(201);
      expect(res.body.source.rawText).not.toContain("\u0000");
      expect(res.body.source.rawText).toBe(textOfLength(40) + textOfLength(40));

      // And: DB insert에 전달된 raw_text에도 NUL 문자가 없다 ("invalid byte sequence" 유발 방지)
      const insertedRow = lastInsertedRow();
      expect(String(insertedRow?.raw_text)).not.toContain("\u0000");

      // And: Storage에는 원본 파일이 그대로 보관된다 (성공 케이스이므로 cleanup 없음)
      expect(supabaseMock.remove).not.toHaveBeenCalled();
    });

    it("Storage 업로드는 성공했으나 DB insert가 실패하면 internal_error를 반환하고 업로드된 파일을 정리한다", async () => {
      // Given: DB insert가 커넥션 오류로 실패
      const app = buildApp();
      supabaseMock.single.mockResolvedValueOnce({
        data: null,
        error: { message: "connection refused", code: "57P03" },
      });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");

      // And: 업로드된 파일을 삭제 시도한다
      expect(supabaseMock.remove).toHaveBeenCalledWith([uploadedPaths()[0]]);
    });

    it("Storage 삭제(cleanup) 자체가 실패해도 원래 에러 응답은 그대로 반환되고, 실패 사실은 응답 본문에 노출되지 않는다", async () => {
      // Given: 텍스트 추출은 실패하고, 그 뒤 cleanup(삭제) 호출도 실패한다
      const app = buildApp();
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      pdfParseMock.parse.mockRejectedValueOnce(new Error("Invalid PDF structure"));
      supabaseMock.remove.mockRejectedValueOnce(new Error("network error while deleting"));

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("corrupted"), {
          filename: "broken.pdf",
          contentType: "application/pdf",
        });

      // Then: 클라이언트는 여전히 400 extraction_failed를 받는다 (cleanup 실패가 원래 에러를 덮지 않음)
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("extraction_failed");
      expect(JSON.stringify(res.body)).not.toContain("network error while deleting");

      // And: cleanup 실패 사실은 서버 로그에만 기록된다
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("에러 케이스", () => {
    it("x-user-email 헤더 없이 요청하면 401 unauthorized를 받고 이후 로직(파일 검증, Storage 업로드 등)이 전혀 실행되지 않는다", async () => {
      // Given: 인증 미들웨어가 (헤더 부재로) 인증을 거부하도록 스텁
      const app = buildApp();
      authMock.requireAuthenticatedUser.mockImplementation((_req: Request, res: Response) => {
        res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      });

      // When: x-user-email 헤더 없이, 유효한 파일과 함께 요청
      const res = await request(app)
        .post("/api/sources/resume")
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("unauthorized");

      // And: req.user가 없으므로 이후 단계가 전혀 실행되지 않는다
      expect(supabaseMock.upload).not.toHaveBeenCalled();
      expect(supabaseMock.insert).not.toHaveBeenCalled();
    });

    it("x-user-email 헤더 값이 users 테이블에 없는 이메일이면 401 unauthorized를 받는다", async () => {
      // Given: 인증 미들웨어가 (이메일 미존재로) 인증을 거부하도록 스텁
      // 주: "users 테이블 SELECT 조회가 실제로 수행되는지"에 대한 세부 검증은 이 미들웨어를
      // 구현하는 별도 인증 기능 스펙의 테스트에서 다룬다. 여기서는 라우트가 미들웨어의
      // 401 응답을 그대로 전달하고 하위 로직을 실행하지 않는지만 검증한다.
      const app = buildApp();
      authMock.requireAuthenticatedUser.mockImplementation((_req: Request, res: Response) => {
        res.status(401).json({ error: "unauthorized", message: "인증되지 않은 요청입니다." });
      });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", "unknown@example.com")
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("unauthorized");
      expect(supabaseMock.upload).not.toHaveBeenCalled();
      expect(supabaseMock.insert).not.toHaveBeenCalled();
    });

    it("사전 검증을 모두 통과했지만 Storage 업로드 자체가 실패하면 storage_upload_failed를 반환하고 sources 테이블에 아무 row도 추가되지 않는다", async () => {
      // Given: Storage 업로드가 네트워크 오류 등으로 실패
      const app = buildApp();
      supabaseMock.upload.mockResolvedValueOnce({
        data: null,
        error: { message: "bucket not found" },
      });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("storage_upload_failed");
      expect(supabaseMock.insert).not.toHaveBeenCalled();
      // 업로드 자체가 실패했으므로 정리(cleanup) 대상 파일이 없다
      expect(supabaseMock.remove).not.toHaveBeenCalled();
    });

    it("DB insert가 커넥션 오류로 실패하면 internal_error를 반환하고 응답 본문에 Supabase 에러 상세가 노출되지 않는다", async () => {
      // Given
      const app = buildApp();
      supabaseMock.single.mockResolvedValueOnce({
        data: null,
        error: {
          message: "connection refused",
          code: "57P03",
          details: "internal supabase detail",
          hint: "internal supabase hint",
        },
      });

      // When
      const res = await request(app)
        .post("/api/sources/resume")
        .set("x-user-email", TEST_USER.email)
        .attach("file", Buffer.from("%PDF-1.4 fake"), {
          filename: "resume.pdf",
          contentType: "application/pdf",
        });

      // Then
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("internal_error");

      // And: 응답 body는 { error, message }만 노출한다 (스택트레이스/SQL/내부 상세 없음)
      expect(Object.keys(res.body).sort()).toEqual(["error", "message"]);
      expect(JSON.stringify(res.body)).not.toContain("connection refused");
      expect(JSON.stringify(res.body)).not.toContain("57P03");
      expect(JSON.stringify(res.body)).not.toContain("internal supabase");
    });
  });
});
