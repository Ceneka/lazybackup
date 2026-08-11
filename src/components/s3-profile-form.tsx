"use client"

import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  testS3ProfileConnection,
  type S3ProfileInput,
} from "@/lib/hooks/useS3Profiles"
import { useState } from "react"
import { toast } from "sonner"

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

type S3ProfileFormProps = {
  initial: S3ProfileInput
  submitting: boolean
  submitLabel: string
  onSubmit: (data: S3ProfileInput) => Promise<void>
  /** When editing, secret may already be stored — blank keeps it */
  hasSecretAccessKey?: boolean
  /** Test using credentials already in the DB (edit form with blank secret) */
  testStoredProfile?: () => Promise<void>
}

export function S3ProfileForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
  hasSecretAccessKey = false,
  testStoredProfile,
}: S3ProfileFormProps) {
  const [formData, setFormData] = useState<S3ProfileInput>(initial)
  const [testing, setTesting] = useState(false)

  function updateField<K extends keyof S3ProfileInput>(
    key: K,
    value: S3ProfileInput[K]
  ) {
    setFormData((prev) => ({ ...prev, [key]: value }))
  }

  async function handleTest() {
    setTesting(true)
    try {
      if (hasSecretAccessKey && !formData.secretAccessKey.trim()) {
        // Prefer testing with credentials already stored server-side when blank
        if (testStoredProfile) {
          await testStoredProfile()
          toast.success("S3 connection OK")
          return
        }
        toast.error("Enter the secret access key to test connection.")
        return
      }
      await testS3ProfileConnection(formData)
      toast.success("S3 connection OK")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "S3 connection failed")
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-lg border bg-card text-card-foreground shadow">
      <form
        className="space-y-6 p-6"
        onSubmit={(e) => {
          e.preventDefault()
          void onSubmit(formData)
        }}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="s3-name">
              Profile Name
            </label>
            <input
              id="s3-name"
              className={inputClass}
              value={formData.name}
              onChange={(e) => updateField("name", e.target.value)}
              placeholder="My MinIO"
              required
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="s3-endpoint">
              Endpoint URL
            </label>
            <input
              id="s3-endpoint"
              className={inputClass}
              value={formData.endpoint}
              onChange={(e) => updateField("endpoint", e.target.value)}
              placeholder="https://s3.amazonaws.com"
              required
            />
            <p className="mt-1 text-sm text-muted-foreground">
              MinIO, Cloudflare R2, Backblaze B2, AWS, or any S3-compatible endpoint.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="s3-region">
                Region
              </label>
              <input
                id="s3-region"
                className={inputClass}
                value={formData.region}
                onChange={(e) => updateField("region", e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium" htmlFor="s3-bucket">
                Bucket
              </label>
              <input
                id="s3-bucket"
                className={inputClass}
                value={formData.bucket}
                onChange={(e) => updateField("bucket", e.target.value)}
                required
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="s3-access">
              Access Key ID
            </label>
            <input
              id="s3-access"
              className={inputClass}
              value={formData.accessKeyId}
              onChange={(e) => updateField("accessKeyId", e.target.value)}
              required
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="s3-secret">
              Secret Access Key
            </label>
            <input
              id="s3-secret"
              type="password"
              className={inputClass}
              value={formData.secretAccessKey}
              onChange={(e) => updateField("secretAccessKey", e.target.value)}
              required={!hasSecretAccessKey}
              placeholder={hasSecretAccessKey ? "Leave blank to keep existing" : undefined}
              autoComplete="new-password"
            />
            {hasSecretAccessKey && (
              <p className="mt-1 text-sm text-muted-foreground">
                A secret key is stored. Leave blank to keep it, or enter a new one to replace.
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-input"
              checked={formData.forcePathStyle}
              onChange={(e) => updateField("forcePathStyle", e.target.checked)}
            />
            Force path-style URLs (recommended for MinIO)
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <LoadingButton type="submit" isLoading={submitting} loadingText="Saving…">
            {submitLabel}
          </LoadingButton>
          <Button
            type="button"
            variant="outline"
            disabled={testing || submitting}
            onClick={() => void handleTest()}
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>
      </form>
    </div>
  )
}
