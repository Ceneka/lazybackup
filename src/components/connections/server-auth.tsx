import { Badge } from "@/components/ui/badge"
import type { Server } from "@/lib/hooks/useServers"
import { cn } from "@/lib/utils"
import { AlertTriangleIcon } from "lucide-react"
import Link from "next/link"

/** Key vs password readiness badge for server cards. */
export function ServerAuthBadge({
  server,
}: {
  server: Pick<Server, "authType">
}) {
  return server.authType === "key" ? (
    <Badge variant="success">Key</Badge>
  ) : (
    <Badge variant="warning">Password only</Badge>
  )
}

/** One-line credential summary (key name, system path, or password caveat). */
export function serverAuthSummary(server: Server) {
  if (server.authType === "password") {
    return "Password stored · transfer needs an SSH key"
  }
  if (server.sshKey?.name) return `Key: ${server.sshKey.name}`
  if (server.systemKeyPath) {
    const name = server.systemKeyPath.split(/[\\/]/).pop() || server.systemKeyPath
    return `System key: ${name}`
  }
  if (server.hasPrivateKey) return "Inline private key stored"
  return "Key (missing)"
}

/**
 * The product's central gotcha: password auth can connect for tests and
 * remote commands, but path transfers need a key.
 */
export function PasswordAuthWarning({
  editHref,
  className,
}: {
  editHref?: string
  className?: string
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm",
        className
      )}
    >
      <AlertTriangleIcon
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div>
        <p className="font-medium text-amber-900 dark:text-amber-200">
          Password auth can test this host; path backups need an SSH key.
        </p>
        <p className="mt-1 text-muted-foreground">
          Add a key to this server to run path, volume, or database transfers.
          {editHref ? (
            <>
              {" "}
              <Link
                href={editHref}
                className="underline underline-offset-2 hover:no-underline"
              >
                Add a key
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}
