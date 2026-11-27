import { cn } from "@/lib/utils"
import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

const backButtonClassName =
  "inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"

export function ResourcePageHeader({
  backHref,
  backLabel,
  title,
  description,
}: {
  backHref: string
  backLabel: string
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-start space-x-2">
        <Link href={backHref} className={cn(backButtonClassName, "shrink-0")}>
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">{backLabel}</span>
        </Link>
        <h1 className="min-w-0 break-words text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h1>
      </div>
      {description ? (
        <p className="pl-12 text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
}

/** Edit / create form chrome: back + title + card. */
export function ResourceEditLayout({
  backHref,
  backLabel,
  title,
  description,
  children,
}: {
  backHref: string
  backLabel: string
  title: ReactNode
  description?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-6">
      <ResourcePageHeader
        backHref={backHref}
        backLabel={backLabel}
        title={title}
        description={description}
      />
      <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">{children}</div>
    </div>
  )
}

/** Detail chrome: back + title, then Details | Actions tiles, then extra sections. */
export function ResourceDetailLayout({
  backHref,
  backLabel,
  title,
  detailsTitle,
  details,
  actions,
  actionsExtra,
  hideHeader = false,
  children,
}: {
  backHref: string
  backLabel: string
  title: ReactNode
  detailsTitle: string
  details: ReactNode
  actions: ReactNode
  actionsExtra?: ReactNode
  /** Page already renders `ResourcePageHeader` outside its query state. */
  hideHeader?: boolean
  children?: ReactNode
}) {
  return (
    <div className="space-y-6">
      {hideHeader ? null : (
        <ResourcePageHeader backHref={backHref} backLabel={backLabel} title={title} />
      )}
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div className="order-2 min-w-0 rounded-lg border bg-card p-6 text-card-foreground shadow md:order-1">
          <h2 className="mb-4 text-xl font-semibold">{detailsTitle}</h2>
          {details}
        </div>
        {/* Actions are the reason to open a detail page — lead on mobile. */}
        <div className="order-1 w-full min-w-0 self-start rounded-lg border bg-card p-6 text-card-foreground shadow md:order-2">
          <h2 className="mb-4 text-xl font-semibold">Actions</h2>
          {actions}
          {actionsExtra}
        </div>
      </div>
      {children}
    </div>
  )
}

export function DetailFields({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <dl className={cn("space-y-4", className)}>{children}</dl>
}

export function DetailField({
  label,
  children,
  mono = false,
  className,
}: {
  label: string
  children: ReactNode
  /** Monospace + smaller text for URLs, IDs, and long paths. */
  mono?: boolean
  /** Extra classes for the value line (e.g. `text-base`). */
  className?: string
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "break-words",
          mono ? "break-all font-mono text-sm" : "text-lg",
          className
        )}
      >
        {children}
      </dd>
    </div>
  )
}
