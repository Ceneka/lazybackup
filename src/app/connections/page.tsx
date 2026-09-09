"use client"

import { ConnectionsS3ProfilesList } from "@/components/connections/s3-profiles-list"
import { ConnectionsServersList } from "@/components/connections/servers-list"
import { PageHeader, PageLayout } from "@/components/page-layout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CloudIcon, PlusIcon, ServerIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useLayoutEffect, useState } from "react"

const TABS = ["servers", "s3"] as const
type ConnectionsTab = (typeof TABS)[number]

function isConnectionsTab(value: string | null): value is ConnectionsTab {
  return TABS.includes(value as ConnectionsTab)
}

function ConnectionsPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tab, setTab] = useState<ConnectionsTab>("servers")

  useLayoutEffect(() => {
    const next = searchParams.get("tab")
    setTab(isConnectionsTab(next) ? next : "servers")
  }, [searchParams])

  function onTabChange(value: string) {
    const next: ConnectionsTab = isConnectionsTab(value) ? value : "servers"
    setTab(next)
    router.replace(`/connections?tab=${next}`, { scroll: false })
  }

  return (
    <PageLayout>
      <PageHeader
        title="Connections"
        description="SSH hosts and S3-compatible profiles used as backup sources and destinations."
        actions={
          tab === "s3" ? (
            <Link
              href="/s3-profiles/new"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add S3 profile
            </Link>
          ) : (
            <Link
              href="/servers/new"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <PlusIcon className="mr-2 h-4 w-4" />
              Add server
            </Link>
          )
        }
      />

      <Tabs value={tab} onValueChange={onTabChange} className="w-full">
        <TabsList>
          <TabsTrigger value="servers" className="gap-1.5">
            <ServerIcon className="h-4 w-4" />
            Servers
          </TabsTrigger>
          <TabsTrigger value="s3" className="gap-1.5">
            <CloudIcon className="h-4 w-4" />
            S3
          </TabsTrigger>
        </TabsList>
        <TabsContent value="servers">
          <ConnectionsServersList />
        </TabsContent>
        <TabsContent value="s3">
          <ConnectionsS3ProfilesList />
        </TabsContent>
      </Tabs>
    </PageLayout>
  )
}

export default function ConnectionsPage() {
  return (
    <Suspense
      fallback={
        <PageLayout>
          <PageHeader title="Connections" />
          <div className="flex justify-center py-12 text-muted-foreground">Loading…</div>
        </PageLayout>
      }
    >
      <ConnectionsPageInner />
    </Suspense>
  )
}
