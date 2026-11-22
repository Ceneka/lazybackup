"use client"

import {
  ConnectionTestResultPanel,
  type ConnectionTestOutcome,
} from "@/components/connections/connection-test-result"
import { FieldError } from "@/components/connections/form-controls"
import { SSHKeyBootstrap } from "@/components/ssh-key-bootstrap"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { ApiError } from "@/lib/api/client-error"
import {
  testGitRepoConnection,
  type GitRepoInput,
} from "@/lib/hooks/useGitRepos"
import { useSSHKeys } from "@/lib/hooks/useSSHKeys"
import Link from "next/link"
import { useState } from "react"

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

type GitRepoFormProps = {
  initial: GitRepoInput
  submitting: boolean
  submitLabel: string
  cancelHref: string
  onSubmit: (data: GitRepoInput) => Promise<void>
  testStoredRepo?: () => Promise<void>
  /** Submit error from the parent page (already parsed by readApiError). */
  formError?: string | null
  /** Per-field validation messages from the parent page. */
  fieldErrors?: Record<string, string>
}

function looksLikeSshUrl(url: string) {
  const trimmed = url.trim()
  return trimmed.startsWith("ssh://") || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(trimmed)
}

function normalized(data: GitRepoInput): GitRepoInput {
  return {
    name: data.name.trim(),
    url: data.url.trim(),
    sshKeyId: data.sshKeyId?.trim() || null,
  }
}

export function GitRepoForm({
  initial,
  submitting,
  submitLabel,
  cancelHref,
  onSubmit,
  testStoredRepo,
  formError,
  fieldErrors,
}: GitRepoFormProps) {
  const sshKeysQuery = useSSHKeys(false)
  const keys = sshKeysQuery.keys as Array<{ id: string; name: string }>
  const [formData, setFormData] = useState<GitRepoInput>({
    name: initial.name,
    url: initial.url,
    sshKeyId: initial.sshKeyId,
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestOutcome | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testFieldErrors, setTestFieldErrors] = useState<Record<string, string>>({})
  const needsKey = looksLikeSshUrl(formData.url)
  const errors = { ...fieldErrors, ...testFieldErrors }

  function clearTestState() {
    setTestResult(null)
    setTestError(null)
    setTestFieldErrors({})
  }

  function updateField<K extends keyof GitRepoInput>(key: K, value: GitRepoInput[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }))
    clearTestState()
  }

  async function handleTest() {
    clearTestState()
    setTesting(true)
    try {
      const data = normalized(formData)
      setFormData(data)

      const nextErrors: Record<string, string> = {}
      if (!data.name) nextErrors.name = "Name is required"
      if (!data.url) {
        nextErrors.url = "Git URL is required"
      } else if (looksLikeSshUrl(data.url) && !data.sshKeyId) {
        nextErrors.sshKeyId = "Select or create an SSH key for an SSH remote"
      }

      if (Object.keys(nextErrors).length > 0) {
        setTestFieldErrors(nextErrors)
        setTestError("Fix the highlighted fields to test the connection.")
        return
      }

      // Only trust the saved-row test when the URL and key are untouched.
      const canUseStored =
        Boolean(testStoredRepo) &&
        data.url === initial.url.trim() &&
        (data.sshKeyId ?? null) === (initial.sshKeyId ?? null)

      if (canUseStored) {
        await testStoredRepo!()
        setTestResult({
          success: true,
          message: "Git connection OK — saved repository (URL and key unchanged)",
          testedAt: Date.now(),
          testedLabel: `Saved repository · ${data.name}`,
        })
        return
      }

      const result = await testGitRepoConnection(data)
      setTestResult({
        success: true,
        message: result.message
          ? `Git connection OK (${result.message})`
          : "Git connection OK",
        testedAt: Date.now(),
        testedLabel: `Current form values · ${data.name}`,
      })
    } catch (err) {
      if (err instanceof ApiError) setTestFieldErrors(err.fieldErrors)
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "Git connection failed",
        testedAt: Date.now(),
        testedLabel: "Current form values",
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        const data = normalized(formData)
        setFormData(data)
        void onSubmit(data)
      }}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="git-name">
            Name
          </label>
          <input
            id="git-name"
            className={inputClass}
            value={formData.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="my-app"
            required
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "git-name-error" : undefined}
          />
          <FieldError id="git-name-error" message={errors.name} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="git-url">
            Git URL
          </label>
          <input
            id="git-url"
            className={inputClass}
            value={formData.url}
            onChange={(e) => updateField("url", e.target.value)}
            placeholder="git@github.com:org/repo.git"
            required
            autoComplete="off"
            aria-invalid={errors.url ? true : undefined}
            aria-describedby={errors.url ? "git-url-error" : undefined}
          />
          <FieldError id="git-url-error" message={errors.url} />
          <p className="mt-1 text-sm text-muted-foreground">
            SSH (<code>git@host:org/repo.git</code> or <code>ssh://…</code>) or a public HTTPS
            remote. Embedded HTTPS credentials are not supported.
          </p>
        </div>

        <SSHKeyBootstrap
          selectedKeyId={formData.sshKeyId || undefined}
          suggestedName={formData.name || formData.url}
          onKeyGenerated={(key) => updateField("sshKeyId", key.id)}
        />

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="git-ssh-key">
            SSH key
          </label>
          <select
            id="git-ssh-key"
            className={inputClass}
            value={formData.sshKeyId || ""}
            onChange={(e) => updateField("sshKeyId", e.target.value || null)}
            required={needsKey}
            aria-invalid={errors.sshKeyId ? true : undefined}
            aria-describedby={errors.sshKeyId ? "git-ssh-key-error" : undefined}
          >
            <option value="">{needsKey ? "Select an SSH key" : "None (HTTPS)"}</option>
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </select>
          <FieldError id="git-ssh-key-error" message={errors.sshKeyId} />
          <p className="mt-1 text-sm text-muted-foreground">
            Git backups use vault keys only — system SSH keys from Settings are not
            available here.{" "}
            <Link href="/settings?tab=ssh-keys" className="underline">
              Manage keys
            </Link>
            .
          </p>
        </div>
      </div>

      {formError ? (
        <p className="text-sm text-destructive" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="space-y-2">
        <div className="flex space-x-4">
          <Button
            type="button"
            variant="outline"
            disabled={testing || submitting}
            onClick={() => void handleTest()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
        {testError ? (
          <p className="text-sm text-destructive" role="alert">
            {testError}
          </p>
        ) : null}
        {testResult ? <ConnectionTestResultPanel result={testResult} /> : null}
      </div>

      <div className="flex justify-end space-x-4">
        <Button type="button" variant="outline" asChild>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <LoadingButton type="submit" isLoading={submitting} loadingText="Saving…">
          {submitLabel}
        </LoadingButton>
      </div>
    </form>
  )
}
