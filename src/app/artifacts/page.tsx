import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/server/session";
import { listArtifacts } from "@/lib/server/runs/artifacts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-patterns";
export default async function Page() {
  if (!(await getSession())?.email_verified) redirect("/account");
  const rows = await listArtifacts();
  return (
    <div className="page-stack">
      <PageHeader
        title="Saved artifacts"
        description="Owned content and images retained independently of Run history."
      />
      <div className="space-y-2">
        <Button asChild>
          <Link href="/runs/new">Create with a Run</Link>
        </Button>
        <p className="text-sm text-muted-foreground">
          Start a Run to create a new artifact or add a revision to an existing
          one.
        </p>
      </div>
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <Link className="underline" href={`/artifacts/${row.id}`}>
              {row.title}
            </Link>{" "}
            · Revision {row.revision}
          </li>
        ))}
      </ul>
      {!rows.length && <p>No saved artifacts yet.</p>}
    </div>
  );
}
