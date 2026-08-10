import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

// Type definitions
export interface SSHKey {
  id: string
  name: string
  privateKeyPath?: string
  publicKeyPath?: string
  privateKeyContent?: string
  createdAt: string
  updatedAt: string
  isSystemKey?: boolean // Flag to indicate if this is a system key reference
}

export interface SystemSSHKey {
  name: string
  privateKeyPath: string
  publicKeyPath?: string
}

export interface GeneratedSSHKey {
  id: string
  name: string
  publicKey: string
  installCommand: string
  createdAt: string
  updatedAt: string
}

export interface SSHKeyInstallCommand {
  id: string
  name: string
  publicKey: string
  installCommand: string
}

/** Stable helpers — do not recreate inside the hook (breaks useEffect deps). */
export function isSystemKeyId(id: string): boolean {
  return id.startsWith("system:")
}

export function getSystemKeyPathFromId(id: string): string {
  return id.replace(/^system:/, "")
}

// Hook for managing SSH keys
export function useSSHKeys(includeSystem = true) {
  const queryClient = useQueryClient()

  // Fetch SSH keys
  const { data, isLoading, error } = useQuery({
    queryKey: ['ssh-keys', { includeSystem }],
    queryFn: async () => {
      const response = await fetch(`/api/ssh-keys?includeSystem=${includeSystem}`)

      if (!response.ok) {
        throw new Error("Failed to fetch SSH keys")
      }

      return response.json()
    }
  })

  // Add SSH key
  const addKey = useMutation({
    mutationFn: async (keyData: Omit<SSHKey, 'id' | 'createdAt' | 'updatedAt'>) => {
      const response = await fetch('/api/ssh-keys', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(keyData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to add SSH key')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('SSH key added successfully')
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to add SSH key')
    }
  })

  // Generate a new Ed25519 key + install command for the remote host
  const generateKey = useMutation({
    mutationFn: async (name?: string): Promise<GeneratedSSHKey> => {
      const response = await fetch('/api/ssh-keys/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(name ? { name } : {}),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to generate SSH key')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('SSH key generated — paste the install command on the host')
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to generate SSH key')
    }
  })

  // Delete SSH key
  const deleteKey = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/ssh-keys/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete SSH key')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('SSH key deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to delete SSH key')
    }
  })

  // Convert system keys to a format compatible with the UI and selection
  const systemKeysWithIds = data?.systemKeys?.map((key: SystemSSHKey) => ({
    id: `system:${key.privateKeyPath}`, // Use a prefix to distinguish system keys
    name: key.name,
    privateKeyPath: key.privateKeyPath,
    publicKeyPath: key.publicKeyPath,
    isSystemKey: true
  })) || [];

  return {
    keys: data?.storedKeys || [],
    systemKeys: data?.systemKeys || [],
    // Combined keys for selection (both DB and system keys)
    allKeys: [...(data?.storedKeys || []), ...systemKeysWithIds],
    isLoading,
    error,
    addKey,
    generateKey,
    deleteKey,
    isSystemKey: isSystemKeyId,
    getSystemKeyPath: getSystemKeyPathFromId,
  }
}

/** Fetch (or re-derive) the paste-on-host install command for a stored key. */
export async function fetchSSHKeyInstallCommand(
  id: string
): Promise<SSHKeyInstallCommand> {
  const response = await fetch(`/api/ssh-keys/${id}/install-command`)
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.error || 'Failed to load install command')
  }
  return response.json()
}
