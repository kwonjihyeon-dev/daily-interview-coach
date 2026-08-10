import { ResumeUploadForm } from "./ResumeUploadForm";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-4 py-16">
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        매일 면접 코치
      </h1>
      <ResumeUploadForm />
    </main>
  );
}
