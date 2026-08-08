import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Storage(파일 업로드/삭제)와 DB 쿼리를 모두 이 클라이언트 하나로 통일해서 사용한다.
// service role key를 사용하므로 RLS와 무관하게 항상 접근 가능하다 — 서버(백엔드) 전용.
//
// 실제 클라이언트 생성은 최초 사용(속성 접근) 시점으로 지연시킨다(lazy). `createClient`는
// 생성 시점에 SUPABASE_URL 검증을 하므로, 이 클라이언트를 실제로 쓰지 않는 요청 경로만
// 거치는 테스트(예: app.test.ts가 이 모듈을 간접적으로 import하지만 호출하지는 않는 경우)에서
// 환경변수 미설정만으로 모듈 import 자체가 실패하는 것을 방지한다.
let cachedClient: SupabaseClient | undefined;

function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    cachedClient = createClient(supabaseUrl, supabaseServiceRoleKey);
  }
  return cachedClient;
}

export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    return Reflect.get(getSupabaseClient(), prop, receiver);
  },
});
