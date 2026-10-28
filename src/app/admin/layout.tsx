import { getTranslations } from "next-intl/server";
import { adminPageSession } from "@/lib/server/admin-view";
import { AdminNav } from "@/components/admin-nav";
import { adminSections } from "./sections";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const translate = await getTranslations("ui");

  await adminPageSession();
  const items = [
    { href: "/admin", label: translate("md4b1ea5708dd") },
    ...(await adminSections()),
    ...(process.env.NODE_ENV === "development"
      ? [{ href: "/design-system", label: translate("m4a866105af15") }]
      : []),
  ].map(({ href, label }) => ({ href, label }));
  return (
    <div className="space-y-8">
      <AdminNav label={translate("mf1800fdbbb68")} items={items} />
      {children}
    </div>
  );
}
