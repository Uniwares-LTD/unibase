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

export const metadata: Metadata = { title: "Manage users" };
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await adminPageSession();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const pageToken = typeof params.page === "string" ? params.page : undefined;
  const { rows, nextPageToken } = await listManagedUsers(query, pageToken);
  return (
    <div className="page-stack">
      <PageHeader
        title="Users"
        description="Find an account to review its profile, access and credit balance."
      />
      <form method="get" className="flex max-w-xl flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="user-search">Exact email or Firebase UID</Label>
          <Input
            id="user-search"
            name="q"
            defaultValue={query}
            maxLength={320}
          />
        </div>
        <Button type="submit">Search</Button>
        <Button variant="outline" asChild>
          <Link href="/admin/users">Clear</Link>
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((user) => (
            <TableRow key={user.uid}>
              <TableCell className="max-w-64 whitespace-normal break-words">
                <p className="font-medium">
                  {user.displayName || "Unnamed account"}
                </p>
                <p>{user.email || user.uid}</p>
                <p className="text-xs text-muted-foreground">
                  {user.verified ? "Verified email" : "Unverified email"}
                </p>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{user.role}</Badge>
              </TableCell>
              <TableCell>
                {user.status}
                {user.providerDisabled && (
                  <p className="text-xs">Disabled in Firebase</p>
                )}
              </TableCell>
              <TableCell>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/admin/users/${encodeURIComponent(user.uid)}`}>
                    Manage
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!rows.length && (
        <EmptyState
          title="No matching accounts."
          description="Search by exact email or UID, or clear the search to browse accounts."
        />
      )}
      {nextPageToken && (
        <Button variant="outline" asChild>
          <Link href={`/admin/users?page=${encodeURIComponent(nextPageToken)}`}>
            Next page
          </Link>
        </Button>
      )}
    </div>
  );
}
