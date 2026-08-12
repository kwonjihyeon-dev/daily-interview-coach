/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // 이력서 업로드는 최대 5MB(5,242,880바이트)를 허용한다(ResumeUploadForm.tsx의
      // MAX_FILE_SIZE_BYTES). Server Action 기본 바디 제한은 1MB이므로, multipart
      // 바운더리/파트 헤더 오버헤드(권고 10~20KB)를 넉넉히 감안해 6MB로 올린다.
      bodySizeLimit: "6mb",
    },
  },
};

module.exports = nextConfig;
