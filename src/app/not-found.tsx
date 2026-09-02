import { Logo } from "@/components/logo"
import { PageLayout } from "@/components/page-layout"
import { Button } from "@/components/ui/button"
import Link from "next/link"

export default function NotFound() {
  return (
    <PageLayout className="flex min-h-[50vh] flex-col items-center justify-center py-16 text-center">
      <Logo className="[&_svg]:h-12 [&_svg]:w-12" />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          That URL is not a LazyBackup page.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Dashboard</Link>
      </Button>
    </PageLayout>
  )
}
