import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getSession, signInRedirect } from "@/lib/server/session";
import { listArtifacts } from "@/lib/server/runs/artifacts";
import { DateLabel, NumberLabel } from "@/components/localized-value";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/page-patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m068c9472b061") };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const translate = await getTranslations("ui");

  if (!(await getSession())?.email_verified) return signInRedirect();
  const { cursor } = await searchParams;
  const { rows, next } = await listArtifacts(cursor);
  return (
    <PageMessages path="/artifacts">
      <div className="page-stack">
        <PageHeader
          title={translate("m068c9472b061")}
          description={translate("meeb64b43bc58")}
          actions={
            <Button asChild>
              <Link href="/runs/new">{translate("m1d73ad4bb3ee")}</Link>
            </Button>
          }
        />
        {rows.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{translate("m0a009ceb421c")}</TableHead>
                <TableHead>{translate("mcf11332efc70")}</TableHead>
                <TableHead>{translate("m3342235d9b17")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-normal">
                    <Link
                      className="font-medium underline-offset-4 hover:underline"
                      href={`/artifacts/${row.id}`}
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <NumberLabel value={row.revision} />
                  </TableCell>
                  <TableCell>
                    <DateLabel value={row.createdAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            title={translate("me75ecae6a9dc")}
            description={translate("mf69b50d41c37")}
          />
        )}
        {(next || cursor) && (
          <div className="flex flex-wrap gap-2">
            {cursor && (
              <Button asChild variant="outline">
                <Link href="/artifacts">{translate("mf5f6ce35d55c")}</Link>
              </Button>
            )}
            {next && (
              <Button asChild variant="outline">
                <Link href={`/artifacts?cursor=${encodeURIComponent(next)}`}>
                  {translate("m94988b714422")}
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>
    </PageMessages>
  );
}
