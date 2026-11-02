import "server-only";
import type { Migration } from "./migrations";
import { migrateDomainReferences } from "./domain-migration";

// Template-owned migrations, in order. Never edit or renumber an entry once
// released; add a new one. Owners other than "core" run only while that
// module is enabled.
export const coreMigrations: readonly Migration[] = [
  {
    id: "runs:0001-domain-references",
    description: "Add domain target references to Run jobs and applications.",
    run: migrateDomainReferences,
  },
];
