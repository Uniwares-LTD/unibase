import { adminPageSession } from "@/lib/server/admin-view";
import { AdminNav } from "@/components/admin-nav";
import { adminSections } from "./sections";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await adminPageSession();
  const items = [
    { href: "/admin", label: "Overview" },
    ...(await adminSections()),
    ...(process.env.NODE_ENV === "development"
      ? [{ href: "/design-system", label: "Design system" }]
      : []),
  ].map(({ href, label }) => ({ href, label }));
  return (
    <div className="space-y-8">
      <AdminNav label="Administrator navigation" items={items} />
      {children}
    </div>
  );
}
