import { cn } from "@/lib/utils"
import Link from "next/link"

export type UsedByBackup = {
  id: string
  name: string
  roles: Array<"source" | "destination">
}

export function backupRoleLabel(roles: UsedByBackup["roles"]) {
  if (roles.includes("source") && roles.includes("destination")) {
    return "Source & destination"
  }
  if (roles.includes("destination")) return "Destination"
  return "Source"
}

/** Persistent list of backups that blocked a delete (DELETE 409). */
export function InUseBlockers({
  blockers,
  className,
}: {
  blockers: UsedByBackup[] | null | undefined
  className?: string
}) {
  if (!blockers?.length) return null
  return (
    <div
      className={cn(
        "rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm",
        className
      )}
      role="alert"
    >
      <p className="font-medium text-destructive">Cannot delete — still used by:</p>
      <ul className="mt-2 space-y-1">
        {blockers.map((backup) => (
          <li key={backup.id}>
            <Link
              href={`/backups/${backup.id}`}
              className="underline underline-offset-2 hover:no-underline"
            >
              {backup.name}
            </Link>
            <span className="ml-2 text-muted-foreground">
              ({backupRoleLabel(backup.roles)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function UsedByBackupsCard({
  description,
  backups,
}: {
  description: string
  backups: UsedByBackup[]
}) {
  return (
    <div className="rounded-lg border bg-card p-6 text-card-foreground shadow">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Used by backups</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {backups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No backups reference this yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {backups.map((backup) => (
            <li key={backup.id}>
              <Link
                href={`/backups/${backup.id}`}
                className="flex items-center justify-between gap-3 px-3 py-3 transition-colors hover:bg-accent/50"
              >
                <span className="min-w-0 truncate font-medium">{backup.name}</span>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                  {backupRoleLabel(backup.roles)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
