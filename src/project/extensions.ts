import type { ProjectExtension } from "../lib/extensions";

// Project-owned registry. Add one entry per project feature or sample; core
// code reads this list, so features do not edit core files. See
// docs/architecture.md#project-extensions.
export const extensions = [] as const satisfies readonly ProjectExtension[];
