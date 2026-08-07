import { createClient } from "@supabase/supabase-js";

// Storage(파일 업로드/삭제)와 DB 쿼리를 모두 이 클라이언트 하나로 통일해서 사용한다.
// service role key를 사용하므로 RLS와 무관하게 항상 접근 가능하다 — 서버(백엔드) 전용.
const supabaseUrl = process.env.SUPABASE_URL ?? "";
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
