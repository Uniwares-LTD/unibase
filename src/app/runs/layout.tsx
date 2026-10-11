import { getSession } from "@/lib/server/session";
import { redirect } from "next/navigation";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.email_verified) redirect("/account");
  return children;
}
