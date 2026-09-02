"use client"

import { Logo } from "@/components/logo"
import { PageLayout } from "@/components/page-layout"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <PageLayout className="flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <Logo className="[&_svg]:h-12 [&_svg]:w-12" />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
          Try again, or go back to the dashboard.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" onClick={() => reset()}>
          Retry
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Dashboard</Link>
        </Button>
      </div>
    </PageLayout>
  )
}
