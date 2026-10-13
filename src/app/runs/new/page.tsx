import { RunLanding } from "@/components/runs/run-start";
import { orchestrators } from "@/lib/server/runs/orchestrators";
import { listRuns } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
import { personaChoices } from "@/lib/server/runs/personas";
import { listArtifacts, ownedArtifact } from "@/lib/server/runs/artifacts";
import { database } from "@/lib/server/mongo";
import { requireSession } from "@/lib/server/session";
import { z } from "zod";
import { notFound } from "next/navigation";
import { AppError } from "@/lib/auth-policy";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ artifactId?: string }>;
}) {
  const actor = await requireSession();
  const query = await searchParams;
  const parsed = query.artifactId
    ? z.string().uuid().safeParse(query.artifactId)
    : null;
  if (parsed && !parsed.success) notFound();
  const artifactId = parsed?.success ? parsed.data : undefined;
  const [choices, runs, personas, savedArtifacts, initialArtifact] =
    await Promise.all([
      orchestrators(false, true),
      listRuns(),
      personaChoices(),
      listArtifacts(),
      artifactId
        ? ownedArtifact(database(), actor.uid, artifactId).catch((error) => {
            if (
              error instanceof AppError &&
              error.code === "ARTIFACT_NOT_FOUND"
            )
              notFound();
            throw error;
          })
        : Promise.resolve(null),
    ]);
  const artifactRows =
    initialArtifact && !savedArtifacts.some((a) => a.id === initialArtifact.id)
      ? [initialArtifact, ...savedArtifacts]
      : savedArtifacts;
  return (
    <div className="page-stack">
      <PageHeader
        title="Start a run"
        description="Choose a workflow, pick who answers, and create something new."
      />
      <RunLanding
        key={artifactId ?? "new"}
        choices={choices}
        personas={personas}
        artifactId={artifactId}
        artifacts={artifactRows.map(({ id, title, revision }) => ({
          id,
          title,
          revision,
        }))}
        unfinished={runs.rows.filter(
          (r) => !["succeeded", "failed", "cancelled"].includes(r.status),
        )}
      />
    </div>
  );
}
