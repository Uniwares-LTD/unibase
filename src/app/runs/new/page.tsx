import { RunLanding } from "@/components/runs/run-ui";
import { orchestrators } from "@/lib/server/runs/orchestrators";
import { listRuns } from "@/lib/server/runs/service";
import { PageHeader } from "@/components/page-patterns";
import { personaChoices } from "@/lib/server/runs/personas";
import { ownedArtifact } from "@/lib/server/runs/artifacts";
import { database } from "@/lib/server/mongo";
import { requireSession } from "@/lib/server/session";
import { z } from "zod";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ artifactId?: string }>;
}) {
  const actor = await requireSession();
  const query = await searchParams;
  const artifactId = query.artifactId
    ? z.string().uuid().parse(query.artifactId)
    : undefined;
  if (artifactId) await ownedArtifact(database(), actor.uid, artifactId);
  const [choices, runs, personas] = await Promise.all([
    orchestrators(false, true),
    listRuns(),
    personaChoices(),
  ]);
  return (
    <div className="page-stack">
      <PageHeader
        title="Start a run"
        description="Choose an orchestrator and build with AI."
      />
      <RunLanding
        choices={choices.filter((c) =>
          artifactId ? c.requiresArtifact : !c.requiresArtifact,
        )}
        personas={personas}
        artifactId={artifactId}
        unfinished={runs.rows.filter(
          (r) => !["succeeded", "failed", "cancelled"].includes(r.status),
        )}
      />
    </div>
  );
}
