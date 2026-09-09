"use client"

import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  testGitRepoConnection,
  type GitRepoInput,
} from "@/lib/hooks/useGitRepos"
import { useSSHKeys } from "@/lib/hooks/useSSHKeys"
import Link from "next/link"
import { useState } from "react"
import { toast } from "sonner"

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

type GitRepoFormProps = {
  initial: GitRepoInput
  submitting: boolean
  submitLabel: string
  cancelHref: string
  onSubmit: (data: GitRepoInput) => Promise<void>
  testStoredRepo?: () => Promise<void>
}

function looksLikeSshUrl(url: string) {
  const trimmed = url.trim()
  return trimmed.startsWith("ssh://") || /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:/.test(trimmed)
}

export function GitRepoForm({
  initial,
  submitting,
  submitLabel,
  cancelHref,
  onSubmit,
  testStoredRepo,
}: GitRepoFormProps) {
  const sshKeysQuery = useSSHKeys(false)
  const keys = sshKeysQuery.keys as Array<{ id: string; name: string }>
  const [formData, setFormData] = useState<GitRepoInput>({
    name: initial.name,
    url: initial.url,
    sshKeyId: initial.sshKeyId,
  })
  const [testing, setTesting] = useState(false)
  const needsKey = looksLikeSshUrl(formData.url)

  function updateField<K extends keyof GitRepoInput>(key: K, value: GitRepoInput[K]) {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  async function handleTest() {
    setTesting(true)
    try {
      const data: GitRepoInput = {
        name: formData.name.trim(),
        url: formData.url.trim(),
        sshKeyId: formData.sshKeyId?.trim() || null,
      }
      setFormData(data)
      if (testStoredRepo && !data.url) {
        await testStoredRepo()
        toast.success("Git connection OK")
        return
      }
      const result = await testGitRepoConnection(data)
      toast.success(result.message ? `Git connection OK (${result.message})` : "Git connection OK")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Git connection failed")
    } finally {
      setTesting(false)
    }
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        const data: GitRepoInput = {
          name: formData.name.trim(),
          url: formData.url.trim(),
          sshKeyId: formData.sshKeyId?.trim() || null,
        }
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
          />
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
          />
          <p className="mt-1 text-sm text-muted-foreground">
            SSH (<code>git@host:org/repo.git</code> or <code>ssh://…</code>) or a public HTTPS
            remote. Embedded HTTPS credentials are not supported.
          </p>
        </div>
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
          >
            <option value="">{needsKey ? "Select an SSH key" : "None (HTTPS)"}</option>
            {keys.map((key) => (
              <option key={key.id} value={key.id}>
                {key.name}
              </option>
            ))}
          </select>
          {keys.length === 0 && (
            <p className="mt-1 text-sm text-muted-foreground">
              <Link href="/settings?tab=ssh-keys" className="underline">
                Add an SSH key in Settings
              </Link>{" "}
              for private remotes.
            </p>
          )}
        </div>
      </div>

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
