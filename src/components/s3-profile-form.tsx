"use client"

import {
  ConnectionTestResultPanel,
  type ConnectionTestOutcome,
} from "@/components/connections/connection-test-result"
import { FieldError, PasswordInput } from "@/components/connections/form-controls"
import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { ApiError } from "@/lib/api/client-error"
import {
  testS3ProfileConnection,
  type S3ProfileInput,
} from "@/lib/hooks/useS3Profiles"
import Link from "next/link"
import { useState } from "react"

const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

type S3ProfileFormProps = {
  initial: S3ProfileInput
  submitting: boolean
  submitLabel: string
  cancelHref: string
  onSubmit: (data: S3ProfileInput) => Promise<void>
  /** When editing, secret may already be stored — blank keeps it */
  hasSecretAccessKey?: boolean
  /** Test using credentials already in the DB (edit form with blank secret) */
  testStoredProfile?: () => Promise<void>
  /** Submit error from the parent page (already parsed by readApiError). */
  formError?: string | null
  /** Per-field validation messages from the parent page. */
  fieldErrors?: Record<string, string>
}

function trimmedInput(data: S3ProfileInput): S3ProfileInput {
  return {
    ...data,
    name: data.name.trim(),
    endpoint: data.endpoint.trim().replace(/\/+$/, ""),
    region: data.region.trim(),
    bucket: data.bucket.trim(),
    accessKeyId: data.accessKeyId.trim(),
    secretAccessKey: data.secretAccessKey.trim(),
  }
}

/** Fields that change which credentials/endpoint are probed (name does not). */
function connectionFieldsDiffer(initial: S3ProfileInput, current: S3ProfileInput) {
  const normalize = (data: S3ProfileInput) => trimmedInput(data)
  const a = normalize(initial)
  const b = normalize(current)
  return (
    a.endpoint !== b.endpoint ||
    a.region !== b.region ||
    a.bucket !== b.bucket ||
    a.accessKeyId !== b.accessKeyId ||
    a.forcePathStyle !== b.forcePathStyle
  )
}

export function S3ProfileForm({
  initial,
  submitting,
  submitLabel,
  cancelHref,
  onSubmit,
  hasSecretAccessKey = false,
  testStoredProfile,
  formError,
  fieldErrors,
}: S3ProfileFormProps) {
  const [formData, setFormData] = useState<S3ProfileInput>({
    ...initial,
    bucket: initial.bucket.trim(),
    endpoint: initial.endpoint.trim(),
    name: initial.name.trim(),
    region: initial.region.trim(),
    accessKeyId: initial.accessKeyId.trim(),
  })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestOutcome | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testFieldErrors, setTestFieldErrors] = useState<Record<string, string>>({})
  const looksLikeR2 = /r2\.cloudflarestorage\.com/i.test(formData.endpoint)
  const errors = { ...fieldErrors, ...testFieldErrors }

  function clearTestState() {
    setTestResult(null)
    setTestError(null)
    setTestFieldErrors({})
  }

  function updateField<K extends keyof S3ProfileInput>(
    key: K,
    value: S3ProfileInput[K]
  ) {
    setFormData((prev) => ({ ...prev, [key]: value }))
    clearTestState()
  }

  async function handleTest() {
    clearTestState()
    setTesting(true)
    try {
      const data = trimmedInput(formData)
      setFormData(data)

      const nextErrors: Record<string, string> = {}
      if (!data.name) nextErrors.name = "Profile name is required"
      if (!data.endpoint) {
        nextErrors.endpoint = "Endpoint URL is required"
      } else {
        try {
          new URL(data.endpoint)
        } catch {
          nextErrors.endpoint = "Endpoint must be a valid URL"
        }
      }
      if (!data.bucket) nextErrors.bucket = "Bucket is required"
      if (!data.accessKeyId) nextErrors.accessKeyId = "Access key ID is required"

      const canUseStored =
        hasSecretAccessKey &&
        !data.secretAccessKey &&
        Boolean(testStoredProfile) &&
        !connectionFieldsDiffer(initial, data)

      if (!data.secretAccessKey && !canUseStored) {
        nextErrors.secretAccessKey = hasSecretAccessKey
          ? "Enter the secret access key to test these changes"
          : "Secret access key is required"
      }

      if (Object.keys(nextErrors).length > 0) {
        setTestFieldErrors(nextErrors)
        setTestError("Fix the highlighted fields to test the connection.")
        return
      }

      if (canUseStored) {
        await testStoredProfile!()
        setTestResult({
          success: true,
          message: "S3 connection OK — saved credentials (visible fields unchanged)",
          testedAt: Date.now(),
          testedLabel: `Saved profile · ${data.name}`,
        })
        return
      }

      const result = await testS3ProfileConnection(data)
      setTestResult({
        success: true,
        message: result.message || "S3 connection OK",
        testedAt: Date.now(),
        testedLabel: `Current form values · ${data.name}`,
      })
    } catch (err) {
      if (err instanceof ApiError) setTestFieldErrors(err.fieldErrors)
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : "S3 connection failed",
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
        const data = trimmedInput(formData)
        setFormData(data)
        void onSubmit(data)
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
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "s3-name-error" : undefined}
          />
          <FieldError id="s3-name-error" message={errors.name} />
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
            aria-invalid={errors.endpoint ? true : undefined}
            aria-describedby={errors.endpoint ? "s3-endpoint-error" : undefined}
          />
          <FieldError id="s3-endpoint-error" message={errors.endpoint} />
          <p className="mt-1 text-sm text-muted-foreground">
            MinIO, Cloudflare R2, Backblaze B2, AWS, or any S3-compatible endpoint.
            {looksLikeR2
              ? " For R2, use the account URL and put the bucket name in Bucket — not in the path."
              : ""}
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
              aria-invalid={errors.region ? true : undefined}
              aria-describedby={errors.region ? "s3-region-error" : undefined}
            />
            <FieldError id="s3-region-error" message={errors.region} />
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
              onBlur={() => updateField("bucket", formData.bucket.trim())}
              required
              aria-invalid={errors.bucket ? true : undefined}
              aria-describedby={errors.bucket ? "s3-bucket-error" : undefined}
            />
            <FieldError id="s3-bucket-error" message={errors.bucket} />
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
            aria-invalid={errors.accessKeyId ? true : undefined}
            aria-describedby={errors.accessKeyId ? "s3-access-error" : undefined}
          />
          <FieldError id="s3-access-error" message={errors.accessKeyId} />
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="s3-secret">
            Secret Access Key
          </label>
          <PasswordInput
            id="s3-secret"
            revealLabel="secret access key"
            value={formData.secretAccessKey}
            onChange={(e) => updateField("secretAccessKey", e.target.value)}
            required={!hasSecretAccessKey}
            placeholder={hasSecretAccessKey ? "Leave blank to keep existing" : undefined}
            autoComplete="new-password"
            aria-invalid={errors.secretAccessKey ? true : undefined}
            aria-describedby={
              errors.secretAccessKey ? "s3-secret-error" : undefined
            }
          />
          <FieldError id="s3-secret-error" message={errors.secretAccessKey} />
          {hasSecretAccessKey && (
            <p className="mt-1 text-sm text-muted-foreground">
              A secret key is stored. Leave blank to keep it, or enter a new one to replace.
              Leave the endpoint, bucket, region, and access key unchanged to test the saved secret.
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
          Force path-style URLs (recommended for MinIO; leave off for Cloudflare R2)
        </label>
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
