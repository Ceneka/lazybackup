"use client"

import { Logo } from "@/components/logo"
import { ModeToggle } from "@/components/mode-toggle"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/hooks/useAuth"
import { useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useEffect, useState } from "react"

function LoginForm() {
  const auth = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState("")

  useEffect(() => {
    if (!auth.data) return
    if (!auth.data.authEnabled) {
      router.replace("/")
      return
    }
    if (auth.data.authenticated) {
      router.replace(searchParams.get("from") || "/")
    }
  }, [auth.data, router, searchParams])

  const goAfterLogin = () => {
    const from = searchParams.get("from") || "/"
    window.location.assign(from.startsWith("/") ? from : "/")
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await auth.login.mutateAsync(password)
      goAfterLogin()
    } catch {
      // toast handled in hook
    }
  }

  const handlePasskey = async () => {
    try {
      await auth.loginPasskey.mutateAsync()
      goAfterLogin()
    } catch {
      // toast handled in hook
    }
  }

  const hasPassword = auth.data?.hasPassword !== false
  const hasPasskeys = Boolean(auth.data?.hasPasskeys)

  return (
    <div className="relative min-h-[70vh] flex items-center justify-center">
      <div className="absolute right-0 top-0">
        <ModeToggle />
      </div>
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-3 text-center">
          <Logo className="[&_svg]:h-12 [&_svg]:w-12" />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">LazyBackup</h1>
            <p className="text-sm text-muted-foreground">
              {hasPasskeys && !hasPassword
                ? "Sign in with your passkey to continue"
                : "Enter the app password to continue"}
            </p>
          </div>
        </div>

        {hasPasskeys && (
          <LoadingButton
            type="button"
            className="w-full"
            variant={hasPassword ? "outline" : "default"}
            isLoading={auth.loginPasskey.isPending}
            loadingText="Waiting for passkey…"
            onClick={() => void handlePasskey()}
          >
            Sign in with passkey
          </LoadingButton>
        )}

        {hasPassword && (
          <form onSubmit={handleSubmit} className="space-y-4">
            {hasPasskeys && (
              <p className="text-center text-xs text-muted-foreground">or</p>
            )}
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoFocus={!hasPasskeys}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <LoadingButton
              type="submit"
              className="w-full"
              isLoading={auth.login.isPending}
              loadingText="Signing in…"
              disabled={!password}
            >
              Sign in
            </LoadingButton>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[70vh] flex items-center justify-center text-muted-foreground">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
