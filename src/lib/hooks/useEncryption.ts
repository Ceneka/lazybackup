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
  stepUpToken?: string
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

export async function performVaultPasskeyStepUp(): Promise<VaultStepUpFields> {
  const { startAuthentication } = await import("@simplewebauthn/browser")
  const optionsResponse = await fetch("/api/auth/webauthn/step-up")
  if (!optionsResponse.ok) {
    throw new Error(await parseError(optionsResponse, "Failed to start passkey verification"))
  }
  const response = await startAuthentication({
    optionsJSON: await optionsResponse.json(),
  })
  const verifyResponse = await fetch("/api/auth/webauthn/step-up", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response }),
  })
  if (!verifyResponse.ok) {
    throw new Error(await parseError(verifyResponse, "Passkey verification failed"))
  }
  const result = (await verifyResponse.json()) as { stepUpToken: string }
  return { stepUpToken: result.stepUpToken }
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
        stepUpToken: args.stepUpToken,
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
        stepUpToken: args.stepUpToken,
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
        stepUpToken: args.stepUpToken,
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
    mutationFn: (args: { keyId: string } & VaultStepUpFields) =>
      postAction<{ key: PublicAgeKey }>({ action: "setActive", ...args }),
    onSuccess: () => {
      invalidate()
      toast.success("Active encryption key updated")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const setStatus = useMutation({
    mutationFn: (
      args: { keyId: string; status: "retired" | "compromised" } & VaultStepUpFields
    ) =>
      postAction<{ key: PublicAgeKey }>({
        action: "setStatus",
        ...args,
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
    mutationFn: (args: { keyId: string } & VaultStepUpFields) =>
      postAction<{ ok: boolean }>({ action: "deleteKey", ...args }),
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
        stepUpToken: args.stepUpToken,
      }),
    onSuccess: () => {
      invalidate()
      toast.success("Recovery recipient added")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteRecovery = useMutation({
    mutationFn: (args: { id: string } & VaultStepUpFields) =>
      postAction<{ ok: boolean }>({ action: "deleteRecovery", ...args }),
    onSuccess: () => {
      invalidate()
      toast.success("Recovery recipient removed")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const clear = useMutation({
    mutationFn: (args: VaultStepUpFields) =>
      postAction<{ configured: boolean }>({ action: "clear", ...args }),
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
