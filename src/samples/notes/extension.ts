// Sample: notes. Client-safe registration, listed in src/project/extensions.ts.
import { defineExtension } from "@/lib/extensions";

export const notesExtension = defineExtension({
  id: "notes",
  module: {
    requires: [],
    configuration: [],
    routes: ["/notes", "/api/notes"],
    workers: [],
    collections: ["notes"],
  },
  routes: [
    {
      href: "/notes",
      placement: "main",
      label: (t) => t("m8a7525b1492f"),
      icon: "notebook-pen",
    },
  ],
  adminSections: [
    {
      href: "/admin/notes",
      label: "Notes (sample)",
      description:
        "Reference feature: note counts across accounts. Remove with samples:remove.",
    },
  ],
});
