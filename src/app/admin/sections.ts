// One ordered list feeds the administrator navigation and the overview cards.
export async function adminSections() {
  return [
    {
      href: "/admin/users",
      label: "Users",
      description:
        "Find an account to review its profile, access and credit balance.",
    },
    {
      href: "/admin/reports",
      label: "Reports",
      description:
        "Filter recorded application events and administrator changes.",
    },
    {
      href: "/admin/operations",
      label: "Operations",
      description:
        "Worker health, payment recovery and content cleanup. Changes require administrator access.",
    },
    {
      href: "/admin/ai",
      label: "AI operations",
      description:
        "Resolve uncertain executions and inspect provider usage independently of application credits.",
    },
    {
      href: "/admin/settings",
      label: "Base settings",
      description: "Application defaults, credits, and run policies.",
    },
    {
      href: "/admin/orchestrators",
      label: "Orchestrators",
      description: "Create from a template or register a Dify workflow.",
    },
    {
      href: "/admin/personas",
      label: "Personas",
      description:
        "Configure who answers workflow questions and their responder pricing.",
    },
  ];
}
