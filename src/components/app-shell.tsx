"use client"

import { AuthSetupPrompt } from "@/components/auth-setup-prompt"
import { Navbar } from "@/components/navbar"
import {
  NavigationPendingOverlay,
  NavigationPendingProvider,
} from "@/components/navigation-pending"
import { BackupEventsProvider } from "@/lib/hooks/useBackupEvents"
import { usePathname } from "next/navigation"

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isLogin = pathname === "/login"

  if (isLogin) {
    return (
      <>
        <SkipToContentLink />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 container mx-auto scroll-mt-14 py-6 px-4"
        >
          {children}
        </main>
      </>
    )
  }

  return (
    <NavigationPendingProvider>
      <SkipToContentLink />
      <Navbar />
      <BackupEventsProvider />
      <main
        id="main"
        tabIndex={-1}
        className="relative flex-1 container mx-auto scroll-mt-14 py-6 px-4"
      >
        <NavigationPendingOverlay />
        {children}
      </main>
      <AuthSetupPrompt />
    </NavigationPendingProvider>
  )
}

function SkipToContentLink() {
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[200] focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow"
    >
      Skip to content
    </a>
  )
}
