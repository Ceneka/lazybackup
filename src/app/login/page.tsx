"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuth } from "@/lib/hooks/useAuth"
import { useRouter, useSearchParams } from "next/navigation"
import { FormEvent, Suspense, useEffect, useState } from "react"
import { Logo } from "@/components/logo"

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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await auth.login.mutateAsync(password)
      const from = searchParams.get("from") || "/"
      // Full navigation so the new session cookie is sent on the next document request
      window.location.assign(from.startsWith("/") ? from : "/")
    } catch {
      // toast handled in hook
    }
  }

  return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-3 text-center">
          <Logo className="[&_svg]:h-12 [&_svg]:w-12" />
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">LazyBackup</h1>
            <p className="text-sm text-muted-foreground">
              Enter the app password to continue
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoFocus
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
