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
  "w-full p-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary"

type S3ProfileFormProps = {
  initial: S3ProfileInput
  submitting: boolean
  submitLabel: string
  onSubmit: (data: S3ProfileInput) => Promise<void>
}

export function S3ProfileForm({
  initial,
  submitting,
  submitLabel,
  onSubmit,
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
      await testS3ProfileConnection(formData)
      toast.success("S3 connection OK")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "S3 connection failed")
    } finally {
      setTesting(false)
    }
  }

  return (
    <form
      className="space-y-4 max-w-xl"
      onSubmit={(e) => {
        e.preventDefault()
        void onSubmit(formData)
      }}
    >
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="s3-name">
          Name
        </label>
        <input
          id="s3-name"
          className={inputClass}
          value={formData.name}
          onChange={(e) => updateField("name", e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="s3-endpoint">
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
        <p className="text-xs text-muted-foreground">
          MinIO, Cloudflare R2, Backblaze B2, AWS, or any S3-compatible endpoint.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="s3-region">
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
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="s3-bucket">
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
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="s3-access">
          Access key ID
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
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="s3-secret">
          Secret access key
        </label>
        <input
          id="s3-secret"
          type="password"
          className={inputClass}
          value={formData.secretAccessKey}
          onChange={(e) => updateField("secretAccessKey", e.target.value)}
          required
          autoComplete="new-password"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={formData.forcePathStyle}
          onChange={(e) => updateField("forcePathStyle", e.target.checked)}
        />
        Force path-style URLs (recommended for MinIO)
      </label>
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
  )
}
