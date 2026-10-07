import { notFound, redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { WorkspaceEditor } from "@/components/workspaces/workspace-editor";
import { PageHeader } from "@/components/page-patterns";
import { availableCapabilities } from "@/lib/server/ai/capabilities";
import { requireSession } from "@/lib/server/session";
import { myWorkspace } from "@/lib/server/workspaces/service";
import { workspaceId } from "@/lib/contracts/workspace";
export const metadata = { title: "Creation workspace" };
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireSession().catch((error: unknown) => {
    if (
      error instanceof AppError &&
      ["UNAUTHENTICATED", "EMAIL_UNVERIFIED"].includes(error.code)
    )
      redirect("/account");
    throw error;
  });
  const { id } = await params;
  if (!workspaceId.safeParse(id).success) notFound();
  const workspace = await myWorkspace(id).catch((error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <div className="page-stack">
      <PageHeader
        title={workspace.title}
        description="Your decisions, artifacts and execution history are saved here."
      />
      <WorkspaceEditor
        key={actor.uid + id}
        uid={actor.uid}
        initial={workspace}
        capabilities={availableCapabilities().filter((c) =>
          c.name.startsWith("workspace-"),
        )}
      />
    </div>
  );
}
