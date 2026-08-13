"use client"

import { ResourceQuickActionBar } from "@/components/resource-overflow"
import type { OverflowItem } from "@/components/overflow-menu"
import { type LucideIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

export function ResourceListCard({
  href,
  editHref,
  icon: Icon,
  title,
  badges,
  overflow,
  flash,
  children,
}: {
  href: string
  editHref: string
  icon: LucideIcon
  title: string
  badges?: ReactNode
  overflow: OverflowItem[]
  flash?: "success" | "failed" | null
  children: ReactNode
}) {
  return (
    <div className="group relative z-0 rounded-lg border bg-card p-6 text-card-foreground shadow-sm transition-shadow hover:z-10 hover:shadow-md focus-within:z-10">
      <Link href={href} className="absolute inset-0 z-0 rounded-lg" aria-label={title} />
      <div className="relative z-10 flex items-start justify-between gap-2">
        <div className="pointer-events-none flex min-w-0 items-center">
          <Icon className="mr-2 h-5 w-5 shrink-0 text-muted-foreground" />
          <h3 className="truncate font-medium">{title}</h3>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {badges}
          <ResourceQuickActionBar
            editHref={editHref}
            editLabel={`Edit ${title}`}
            overflow={overflow}
            flash={flash}
          />
        </div>
      </div>
      <div className="pointer-events-none relative z-10 mt-2 text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  )
}
