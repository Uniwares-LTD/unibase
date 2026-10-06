import Link from "next/link";
import { adminPageSession } from "@/lib/server/admin-view";
import { Button } from "@/components/ui/button";
import { SessionControls } from "@/components/session-controls";

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
      </nav>
      {children}
      <SessionControls />
    </div>
  );
}
