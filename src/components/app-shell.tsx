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
    return <main className="flex-1 container mx-auto py-6 px-4">{children}</main>
  }

  return (
    <NavigationPendingProvider>
      <Navbar />
      <BackupEventsProvider />
      <main className="relative flex-1 container mx-auto py-6 px-4">
        <NavigationPendingOverlay />
        {children}
      </main>
      <AuthSetupPrompt />
    </NavigationPendingProvider>
  )
}
