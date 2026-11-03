import type { ComponentType } from "react";

// Project-owned home page. Set a Server Component here to replace the template's
// default home at "/"; null keeps the default. It renders inside the page's
// message scope, so translated copy uses literal t("m…") calls as elsewhere.
export type ProjectHomeProps = { appName: string; hasSession: boolean };
export const projectHome: ComponentType<ProjectHomeProps> | null = null;
