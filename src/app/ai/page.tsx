import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { AiWorkspace } from "@/components/ai-workspace";
import { PageHeader } from "@/components/page-patterns";
import { availableCapabilities } from "@/lib/server/ai/capabilities";
import { listMyAiJobs } from "@/lib/server/ai/service";
import { requireSession } from "@/lib/server/session";

export const metadata = { title: "AI workspace" };
export default async function AiPage() {
  const session = await requireSession().catch((error: unknown) => {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      redirect("/account");
    throw error;
  });
  return (
    <div className="page-stack">
      <PageHeader
        title="AI workspace"
        description="Run an AI task, continue a conversation, and review its credit and usage records."
      />
      <AiWorkspace
        key={session.uid}
        uid={session.uid}
        initialKey={randomUUID()}
        capabilities={availableCapabilities().filter(
          (item) => !item.name.startsWith("workspace-"),
        )}
        initialJobs={await listMyAiJobs()}
      />
    </div>
  );
}
