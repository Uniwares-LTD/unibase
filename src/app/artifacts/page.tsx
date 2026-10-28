import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { getSession, signInRedirect } from "@/lib/server/session";
import { listArtifacts } from "@/lib/server/runs/artifacts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-patterns";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  const translate = await getTranslations("ui");

  if (!(await getSession())?.email_verified) return signInRedirect();
  const { rows, next } = await listArtifacts((await searchParams).cursor);
  return (
    <PageMessages path="/artifacts">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m068c9472b061")}
            description={translate("meeb64b43bc58")}
          />
          <div className="space-y-2">
            <Button asChild>
              <Link href="/runs/new">{translate("m1d73ad4bb3ee")}</Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              {translate("m074e4970ff6e")}{" "}
            </p>
          </div>
          <ul className="space-y-3">
            {rows.map((row) => (
              <li key={row.id}>
                <Link className="underline" href={`/artifacts/${row.id}`}>
                  {row.title}
                </Link>{" "}
                {translate("m8d8560f759ff")} {row.revision}
              </li>
            ))}
          </ul>
          {next && (
            <Button asChild variant="outline">
              <Link href={`/artifacts?cursor=${encodeURIComponent(next)}`}>
                {translate("m94988b714422")}{" "}
              </Link>
            </Button>
          )}
          {!rows.length && <p>{translate("m6c00deef65c1")}</p>}
        </div>
      }
    </PageMessages>
  );
}
