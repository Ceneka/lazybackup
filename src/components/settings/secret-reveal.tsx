"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { CopyButton } from "@/components/settings/copy-button"
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type RevealedSecret = {
  /** Stable id so a panel can dismiss only the secret it created. */
  id: string
  title: string
  description?: string
  value: string
  /** Toast/button label for copying, e.g. "Token" or "Invite code". */
  copyLabel?: string
  /** Extra context under the value (expiry, links, install commands). */
  extra?: ReactNode
}

type SecretRevealContextValue = {
  reveal: (secret: RevealedSecret) => void
  dismiss: (id: string) => void
  /** False when rendered outside the Settings provider (fallback no-op). */
  available: boolean
}

const noopContext: SecretRevealContextValue = {
  reveal: () => {},
  dismiss: () => {},
  available: false,
}

const SecretRevealContext = createContext<SecretRevealContextValue | null>(null)

export function useSecretReveal(): SecretRevealContextValue {
  return useContext(SecretRevealContext) ?? noopContext
}

/**
 * Keeps just-created one-time secrets (API tokens, Bro invite codes) above the
 * Settings tabs so switching tabs or unmounting a panel cannot destroy them.
 * The user dismisses the banner explicitly.
 */
export function SecretRevealProvider({ children }: { children: ReactNode }) {
  const [secrets, setSecrets] = useState<RevealedSecret[]>([])

  const reveal = useCallback((next: RevealedSecret) => {
    setSecrets((current) => [
      next,
      ...current.filter((secret) => secret.id !== next.id),
    ])
    // The banner lives above the tabs; make sure a newly created secret is
    // visible even when the panel was scrolled down.
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" })
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    setSecrets((current) => current.filter((secret) => secret.id !== id))
  }, [])

  const value = useMemo(
    () => ({ reveal, dismiss, available: true }),
    [reveal, dismiss]
  )

  return (
    <SecretRevealContext.Provider value={value}>
      {secrets.map((secret) => (
        <SecretBanner
          key={secret.id}
          secret={secret}
          onDismiss={() => dismiss(secret.id)}
        />
      ))}
      {children}
    </SecretRevealContext.Provider>
  )
}

function SecretBanner({
  secret,
  onDismiss,
}: {
  secret: RevealedSecret
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [confirmHide, setConfirmHide] = useState(false)

  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-amber-950 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{secret.title}</p>
          {secret.description ? (
            <p className="mt-0.5 text-sm text-amber-900/80 dark:text-amber-100/80">
              {secret.description}
            </p>
          ) : null}
        </div>
        <Badge variant="warning">Shown once</Badge>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <code className="block min-w-0 flex-1 break-all rounded bg-background/80 px-3 py-2 font-mono text-xs">
          {secret.value}
        </code>
        <CopyButton
          value={secret.value}
          label={secret.copyLabel ?? secret.title}
          onCopied={() => setCopied(true)}
        />
      </div>

      {secret.extra}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (copied) onDismiss()
            else setConfirmHide(true)
          }}
        >
          Done — hide this
        </Button>
        <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
          This banner won’t reappear after you hide it. Copy the value first.
        </p>
      </div>

      <ConfirmActionDialog
        open={confirmHide}
        onOpenChange={setConfirmHide}
        hideTrigger
        title="Hide without copying?"
        description="You won't be able to see this value again. Cancel and copy it first if you still need it."
        confirmLabel="Hide anyway"
        variant="destructive"
        onConfirm={onDismiss}
      />
    </div>
  )
}
