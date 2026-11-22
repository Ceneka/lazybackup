"use client"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/constants"
import { useAuth } from "@/lib/hooks/useAuth"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"

export function AuthSetupPrompt() {
  const auth = useAuth()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)

  const open =
    Boolean(auth.data) &&
    !auth.data!.authSetupCompleted &&
    !auth.data!.authEnabled

  const handleSkip = async () => {
    try {
      await auth.setup.mutateAsync({ skip: true })
      toast.success("Skipped — you can enable a password later in Settings")
    } catch {
      // toast in hook
    }
  }

  const handleSetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setError(null)
    try {
      await auth.setup.mutateAsync({ password })
      toast.success("Password set — the app is now protected")
      setPassword("")
      setConfirm("")
    } catch {
      // toast in hook
    }
  }

  if (auth.isLoading || !open) {
    return null
  }

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH
  const mismatch = confirm.length > 0 && password !== confirm

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Protect LazyBackup?</AlertDialogTitle>
          <AlertDialogDescription>
            Optionally set a password to lock the dashboard and APIs. You can
            skip now and enable this later in Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form
          onSubmit={(event) => void handleSetPassword(event)}
          className="space-y-3"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="setup-password">Password</Label>
            <Input
              id="setup-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              aria-invalid={passwordTooShort || Boolean(error) || undefined}
              aria-describedby="setup-password-help"
              required
              minLength={MIN_PASSWORD_LENGTH}
            />
            <p id="setup-password-help" className="text-xs text-muted-foreground">
              Use at least {MIN_PASSWORD_LENGTH} characters.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="setup-confirm">Confirm password</Label>
            <Input
              id="setup-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value)
                setError(null)
              }}
              aria-invalid={mismatch || Boolean(error) || undefined}
              aria-describedby="setup-confirm-help"
              required
            />
            <p id="setup-confirm-help" className="text-xs text-muted-foreground">
              Must match the password above.
            </p>
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <LoadingButton
              type="button"
              variant="outline"
              isLoading={
                auth.setup.isPending &&
                !!auth.setup.variables &&
                "skip" in auth.setup.variables
              }
              loadingText="Skipping…"
              disabled={auth.setup.isPending}
              onClick={() => void handleSkip()}
            >
              Skip
            </LoadingButton>
            <LoadingButton
              type="submit"
              isLoading={
                auth.setup.isPending &&
                auth.setup.variables !== undefined &&
                "password" in auth.setup.variables
              }
              loadingText="Saving…"
              disabled={!password || !confirm || auth.setup.isPending}
            >
              Set password
            </LoadingButton>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
