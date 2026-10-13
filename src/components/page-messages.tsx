import "server-only";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { clientMessages } from "@/lib/server/client-messages";

// A page provider travels with each RSC navigation; the persistent shell only
// receives its common messages and never depends on the previous page catalog.
export async function PageMessages({
  path,
  children,
}: {
  path: string;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider
      messages={clientMessages(await getMessages(), path)}
    >
      {children}
    </NextIntlClientProvider>
  );
}
