import { StateLabel } from "@/components/localized-value";
import { PageMessages } from "@/components/page-messages";
import { getTranslations } from "next-intl/server";
import { PageHeader, EmptyState } from "@/components/page-patterns";
import type { Metadata } from "next";
import Link from "next/link";
import { listManagedUsers } from "@/lib/server/admin";
import { adminPageSession } from "@/lib/server/admin-view";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("ui"))("m58606e582452") };
}
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const translate = await getTranslations("ui");

  await adminPageSession();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const pageToken = typeof params.page === "string" ? params.page : undefined;
  const { rows, nextPageToken } = await listManagedUsers(query, pageToken);
  return (
    <PageMessages path="/admin/users">
      {
        <div className="page-stack">
          <PageHeader
            title={translate("m6b0cc904d081")}
            description={translate("m8e3573ba1909")}
          />
          <form
            method="get"
            className="flex max-w-xl flex-wrap items-end gap-3"
          >
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="user-search">{translate("mcc6302d75cf6")}</Label>
              <Input
                id="user-search"
                name="q"
                defaultValue={query}
                maxLength={320}
              />
            </div>
            <Button type="submit">{translate("m49c266baaaa7")}</Button>
            <Button variant="outline" asChild>
              <Link href="/admin/users">{translate("m83b12c2216ef")}</Link>
            </Button>
          </form>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{translate("mb512d97e7cbf")}</TableHead>
                <TableHead>{translate("m14736a2eb9f4")}</TableHead>
                <TableHead>{translate("m920e413c7d41")}</TableHead>
                <TableHead>{translate("m45989de49fb7")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.uid}>
                  <TableCell className="max-w-64 whitespace-normal break-words">
                    <p className="font-medium">
                      {user.displayName || translate("mefeba8456698")}
                    </p>
                    <p>{user.email || user.uid}</p>
                    <p className="text-xs text-muted-foreground">
                      {user.verified
                        ? translate("m1685290ae957")
                        : translate("m3b2bf5217a3d")}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <StateLabel value={user.role} />
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StateLabel value={user.status} />
                    {user.providerDisabled && (
                      <p className="text-xs">{translate("m1ce1a0ec624b")}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" asChild>
                      <Link
                        href={`/admin/users/${encodeURIComponent(user.uid)}`}
                      >
                        {translate("m5a23444828db")}{" "}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!rows.length && (
            <EmptyState
              title={translate("m277fdaebdd67")}
              description={translate("m5aa0770ff868")}
            />
          )}
          {nextPageToken && (
            <Button variant="outline" asChild>
              <Link
                href={`/admin/users?page=${encodeURIComponent(nextPageToken)}`}
              >
                {translate("mc08ac736a5e2")}{" "}
              </Link>
            </Button>
          )}
        </div>
      }
    </PageMessages>
  );
}
