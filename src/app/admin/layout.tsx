import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { adminPageSession } from "@/lib/server/admin-view";
import { Button } from "@/components/ui/button";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const translate = await getTranslations("ui");

  await adminPageSession();
  return (
    <div className="space-y-8">
      <nav
        aria-label={translate("mf1800fdbbb68")}
        className="flex flex-wrap gap-2"
      >
        <Button variant="outline" asChild>
          <Link href="/admin/operations">{translate("m358cc201f87d")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin">{translate("md4b1ea5708dd")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/users">{translate("m6b0cc904d081")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/reports">{translate("mdacca3cba3f3")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/ai">{translate("m6a2e5e0ed2df")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/settings">{translate("m667f51f3c86a")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/orchestrators">{translate("m9375b0d5e9f0")}</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/admin/personas">{translate("mfa2ea3fb081c")}</Link>
        </Button>
        {process.env.NODE_ENV === "development" && (
          <Button variant="outline" asChild>
            <Link href="/design-system">{translate("m4a866105af15")}</Link>
          </Button>
        )}
      </nav>
      {children}
    </div>
  );
}
