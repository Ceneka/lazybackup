"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { S3ProfileForm } from "@/components/s3-profile-form"
import { DataState } from "@/components/ui/data-state"
import { ApiError, readApiError } from "@/lib/api/client-error"
import { s3ProfileKeys, useS3Profile, type S3ProfileInput } from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

export default function EditS3ProfilePage() {
  const params = useParams()
  const id = params.id as string
  const router = useRouter()
  const queryClient = useQueryClient()
  const profileQuery = useS3Profile(id)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const notFound =
    profileQuery.isError &&
    profileQuery.error instanceof ApiError &&
    profileQuery.error.status === 404
  const fetchError =
    profileQuery.isError && !notFound
      ? profileQuery.error instanceof Error
        ? profileQuery.error.message
        : "Failed to fetch S3 profile"
      : null

  async function handleSubmit(data: S3ProfileInput) {
    setSubmitting(true)
    setFormError(null)
    setFieldErrors({})
    try {
      const response = await fetch(`/api/s3-profiles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const { message, fieldErrors } = await readApiError(response)
        setFormError(message)
        setFieldErrors(fieldErrors)
        return
      }
      await queryClient.invalidateQueries({ queryKey: s3ProfileKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: s3ProfileKeys.detail(id) })
      toast.success("S3 profile updated")
      router.push(`/s3-profiles/${id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResourceEditLayout
      backHref={`/s3-profiles/${id}`}
      backLabel="Back to S3 profile"
      title="Edit S3 profile"
    >
      <DataState
        isLoading={profileQuery.isLoading}
        error={fetchError}
        isEmpty={notFound}
        emptyMessage="S3 profile not found"
        emptyDescription="The profile you're trying to edit doesn't exist or has been deleted."
        emptyAction={
          <Link
            href="/connections?tab=s3"
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Back to S3 profiles
          </Link>
        }
        onRetry={() => void profileQuery.refetch()}
        isRetrying={profileQuery.isFetching}
      >
        {profileQuery.data ? (
          <S3ProfileForm
            initial={{
              name: profileQuery.data.name,
              endpoint: profileQuery.data.endpoint,
              region: profileQuery.data.region,
              bucket: profileQuery.data.bucket,
              accessKeyId: profileQuery.data.accessKeyId,
              secretAccessKey: "",
              forcePathStyle: profileQuery.data.forcePathStyle !== false,
            }}
            submitting={submitting}
            submitLabel="Save changes"
            cancelHref={`/s3-profiles/${id}`}
            hasSecretAccessKey={Boolean(profileQuery.data.hasSecretAccessKey)}
            formError={formError}
            fieldErrors={fieldErrors}
            testStoredProfile={async () => {
              const response = await fetch(`/api/s3-profiles/${id}/test`)
              if (!response.ok) {
                const { message, fieldErrors } = await readApiError(response)
                const error = new ApiError(message, {
                  status: response.status,
                  fieldErrors,
                })
                throw error
              }
            }}
            onSubmit={handleSubmit}
          />
        ) : null}
      </DataState>
    </ResourceEditLayout>
  )
}
