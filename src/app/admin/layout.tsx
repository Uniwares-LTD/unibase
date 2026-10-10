import Link from "next/link";
import { adminPageSession } from "@/lib/server/admin-view";
import { Button } from "@/components/ui/button";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await adminPageSession();
  return (
    <div className="space-y-8">
      <nav
        aria-label="Administrator navigation"
        className="flex flex-wrap gap-2"
      >
        <Button variant="outline" asChild>
          <Link href="/admin/operations">Operations</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin">Overview</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/users">Users</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/reports">Reports</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/ai">AI operations</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/execution-profiles">Execution profiles</Link>
        </Button>
        {process.env.NODE_ENV === "development" && (
          <Button variant="outline" asChild>
            <Link href="/design-system">Design system</Link>
          </Button>
        )}
      </nav>
      {children}
    </div>
  );
}
