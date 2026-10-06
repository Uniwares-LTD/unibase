"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  STYLE_COOKIE,
  resolveStyle,
  type DesignStyle,
  type StylePreference,
} from "@/lib/appearance";
import { watchPageCover } from "@/lib/page-cover";

const StyleContext = createContext<{
  preference: StylePreference;
  defaultStyle: DesignStyle;
  setPreference: (value: StylePreference) => void;
} | null>(null);

export function StyleProvider({
  children,
  initialPreference,
  defaultStyle,
}: {
  children: ReactNode;
  initialPreference: StylePreference;
  defaultStyle: DesignStyle;
}) {
  const [preference, setState] = useState(initialPreference);
  const style = resolveStyle(preference, defaultStyle);
  useEffect(() => {
    if (style !== "glass") return;
    return watchPageCover(document, (url) => {
      if (url) {
        document.documentElement.style.setProperty(
          "--page-cover",
          `url(${JSON.stringify(url)})`,
        );
        document.documentElement.dataset.pageCover = "loaded";
      } else {
        document.documentElement.style.removeProperty("--page-cover");
        delete document.documentElement.dataset.pageCover;
      }
    });
  }, [style]);
  const setPreference = useCallback(
    (value: StylePreference) => {
      document.documentElement.dataset.style = resolveStyle(
        value,
        defaultStyle,
      );
      // This public appearance cookie is read by the server before rendering.
      // No credentials or account authority are stored here.
      try {
        document.cookie = `${STYLE_COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      } catch {
        /* Appearance still works when browser persistence is unavailable. */
      }
      setState(value);
    },
    [defaultStyle],
  );
  return (
    <StyleContext.Provider value={{ preference, defaultStyle, setPreference }}>
      {children}
    </StyleContext.Provider>
  );
}

export function useStyle() {
  const value = useContext(StyleContext);
  if (!value) throw new Error("Style controls require StyleProvider.");
  return value;
}
