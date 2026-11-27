"use client"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { QueryState } from "@/components/ui/query-state"
import { OverflowMenu, type OverflowItem } from "@/components/overflow-menu"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { CopyButton } from "@/components/settings/copy-button"
import {
  useEncryption,
  performVaultPasskeyStepUp,
  type EncryptionKeyReveal,
  type PublicAgeKey,
  type VaultStepUpFields,
} from "@/lib/hooks/useEncryption"
import { useAuthStatus } from "@/lib/hooks/useAuth"
import { MIN_WRAP_PASSPHRASE_LENGTH } from "@/lib/crypto/constants"
import { AlertTriangleIcon, DownloadIcon, KeyRoundIcon, ShieldIcon } from "lucide-react"
import Link from "next/link"
import { useRef, useState } from "react"
import { toast } from "sonner"

function statusVariant(
  status: PublicAgeKey["status"]
): "success" | "destructive" | "muted" {
  if (status === "active") return "success"
  if (status === "compromised") return "destructive"
  return "muted"
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
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const identityRef = useRef<HTMLTextAreaElement>(null)
  const allChecked = checks.copied && checks.offline && checks.understand

  const requestDismiss = () => {
    if (allChecked) {
      onDismiss()
      return
    }
    setConfirmDiscard(true)
  }

  return (
    <>
      <AlertDialog
        open
        onOpenChange={(next) => {
          if (!next) requestDismiss()
        }}
      >
        <AlertDialogContent
          className="sm:max-w-2xl"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            identityRef.current?.focus()
            identityRef.current?.select()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Save this private key</AlertDialogTitle>
            <AlertDialogDescription>
              The private key is stored on this LazyBackup instance. Export a copy
              for disaster recovery — if you lose both this instance and the
              offline copy, encrypted backups cannot be restored.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2">
            <Label htmlFor="revealedIdentity">Private identity</Label>
            <textarea
              id="revealedIdentity"
              ref={identityRef}
              readOnly
              className="min-h-[96px] w-full rounded-md border bg-background p-2 font-mono text-xs"
              value={revealed.identity}
            />
            <CopyButton
              value={revealed.identity}
              label="Identity"
              variant="outline"
              size="sm"
              onCopied={() => setChecks((c) => ({ ...c, copied: true }))}
            />
          </div>

          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2" htmlFor="export-copied">
              <input
                id="export-copied"
                type="checkbox"
                className="mt-1"
                checked={checks.copied}
                onChange={(e) => setChecks((c) => ({ ...c, copied: e.target.checked }))}
              />
              <span>I copied the key (password manager, printed, or secure file)</span>
            </label>
            <label className="flex items-start gap-2" htmlFor="export-offline">
              <input
                id="export-offline"
                type="checkbox"
                className="mt-1"
                checked={checks.offline}
                onChange={(e) => setChecks((c) => ({ ...c, offline: e.target.checked }))}
              />
              <span>I stored it somewhere that survives this machine dying</span>
            </label>
            <label className="flex items-start gap-2" htmlFor="export-understand">
              <input
                id="export-understand"
                type="checkbox"
                className="mt-1"
                checked={checks.understand}
                onChange={(e) =>
                  setChecks((c) => ({ ...c, understand: e.target.checked }))
                }
              />
              <span>I understand losing the key means losing access to ciphertext</span>
            </label>
          </div>

          <AlertDialogFooter>
            <Button type="button" variant="ghost" onClick={requestDismiss}>
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ConfirmActionDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        hideTrigger
        title="Close without acknowledging the export?"
        description="This key has not been marked as exported. You can export it later from the key list, but until you do, losing this instance means losing access to encrypted backups."
        confirmLabel="Close without saving"
        variant="destructive"
        onConfirm={onDismiss}
      />
    </>
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
  const [confirmGenerate, setConfirmGenerate] = useState(false)

  const keys = enc.status?.keys ?? []
  const recovery = enc.status?.recoveryRecipients ?? []
  const configured = Boolean(enc.status?.configured)
  const activeKey = keys.find((key) => key.status === "active")
  const stepUpReady = !hasPassword || vaultPassword.length > 0

  async function vaultStepUp(): Promise<VaultStepUpFields> {
    if (hasPassword) return { currentPassword: vaultPassword }
    if (hasPasskeys) return performVaultPasskeyStepUp()
    return {}
  }

  async function generateKey() {
    const result = await enc.generate.mutateAsync(await vaultStepUp())
    setRevealed(result)
    toast.success("New encryption key created — save the private key")
  }

  async function revealKey(key: PublicAgeKey) {
    const result = await enc.reveal.mutateAsync({
      keyId: key.id,
      ...(await vaultStepUp()),
    })
    setRevealed(result)
  }

  async function setActiveKey(key: PublicAgeKey) {
    await enc.setActive.mutateAsync({
      keyId: key.id,
      ...(await vaultStepUp()),
    })
  }

  async function setKeyStatus(key: PublicAgeKey, status: "retired" | "compromised") {
    await enc.setStatus.mutateAsync({
      keyId: key.id,
      status,
      ...(await vaultStepUp()),
    })
  }

  async function deleteKey(key: PublicAgeKey) {
    await enc.deleteKey.mutateAsync({
      keyId: key.id,
      ...(await vaultStepUp()),
    })
  }

  function keyMenuItems(key: PublicAgeKey): OverflowItem[] {
    const items: OverflowItem[] = []
    if (key.status !== "active" && key.status !== "compromised") {
      items.push({
        type: "action",
        label: "Set as active key",
        onSelect: () => {
          void setActiveKey(key).catch(() => {
            /* toast in hook */
          })
        },
      })
    }
    if (key.status === "retired") {
      items.push({
        type: "action",
        label: "Mark as compromised",
        onSelect: () => {
          void setKeyStatus(key, "compromised").catch(() => {
            /* toast in hook */
          })
        },
      })
    }
    if (key.status === "compromised") {
      items.push({
        type: "action",
        label: "Mark as retired",
        onSelect: () => {
          void setKeyStatus(key, "retired").catch(() => {
            /* toast in hook */
          })
        },
      })
    }
    if (items.length > 0) items.push({ type: "separator" })
    if (key.status === "active") {
      items.push({
        type: "action",
        label: "Delete (activate another key first)",
        disabled: true,
        onSelect: () => {},
      })
    } else {
      items.push({
        type: "delete",
        title: `Delete the encryption key “${key.label}”?`,
        description:
          "Permanently deletes this private key from the vault. Encrypted backups that only use this key cannot be restored. This cannot be undone.",
        isDeleting:
          enc.deleteKey.isPending && enc.deleteKey.variables?.keyId === key.id,
        onDelete: () => {
          void deleteKey(key).catch(() => {
            /* toast in hook */
          })
        },
      })
    }
    return items
  }

  return (
    <Card id="encryption" className="w-full scroll-mt-24">
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
      <CardContent>
        <QueryState
          query={{
            data: enc.status,
            isLoading: enc.isLoading,
            isFetching: enc.isFetching,
            isError: enc.isError,
            error: enc.error,
            refetch: enc.refetch,
          }}
          dataLabel="encryption status"
          isDataEmpty={() => false}
          errorMessage="Couldn’t load encryption status"
        >
          <div className="space-y-6">
        {enc.status?.needsExportAck && (
          <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
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

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <LoadingButton
              type="button"
              isLoading={enc.generate.isPending}
              disabled={!stepUpReady}
              onClick={() => {
                if (configured) {
                  setConfirmGenerate(true)
                  return
                }
                void generateKey().catch(() => {
                  /* toast in hook */
                })
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
          <p className="text-xs text-muted-foreground">
            New backups encrypt to the active key. Older keys stay in the vault
            so existing backups can still be restored.
          </p>
        </div>

        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No keys yet. Generate one to use encrypted backups or Bro Space.
          </p>
        ) : (
          <div className="space-y-3">
            {keys.map((key) => (
              <div key={key.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{key.label}</span>
                    <Badge variant={statusVariant(key.status)}>{key.status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <LoadingButton
                      type="button"
                      size="sm"
                      variant="outline"
                      isLoading={
                        enc.reveal.isPending &&
                        enc.reveal.variables?.keyId === key.id
                      }
                      disabled={!stepUpReady}
                      onClick={() => {
                        void revealKey(key).catch(() => {
                          /* toast in hook */
                        })
                      }}
                    >
                      Show private key
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
                      Download passphrase-protected copy
                    </Button>
                    <OverflowMenu items={keyMenuItems(key)} />
                  </div>
                </div>

                <div className="flex gap-2">
                  <Input
                    readOnly
                    aria-label={`Public recipient for ${key.label}`}
                    value={key.recipient}
                    className="font-mono text-xs"
                  />
                  <CopyButton
                    value={key.recipient}
                    label={`Recipient for ${key.label}`}
                    iconOnly
                    variant="outline"
                    size="icon"
                  />
                </div>

                {key.status === "active" && (
                  <p className="text-xs text-muted-foreground">
                    Active key — it can’t be deleted. Create or activate another
                    key first.
                  </p>
                )}
                {key.status === "compromised" && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Marked compromised — it can’t be activated for new backups.
                  </p>
                )}
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
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor="wrapPassphrase">Passphrase for wrapped export</Label>
            <Input
              id="wrapPassphrase"
              type="password"
              autoComplete="new-password"
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
          <h4 className="font-medium">Import existing identity</h4>
          <p className="text-sm text-muted-foreground">
            Add an existing age private key to the vault and make it active.
          </p>
          <Label htmlFor="importLabel">Label (optional)</Label>
          <Input
            id="importLabel"
            placeholder="e.g. Imported 2026 key"
            value={importLabel}
            onChange={(e) => setImportLabel(e.target.value)}
          />
          <Label htmlFor="importIdentity">Private identity</Label>
          <textarea
            id="importIdentity"
            aria-describedby="importIdentityHelp"
            className="min-h-[72px] w-full rounded-md border bg-background p-2 font-mono text-xs"
            placeholder="AGE-SECRET-KEY-1…"
            value={importValue}
            onChange={(e) => setImportValue(e.target.value)}
          />
          <p id="importIdentityHelp" className="text-xs text-muted-foreground">
            Must be an age identity starting with <code>AGE-SECRET-KEY-1</code>.
          </p>
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
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">
                    {r.recipient}
                  </code>
                  <ConfirmActionDialog
                    title={`Remove the recovery recipient “${r.label}”?`}
                    description="New backups will no longer be encrypted to this key. Existing backups that used it still need its private key to restore."
                    confirmLabel="Remove recipient"
                    pendingLabel="Removing…"
                    variant="destructive"
                    onConfirm={async () => {
                      await enc.deleteRecovery.mutateAsync({
                        id: r.id,
                        ...(await vaultStepUp()),
                      })
                    }}
                    disabled={!stepUpReady}
                  >
                    <Button type="button" size="sm" variant="destructive" disabled={!stepUpReady}>
                      Remove
                    </Button>
                  </ConfirmActionDialog>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Label htmlFor="recoveryLabel">Recipient label</Label>
            <Input
              id="recoveryLabel"
              placeholder="e.g. Paper copy"
              value={recoveryLabel}
              onChange={(e) => setRecoveryLabel(e.target.value)}
            />
            <Label htmlFor="recoveryRecipient">Public key (age1…)</Label>
            <Input
              id="recoveryRecipient"
              placeholder="age1…"
              className="font-mono text-xs"
              value={recoveryRecipient}
              onChange={(e) => setRecoveryRecipient(e.target.value)}
            />
          </div>
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
          </div>
        </QueryState>
      </CardContent>

      <ConfirmActionDialog
        open={confirmGenerate}
        onOpenChange={setConfirmGenerate}
        hideTrigger
        title="Create a new encryption key?"
        description={
          <>
            New backups will immediately encrypt to the new key.{" "}
            <strong>{activeKey?.label ?? "The current active key"}</strong> will be
            retired and kept only so existing backups can be decrypted.
          </>
        }
        confirmLabel="Create new key"
        pendingLabel="Creating…"
        onConfirm={generateKey}
      />

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
