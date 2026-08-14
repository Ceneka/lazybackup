"use client"

import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  useEncryption,
  performVaultPasskeyStepUp,
  type EncryptionKeyReveal,
  type PublicAgeKey,
  type VaultStepUpFields,
} from "@/lib/hooks/useEncryption"
import { useAuthStatus } from "@/lib/hooks/useAuth"
import { MIN_WRAP_PASSPHRASE_LENGTH } from "@/lib/crypto/constants"
import {
  AlertTriangleIcon,
  CopyIcon,
  DownloadIcon,
  KeyRoundIcon,
  ShieldIcon,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

function statusBadgeClass(status: PublicAgeKey["status"]) {
  if (status === "active") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
  if (status === "compromised") return "bg-red-500/15 text-red-700 dark:text-red-400"
  return "bg-muted text-muted-foreground"
}

function ExportAckDialog({
  revealed,
  onAcknowledge,
  onDismiss,
  isLoading,
}: {
  revealed: EncryptionKeyReveal
  onAcknowledge: () => void
  onDismiss: () => void
  isLoading: boolean
}) {
  const [checks, setChecks] = useState({
    copied: false,
    offline: false,
    understand: false,
  })
  const allChecked = checks.copied && checks.offline && checks.understand

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border bg-background p-4 shadow-lg space-y-4">
        <div>
          <h3 className="font-semibold text-lg">Save this private key</h3>
          <p className="text-sm text-muted-foreground mt-1">
            The private key is stored on this LazyBackup instance. Export a copy
            for disaster recovery — if you lose both this instance and the
            offline copy, encrypted backups cannot be restored.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Private identity</Label>
          <textarea
            readOnly
            className="w-full min-h-[80px] rounded-md border bg-background p-2 font-mono text-xs"
            value={revealed.identity}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(revealed.identity)
              toast.success("Identity copied")
              setChecks((c) => ({ ...c, copied: true }))
            }}
          >
            <CopyIcon className="mr-2 h-4 w-4" />
            Copy identity
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          <label className="flex gap-2 items-start">
            <input
              type="checkbox"
              className="mt-1"
              checked={checks.copied}
              onChange={(e) => setChecks((c) => ({ ...c, copied: e.target.checked }))}
            />
            I copied the key (password manager, printed, or secure file)
          </label>
          <label className="flex gap-2 items-start">
            <input
              type="checkbox"
              className="mt-1"
              checked={checks.offline}
              onChange={(e) => setChecks((c) => ({ ...c, offline: e.target.checked }))}
            />
            I stored it somewhere that survives this machine dying
          </label>
          <label className="flex gap-2 items-start">
            <input
              type="checkbox"
              className="mt-1"
              checked={checks.understand}
              onChange={(e) =>
                setChecks((c) => ({ ...c, understand: e.target.checked }))
              }
            />
            I understand losing the key means losing access to ciphertext
          </label>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onDismiss}>
            Later
          </Button>
          <LoadingButton
            type="button"
            isLoading={isLoading}
            disabled={!allChecked}
            onClick={onAcknowledge}
          >
            I saved it
          </LoadingButton>
        </div>
      </div>
    </div>
  )
}

export function EncryptionSettingsPanel() {
  const enc = useEncryption()
  const auth = useAuthStatus()
  const hasPassword = Boolean(auth.data?.hasPassword)
  const hasPasskeys = Boolean(auth.data?.hasPasskeys)
  const [vaultPassword, setVaultPassword] = useState("")
  const [importValue, setImportValue] = useState("")
  const [importLabel, setImportLabel] = useState("")
  const [revealed, setRevealed] = useState<EncryptionKeyReveal | null>(null)
  const [passphraseKeyId, setPassphraseKeyId] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState("")
  const [recoveryLabel, setRecoveryLabel] = useState("")
  const [recoveryRecipient, setRecoveryRecipient] = useState("")

  const keys = enc.status?.keys ?? []
  const recovery = enc.status?.recoveryRecipients ?? []
  const configured = Boolean(enc.status?.configured)
  const stepUpReady = !hasPassword || vaultPassword.length > 0

  async function vaultStepUp(): Promise<VaultStepUpFields> {
    if (hasPassword) return { currentPassword: vaultPassword }
    if (hasPasskeys) return performVaultPasskeyStepUp()
    return {}
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldIcon className="h-5 w-5" />
          Encryption
        </CardTitle>
        <CardDescription>
          Client-side{" "}
          <a
            href="https://age-encryption.org"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            age
          </a>{" "}
          encryption. Private keys live on this instance; new backups encrypt to
          the <strong>active</strong> key plus any recovery recipients. Keep an
          offline copy of each private key for disaster recovery.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {enc.status?.needsExportAck && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <AlertTriangleIcon className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              Encrypted or Bro backups are enabled, but the active key has not
              been marked as exported. Export it below and confirm you saved a
              copy.
            </div>
          </div>
        )}

        {hasPassword && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="vaultCurrentPassword">Current app password</Label>
            <Input
              id="vaultCurrentPassword"
              type="password"
              autoComplete="current-password"
              value={vaultPassword}
              onChange={(e) => setVaultPassword(e.target.value)}
              placeholder="Required for sensitive vault operations"
            />
            <p className="text-xs text-muted-foreground">
              Revealing, exporting, deleting, and changing key or recovery state
              requires your app password, not just a signed-in session.
            </p>
          </div>
        )}
        {hasPasskeys && !hasPassword && (
          <p className="text-xs text-muted-foreground">
            Sensitive vault operations require a fresh passkey verification.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <LoadingButton
            type="button"
            isLoading={enc.generate.isPending}
            disabled={!stepUpReady}
            onClick={async () => {
              try {
                const result = await enc.generate.mutateAsync(await vaultStepUp())
                setRevealed(result)
                toast.success("New encryption key created — save the private key")
              } catch {
                /* toast in hook */
              }
            }}
          >
            <KeyRoundIcon className="mr-2 h-4 w-4" />
            {configured ? "Create new key" : "Generate key"}
          </LoadingButton>
          <Button type="button" variant="outline" asChild>
            <Link href="/backups/new?source=lazybackup_instance">
              Backup LazyBackup data
            </Link>
          </Button>
        </div>

        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys yet. Generate one to use encrypted backups or Bro Space.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div
                key={key.id}
                className="rounded-md border p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2 justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">{key.label}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${statusBadgeClass(key.status)}`}
                    >
                      {key.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {key.status !== "active" && (
                      <LoadingButton
                        type="button"
                        size="sm"
                        variant="outline"
                        isLoading={enc.setActive.isPending}
                        disabled={!stepUpReady}
                        onClick={async () => {
                          try {
                            await enc.setActive.mutateAsync({
                              keyId: key.id,
                              ...(await vaultStepUp()),
                            })
                          } catch {
                            /* toast */
                          }
                        }}
                      >
                        Set active
                      </LoadingButton>
                    )}
                    {key.status === "retired" && (
                      <LoadingButton
                        type="button"
                        size="sm"
                        variant="outline"
                        isLoading={enc.setStatus.isPending}
                        disabled={!stepUpReady}
                        onClick={async () => {
                          try {
                            await enc.setStatus.mutateAsync({
                              keyId: key.id,
                              status: "compromised",
                              ...(await vaultStepUp()),
                            })
                          } catch {
                            /* toast */
                          }
                        }}
                      >
                        Mark compromised
                      </LoadingButton>
                    )}
                    {key.status === "compromised" && (
                      <LoadingButton
                        type="button"
                        size="sm"
                        variant="outline"
                        isLoading={enc.setStatus.isPending}
                        disabled={!stepUpReady}
                        onClick={async () => {
                          try {
                            await enc.setStatus.mutateAsync({
                              keyId: key.id,
                              status: "retired",
                              ...(await vaultStepUp()),
                            })
                          } catch {
                            /* toast */
                          }
                        }}
                      >
                        Mark retired
                      </LoadingButton>
                    )}
                    <LoadingButton
                      type="button"
                      size="sm"
                      variant="outline"
                      isLoading={enc.reveal.isPending}
                      disabled={!stepUpReady}
                      onClick={async () => {
                        try {
                          const result = await enc.reveal.mutateAsync({
                            keyId: key.id,
                            ...(await vaultStepUp()),
                          })
                          setRevealed(result)
                        } catch {
                          /* toast */
                        }
                      }}
                    >
                      Export
                    </LoadingButton>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setPassphraseKeyId(key.id)
                        setPassphrase("")
                      }}
                    >
                      <DownloadIcon className="mr-1 h-3 w-3" />
                      Passphrase wrap
                    </Button>
                    <LoadingButton
                      type="button"
                      size="sm"
                      variant="destructive"
                      isLoading={enc.deleteKey.isPending}
                      disabled={!stepUpReady}
                      onClick={async () => {
                        if (
                          !confirm(
                            "Permanently delete this key? Encrypted backups that only use this key cannot be restored."
                          )
                        ) {
                          return
                        }
                        try {
                          await enc.deleteKey.mutateAsync({
                            keyId: key.id,
                            ...(await vaultStepUp()),
                          })
                        } catch {
                          /* toast */
                        }
                      }}
                    >
                      Delete
                    </LoadingButton>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={key.recipient}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      void navigator.clipboard.writeText(key.recipient)
                      toast.success("Recipient copied")
                    }}
                  >
                    <CopyIcon className="h-4 w-4" />
                  </Button>
                </div>
                {!key.exportAcknowledgedAt && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Offline export not acknowledged yet
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {passphraseKeyId && (
          <div className="rounded-md border p-3 space-y-2">
            <Label>Passphrase for wrapped export</Label>
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder={`At least ${MIN_WRAP_PASSPHRASE_LENGTH} characters`}
            />
            <div className="flex gap-2">
              <LoadingButton
                type="button"
                isLoading={enc.exportPassphrase.isPending}
                disabled={passphrase.length < MIN_WRAP_PASSPHRASE_LENGTH || !stepUpReady}
                onClick={async () => {
                  try {
                    const result = await enc.exportPassphrase.mutateAsync({
                      keyId: passphraseKeyId,
                      passphrase,
                      ...(await vaultStepUp()),
                    })
                    const blob = new Blob([result.armored], {
                      type: "text/plain",
                    })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement("a")
                    a.href = url
                    a.download = result.filename
                    a.click()
                    URL.revokeObjectURL(url)
                    toast.success("Passphrase-wrapped key downloaded")
                    setPassphraseKeyId(null)
                    setPassphrase("")
                  } catch {
                    /* toast */
                  }
                }}
              >
                Download .age
              </LoadingButton>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPassphraseKeyId(null)
                  setPassphrase("")
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="importIdentity">Import existing identity</Label>
          <Input
            placeholder="Label (optional)"
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
          />
          <textarea
            id="importIdentity"
            className="w-full min-h-[72px] rounded-md border bg-background p-2 font-mono text-xs"
            placeholder="AGE-SECRET-KEY-1…"
            value={importValue}
            onChange={(e) => setImportValue(e.target.value)}
          />
          <LoadingButton
            type="button"
            variant="secondary"
            isLoading={enc.importKey.isPending}
            disabled={!importValue.trim() || !stepUpReady}
            onClick={async () => {
              try {
                const result = await enc.importKey.mutateAsync({
                  identity: importValue.trim(),
                  label: importLabel.trim() || undefined,
                  ...(await vaultStepUp()),
                })
                setImportValue("")
                setImportLabel("")
                setRevealed(result)
                toast.success("Encryption key imported as active")
              } catch {
                /* toast */
              }
            }}
          >
            Import key
          </LoadingButton>
        </div>

        <div className="space-y-3 border-t pt-4">
          <div>
            <h4 className="font-medium">Recovery recipients</h4>
            <p className="text-sm text-muted-foreground">
              Extra public <code className="text-xs">age1…</code> keys included
              on every encrypt. Keep those private keys offline (paper, YubiKey,
              second machine).
            </p>
          </div>
          {recovery.length > 0 && (
            <ul className="space-y-2">
              {recovery.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
                >
                  <span className="font-medium">{r.label}</span>
                  <code className="font-mono text-xs truncate flex-1">
                    {r.recipient}
                  </code>
                  <LoadingButton
                    type="button"
                    size="sm"
                    variant="destructive"
                    isLoading={enc.deleteRecovery.isPending}
                    disabled={!stepUpReady}
                    onClick={async () => {
                      try {
                        await enc.deleteRecovery.mutateAsync({
                          id: r.id,
                          ...(await vaultStepUp()),
                        })
                      } catch {
                        /* toast */
                      }
                    }}
                  >
                    Remove
                  </LoadingButton>
                </li>
              ))}
            </ul>
          )}
          <Input
            placeholder="Label"
            value={recoveryLabel}
            onChange={(e) => setRecoveryLabel(e.target.value)}
          />
          <Input
            placeholder="age1…"
            className="font-mono text-xs"
            value={recoveryRecipient}
            onChange={(e) => setRecoveryRecipient(e.target.value)}
          />
          <LoadingButton
            type="button"
            variant="secondary"
            isLoading={enc.addRecovery.isPending}
            disabled={!recoveryRecipient.trim().startsWith("age1") || !stepUpReady}
            onClick={async () => {
              try {
                await enc.addRecovery.mutateAsync({
                  label: recoveryLabel.trim() || undefined,
                  recipient: recoveryRecipient.trim(),
                  ...(await vaultStepUp()),
                })
                setRecoveryLabel("")
                setRecoveryRecipient("")
              } catch {
                /* toast */
              }
            }}
          >
            Add recovery recipient
          </LoadingButton>
        </div>
      </CardContent>

      {revealed && (
        <ExportAckDialog
          revealed={revealed}
          isLoading={enc.acknowledgeExport.isPending}
          onDismiss={() => setRevealed(null)}
          onAcknowledge={async () => {
            try {
              await enc.acknowledgeExport.mutateAsync(revealed.id)
              setRevealed(null)
              toast.success("Export acknowledged")
            } catch {
              /* toast */
            }
          }}
        />
      )}
    </Card>
  )
}
