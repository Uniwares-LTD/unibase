import { getTranslations } from "next-intl/server";

// One ordered list feeds the administrator navigation and the overview cards.
export async function adminSections() {
  const translate = await getTranslations("ui");
  return [
    {
      href: "/admin/users",
      label: translate("m6b0cc904d081"),
      description: translate("m8e3573ba1909"),
    },
    {
      href: "/admin/reports",
      label: translate("mdacca3cba3f3"),
      description: translate("m348352db53e4"),
    },
    {
      href: "/admin/operations",
      label: translate("m358cc201f87d"),
      description: translate("mf42e7a16fa5e"),
    },
    {
      href: "/admin/ai",
      label: translate("m6a2e5e0ed2df"),
      description: translate("mef30fbe8fba2"),
    },
    {
      href: "/admin/settings",
      label: translate("m667f51f3c86a"),
      description: translate("m2938db2aa6de"),
    },
    {
      href: "/admin/orchestrators",
      label: translate("m9375b0d5e9f0"),
      description: translate("m67c91f3a3462"),
    },
    {
      href: "/admin/personas",
      label: translate("mfa2ea3fb081c"),
      description: translate("m519f46762642"),
    },
  ];
}
