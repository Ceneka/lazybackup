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
      <div className="flex items-center space-x-2">
        <Link href={backHref} className={backButtonClassName}>
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">{backLabel}</span>
        </Link>
        <h1 className="text-3xl font-bold">{title}</h1>
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
  children,
}: {
  backHref: string
  backLabel: string
  title: ReactNode
  detailsTitle: string
  details: ReactNode
  actions: ReactNode
  actionsExtra?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="space-y-6">
      <ResourcePageHeader backHref={backHref} backLabel={backLabel} title={title} />
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
          <h2 className="mb-4 text-xl font-semibold">{detailsTitle}</h2>
          {details}
        </div>
        <div className="w-full self-start rounded-lg border bg-card p-6 text-card-foreground shadow">
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
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-lg">{children}</dd>
    </div>
  )
}
