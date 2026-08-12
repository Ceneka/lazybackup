import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

export type AuthStatus = {
  authEnabled: boolean
  authSetupCompleted: boolean
  authenticated: boolean
  hasPassword?: boolean
  hasPasskeys?: boolean
  passkeyCount?: number
}

export const authStatusKey = ['auth', 'status'] as const

async function fetchAuthStatus(): Promise<AuthStatus> {
  const response = await fetch('/api/auth/status')
  if (!response.ok) {
    throw new Error('Failed to fetch auth status')
  }
  return response.json()
}

export function useAuthStatus() {
  return useQuery({
    queryKey: authStatusKey,
    queryFn: fetchAuthStatus,
  })
}

export function useAuth() {
  const queryClient = useQueryClient()
  const statusQuery = useAuthStatus()

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: authStatusKey })

  const setup = useMutation({
    mutationFn: async (body: { password: string } | { skip: true }) => {
      const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to complete setup')
      }
      return response.json()
    },
    onSuccess: () => {
      invalidate()
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Setup failed')
    },
  })

  const login = useMutation({
    mutationFn: async (password: string) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Login failed')
      }
      return response.json()
    },
    onSuccess: () => {
      invalidate()
      toast.success('Logged in')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Login failed')
    },
  })

  const loginPasskey = useMutation({
    mutationFn: async () => {
      const { startAuthentication } = await import('@simplewebauthn/browser')
      const optRes = await fetch('/api/auth/webauthn/login')
      if (!optRes.ok) {
        const error = await optRes.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to start passkey login')
      }
      const options = await optRes.json()
      const response = await startAuthentication({ optionsJSON: options })
      const verifyRes = await fetch('/api/auth/webauthn/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      })
      if (!verifyRes.ok) {
        const error = await verifyRes.json().catch(() => ({}))
        throw new Error(error.error || 'Passkey login failed')
      }
      return verifyRes.json()
    },
    onSuccess: () => {
      invalidate()
      toast.success('Logged in')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Passkey login failed')
    },
  })

  const logout = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Logout failed')
      }
      return response.json()
    },
    onSuccess: () => {
      invalidate()
      toast.success('Logged out')
      window.location.href = '/login'
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Logout failed')
    },
  })

  const updatePassword = useMutation({
    mutationFn: async (
      body:
        | { action: 'set'; password: string }
        | { action: 'change'; currentPassword: string; password: string }
        | { action: 'remove'; currentPassword: string }
    ) => {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error || 'Failed to update password')
      }
      return response.json() as Promise<{ ok: boolean; authEnabled: boolean }>
    },
    onSuccess: (data, variables) => {
      invalidate()
      if (variables.action === 'remove') {
        toast.success(
          data.authEnabled
            ? 'Password removed — passkeys still protect this instance'
            : 'Password removed — dashboard is unlocked'
        )
      } else {
        toast.success('Password updated')
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update password'
      )
    },
  })

  return {
    ...statusQuery,
    setup,
    login,
    loginPasskey,
    logout,
    updatePassword,
  }
}
