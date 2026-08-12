# 이력서 업로드 백엔드 — 핵심 로직

- **목적**: 결함 찾기(audit)가 아니라 **이해(comprehension)** — `resume.ts`가 요청을 받아서 무엇을 하는지 지도 그리기
- **대상 파일**: `apps/api/src/routes/resume.ts`
- **관련 스펙**: `이력서-업로드_spec.md`(v4) — `resume-upload/ui.md`가 다루는 `이력서-업로드-UI_spec.md`(v1.1)와는 다른 스펙(백엔드 처리 12단계)

## 1. `POST /api/sources/resume` — 검증 → 저장 12단계

```
인증(requireAuthenticatedUser)
  → 파일 개수 정확히 1개
  → 파일 크기: 0바이트 초과 && 5MB 이하
  → 확장자 + MIME 둘 다 허용 목록과 일치(.pdf↔application/pdf, .txt↔text/plain)
  → Supabase Storage에 `{userId}/{sourceId}.ext`로 원본 업로드
  → 텍스트 추출 (pdf: pdf-parse / txt: buffer.toString("utf-8"))
  → NUL 문자 제거
  → 정제된 텍스트 50자 미만이면 실패(스캔 이미지 PDF 방어)
  → sources 테이블 insert
  → 201 { source }
```

## 2. 핵심 포인트 — Storage와 DB 사이 정합성 보정(cleanup)

Storage 업로드(7단계) **이후** 어느 단계에서든 실패하면(`텍스트 추출 실패`, `텍스트 길이 부족`, `insert 실패`) `cleanupUploadedFile()`을 호출해 방금 올린 Storage 객체를 삭제한다. DB에는 없는데 Storage에만 파일이 남는 고아 상태를 막기 위한 보정 로직.

- cleanup 자체가 실패해도 원래 에러 응답을 덮지 않고 로그만 남긴다(`console.error`) — 사용자에게는 원인이 된 에러(추출 실패 등)만 그대로 보여준다.

## 3. 확장자 + MIME "둘 다" 확인하는 이유

확장자만 보면 `.pdf`로 이름 붙인 악성/변조 파일을 걸러낼 수 없다. `ALLOWED_TYPES`에서 확장자→기대 MIME을 매핑해두고 `file.mimetype`이 그 값과 정확히 일치할 때만 통과시킨다(90–100행).

## 4. 인증 미들웨어 위치

`router.post("/", requireAuthenticatedUser, upload.array("file"), uploadResume)` — 이 라우터가 스스로 `requireAuthenticatedUser`를 체이닝하므로, `app.ts`에서 이 라우터를 마운트하는 쪽은 별도로 인증을 다시 걸 필요가 없다(`questions.ts`와 동일한 패턴).
