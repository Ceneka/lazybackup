"use client"

import { Logo } from "@/components/logo"
import { ModeToggle } from "@/components/mode-toggle"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { safeInternalPath } from "@/lib/auth/redirect"
import { useAuth } from "@/lib/hooks/useAuth"
import { Loader2Icon } from "lucide-react"
import { useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useEffect, useState } from "react"

const LOGIN_ERROR_ID = "login-error"

function LoginLoading() {
  return (
    <div
      className="flex min-h-[70vh] items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
      <span className="sr-only">Loading sign-in…</span>
    </div>
  )
}

function passkeyErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "NotAllowedError"
  ) {
    return "Passkey sign-in was cancelled"
  }
  if (error instanceof Error && error.message) return error.message
  return "Passkey sign-in failed"
}

function LoginForm() {
  const auth = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [password, setPassword] = useState("")
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!auth.data) return
    if (!auth.data.authEnabled) {
      router.replace("/")
      return
    }
    if (auth.data.authenticated) {
      router.replace(safeInternalPath(searchParams.get("from")))
    }
  }, [auth.data, router, searchParams])

  const goAfterLogin = () => {
    window.location.assign(safeInternalPath(searchParams.get("from")))
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFormError(null)
    try {
      await auth.login.mutateAsync(password)
      goAfterLogin()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Login failed")
    }
  }

  const handlePasskey = async () => {
    setFormError(null)
    try {
      await auth.loginPasskey.mutateAsync()
      goAfterLogin()
    } catch (error) {
      setFormError(passkeyErrorMessage(error))
    }
  }

  // Don't flash the password form (or the passkey layout) before the auth mode
  // is known, and keep a spinner up while a redirect is in flight.
  const status = auth.data
  if (auth.isLoading || !status || !status.authEnabled || status.authenticated) {
    return <LoginLoading />
  }

  const hasPassword = status.hasPassword !== false
  const hasPasskeys = Boolean(status.hasPasskeys)

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
                aria-invalid={formError ? true : undefined}
                aria-describedby={formError ? LOGIN_ERROR_ID : undefined}
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (formError) setFormError(null)
                }}
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

        {formError ? (
          <Alert variant="destructive" id={LOGIN_ERROR_ID}>
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginForm />
    </Suspense>
  )
}
