"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

// next-auth/reactのsignIn/useSessionはSessionProviderの配下でないと動かないため、
// RootLayoutから全ページを包む。
export function SessionProvider({ children }: { children: React.ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}
