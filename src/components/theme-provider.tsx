"use client";
import { namespace } from "@/lib/project";
import { createContext, useContext, useInsertionEffect, useState } from "react";
import { setNonce } from "get-nonce";
import { ThemeProvider as NextThemesProvider } from "next-themes";

const NonceContext = createContext<string | undefined>(undefined);
export const useDocumentNonce = () => useContext(NonceContext);

export function ThemeProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  const [documentNonce] = useState(nonce);
  useInsertionEffect(() => {
    if (documentNonce) setNonce(documentNonce);
  }, [documentNonce]);
  return (
    <NonceContext.Provider value={documentNonce}>
      <NextThemesProvider
        nonce={documentNonce}
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey={namespace("theme")}
        disableTransitionOnChange
      >
        {children}
      </NextThemesProvider>
    </NonceContext.Provider>
  );
}
