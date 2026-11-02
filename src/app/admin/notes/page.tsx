// Sample: notes. Administration is English-only and shows aggregates only.
import type { Metadata } from "next";
import { PageHeader } from "@/components/page-patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { adminPageSession } from "@/lib/server/admin-view";
import { database } from "@/lib/server/mongo";
import { notFound } from "next/navigation";
import { moduleEnabled } from "@/lib/project";
import { noteStatistics } from "@/samples/notes/store";

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Notes (sample)" };
}

export default async function NotesAdminPage() {
  // Administration paths are outside module routes, so gate here.
  if (!moduleEnabled("notes")) notFound();
  await adminPageSession();
  const { total, accounts } = await noteStatistics(database());
  return (
    <div className="page-stack">
      <PageHeader
        title="Notes (sample)"
        description="Reference feature for project extensions. Note content stays private to its owner."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">{total}</CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Accounts with notes</CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-semibold">
            {accounts}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
