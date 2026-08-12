import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

export type AgeKeyStatus = "active" | "retired" | "compromised"

export type PublicAgeKey = {
  id: string
  label: string
  recipient: string
  status: AgeKeyStatus
  exportAcknowledgedAt: string | Date | null
  createdAt: string | Date
  updatedAt: string | Date
}

export type PublicRecoveryRecipient = {
  id: string
  label: string
  recipient: string
  createdAt: string | Date
}

export type EncryptionStatus = {
  configured: boolean
  recipient: string | null
  activeKeyId: string | null
  keys: PublicAgeKey[]
  recoveryRecipients: PublicRecoveryRecipient[]
  needsExportAck: boolean
  encryptionInUse: boolean
}

export type EncryptionKeyReveal = {
  id: string
  label: string
  recipient: string
  identity: string
}

export type VaultStepUpFields = {
  currentPassword?: string
  confirm?: boolean
}

export const encryptionKeys = {
  all: ["encryption"] as const,
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const err = await res.json().catch(() => ({}))
  return (err as { error?: string }).error || fallback
}

async function fetchStatus(): Promise<EncryptionStatus> {
  const res = await fetch("/api/encryption")
  if (!res.ok) throw new Error(await parseError(res, "Failed to load encryption status"))
  return res.json()
}

async function postAction<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/encryption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res, "Encryption action failed"))
  return res.json()
}

export function useEncryption() {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: encryptionKeys.all,
    queryFn: fetchStatus,
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: encryptionKeys.all })

  const generate = useMutation({
    mutationFn: (args?: { label?: string } & VaultStepUpFields) =>
      postAction<EncryptionKeyReveal>({ action: "generate", ...args }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const importKey = useMutation({
    mutationFn: (args: { identity: string; label?: string } & VaultStepUpFields) =>
      postAction<EncryptionKeyReveal>({
        action: "import",
        identity: args.identity,
        label: args.label,
        currentPassword: args.currentPassword,
        confirm: args.confirm,
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const reveal = useMutation({
    mutationFn: (args: { keyId: string } & VaultStepUpFields) =>
      postAction<EncryptionKeyReveal>({
        action: "reveal",
        keyId: args.keyId,
        currentPassword: args.currentPassword,
        confirm: args.confirm,
      }),
    onError: (e: Error) => toast.error(e.message),
  })

  const exportPassphrase = useMutation({
    mutationFn: (args: { keyId: string; passphrase: string } & VaultStepUpFields) =>
      postAction<{ id: string; filename: string; armored: string }>({
        action: "exportPassphrase",
        keyId: args.keyId,
        passphrase: args.passphrase,
        currentPassword: args.currentPassword,
        confirm: args.confirm,
      }),
    onError: (e: Error) => toast.error(e.message),
  })

  const acknowledgeExport = useMutation({
    mutationFn: (keyId: string) =>
      postAction<{ key: PublicAgeKey }>({ action: "acknowledgeExport", keyId }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const setActive = useMutation({
    mutationFn: (keyId: string) =>
      postAction<{ key: PublicAgeKey }>({ action: "setActive", keyId }),
    onSuccess: () => {
      invalidate()
      toast.success("Active encryption key updated")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setStatus = useMutation({
    mutationFn: (args: { keyId: string; status: "retired" | "compromised" }) =>
      postAction<{ key: PublicAgeKey }>({
        action: "setStatus",
        keyId: args.keyId,
        status: args.status,
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const updateLabel = useMutation({
    mutationFn: (args: { keyId: string; label: string }) =>
      postAction<{ key: PublicAgeKey }>({
        action: "updateLabel",
        keyId: args.keyId,
        label: args.label,
      }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteKey = useMutation({
    mutationFn: (keyId: string) =>
      postAction<{ ok: boolean }>({ action: "deleteKey", keyId }),
    onSuccess: () => {
      invalidate()
      toast.success("Key deleted permanently")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addRecovery = useMutation({
    mutationFn: (args: { label?: string; recipient: string } & VaultStepUpFields) =>
      postAction<{ recipient: PublicRecoveryRecipient }>({
        action: "addRecovery",
        label: args.label,
        recipient: args.recipient,
        currentPassword: args.currentPassword,
        confirm: args.confirm,
      }),
    onSuccess: () => {
      invalidate()
      toast.success("Recovery recipient added")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRecovery = useMutation({
    mutationFn: (id: string) =>
      postAction<{ ok: boolean }>({ action: "deleteRecovery", id }),
    onSuccess: () => {
      invalidate()
      toast.success("Recovery recipient removed")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const clear = useMutation({
    mutationFn: () => postAction<{ configured: boolean }>({ action: "clear" }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    generate,
    importKey,
    reveal,
    exportPassphrase,
    acknowledgeExport,
    setActive,
    setStatus,
    updateLabel,
    deleteKey,
    addRecovery,
    deleteRecovery,
    clear,
  }
}
