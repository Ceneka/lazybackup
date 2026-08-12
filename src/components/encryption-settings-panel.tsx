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
import { useEncryption } from "@/lib/hooks/useEncryption"
import { CopyIcon, KeyRoundIcon, ShieldIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

export function EncryptionSettingsPanel() {
  const enc = useEncryption()
  const [importValue, setImportValue] = useState("")
  const [revealedIdentity, setRevealedIdentity] = useState<string | null>(null)

  const configured = Boolean(enc.status?.configured)

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
          encryption. When enabled on a backup, ciphertext is written to the
          destination — local, server, S3, or a bro. Keep a copy of the private
          key; without it you cannot restore.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {configured ? (
          <div className="space-y-2">
            <Label>Public recipient</Label>
            <div className="flex gap-2">
              <Input readOnly value={enc.status?.recipient || ""} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void navigator.clipboard.writeText(enc.status?.recipient || "")
                  toast.success("Recipient copied")
                }}
              >
                <CopyIcon className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Private key is stored on this instance and never shown in the
              settings list. Export it below and store it offline.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No key yet. Generate one to use encrypted backups or Bro Space.
          </p>
        )}

        {revealedIdentity && (
          <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <Label>Private identity (copy now)</Label>
            <textarea
              readOnly
              className="w-full min-h-[80px] rounded-md border bg-background p-2 font-mono text-xs"
              value={revealedIdentity}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(revealedIdentity)
                toast.success("Identity copied")
              }}
            >
              <CopyIcon className="mr-2 h-4 w-4" />
              Copy identity
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <LoadingButton
            type="button"
            isLoading={enc.generate.isPending}
            onClick={async () => {
              try {
                const result = await enc.generate.mutateAsync()
                setRevealedIdentity(result.identity)
                toast.success("Encryption key created — copy the private key now")
              } catch {
                /* toast in hook */
              }
            }}
          >
            <KeyRoundIcon className="mr-2 h-4 w-4" />
            {configured ? "Rotate (new key)" : "Generate key"}
          </LoadingButton>
          {configured && (
            <>
              <LoadingButton
                type="button"
                variant="outline"
                isLoading={enc.reveal.isPending}
                onClick={async () => {
                  try {
                    const result = await enc.reveal.mutateAsync()
                    setRevealedIdentity(result.identity)
                  } catch {
                    /* toast in hook */
                  }
                }}
              >
                Export private key
              </LoadingButton>
              <LoadingButton
                type="button"
                variant="destructive"
                isLoading={enc.clear.isPending}
                onClick={async () => {
                  if (
                    !confirm(
                      "Delete the encryption key? Encrypted backups cannot be restored without it."
                    )
                  ) {
                    return
                  }
                  try {
                    await enc.clear.mutateAsync()
                    setRevealedIdentity(null)
                    toast.success("Encryption key removed")
                  } catch {
                    /* toast in hook */
                  }
                }}
              >
                Delete key
              </LoadingButton>
            </>
          )}
        </div>

        <div className="space-y-2 border-t pt-4">
          <Label htmlFor="importIdentity">Import existing identity</Label>
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
            disabled={!importValue.trim()}
            onClick={async () => {
              try {
                await enc.importKey.mutateAsync(importValue.trim())
                setImportValue("")
                setRevealedIdentity(null)
                toast.success("Encryption key imported")
              } catch {
                /* toast in hook */
              }
            }}
          >
            Import key
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  )
}
