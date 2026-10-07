import { redirect } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
import { WorkspaceList } from "@/components/workspaces/workspace-list";
import { PageHeader } from "@/components/page-patterns";
import { requireSession } from "@/lib/server/session";
import { myWorkspaces } from "@/lib/server/workspaces/service";
export const metadata = { title: "Creation workspaces" };
export default async function Page() {
  const actor = await requireSession().catch((error: unknown) => {
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
        title="Creation workspaces"
        description="Build with AI, save decisions, compare candidates and approve versioned work."
      />
      <WorkspaceList
        key={actor.uid}
        uid={actor.uid}
        initial={await myWorkspaces()}
      />
    </div>
  );
}
