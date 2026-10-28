import { getSession, signInRedirect } from "@/lib/server/session";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.email_verified) return signInRedirect();
  return children;
}
