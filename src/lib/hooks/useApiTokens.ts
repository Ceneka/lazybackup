'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type ApiTokenPermission = 'remote_exec'

export type ApiToken = {
  id: string
  name: string
  tokenPrefix: string
  permissions: ApiTokenPermission[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export type CreatedApiToken = ApiToken & { token: string }

export type CreateApiTokenInput = {
  name: string
  permissions?: ApiTokenPermission[]
}

export const apiTokenKeys = {
  all: ['api-tokens'] as const,
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json()
    return data.error || response.statusText
  } catch {
    return response.statusText
  }
}

export function useApiTokens() {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: apiTokenKeys.all,
    queryFn: async (): Promise<ApiToken[]> => {
      const response = await fetch('/api/api-tokens')
      if (!response.ok) throw new Error(await parseError(response))
      return response.json()
    },
  })

  const createToken = useMutation({
    mutationFn: async (input: CreateApiTokenInput): Promise<CreatedApiToken> => {
      const response = await fetch('/api/api-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      if (!response.ok) throw new Error(await parseError(response))
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiTokenKeys.all })
      toast.success('API token created — copy it now, it won’t be shown again')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create token')
    },
  })

  const revokeToken = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/api-tokens/${id}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await parseError(response))
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: apiTokenKeys.all })
      toast.success('Token revoked')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to revoke token')
    },
  })

  return {
    ...query,
    tokens: query.data ?? [],
    createToken,
    revokeToken,
  }
}
