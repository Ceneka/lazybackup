"use client"

import { S3ProfileForm } from "@/components/s3-profile-form"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import {
  s3ProfileKeys,
  useDeleteS3Profile,
  useS3Profile,
  type S3ProfileInput,
} from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon, Loader2Icon } from "lucide-react"
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
  const deleteMutation = useDeleteS3Profile()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(data: S3ProfileInput) {
    setSubmitting(true)
    try {
      const response = await fetch(`/api/s3-profiles/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to update profile")
      }
      await queryClient.invalidateQueries({ queryKey: s3ProfileKeys.lists() })
      await queryClient.invalidateQueries({ queryKey: s3ProfileKeys.detail(id) })
      toast.success("S3 profile updated")
      router.push("/s3-profiles")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update profile")
    } finally {
      setSubmitting(false)
    }
  }

  if (profileQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (!profileQuery.data) {
    return (
      <div className="py-8 text-center">
        <h2 className="text-2xl font-bold">S3 profile not found</h2>
        <p className="mt-2 mb-4 text-muted-foreground">
          The profile you&apos;re trying to edit doesn&apos;t exist or has been deleted.
        </p>
        <Link
          href="/s3-profiles"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Back to S3 Profiles
        </Link>
      </div>
    )
  }

  const profile = profileQuery.data
  const initial: S3ProfileInput = {
    name: profile.name,
    endpoint: profile.endpoint,
    region: profile.region,
    bucket: profile.bucket,
    accessKeyId: profile.accessKeyId,
    secretAccessKey: profile.secretAccessKey,
    forcePathStyle: profile.forcePathStyle !== false,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center space-x-2">
          <Link
            href="/s3-profiles"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            <span className="sr-only">Back to S3 profiles</span>
          </Link>
          <h1 className="text-3xl font-bold">Edit S3 Profile</h1>
        </div>
        <DeleteConfirmationDialog
          title="Delete S3 profile?"
          description="This cannot be undone. Profiles used by backups cannot be deleted."
          isDeleting={deleteMutation.isPending}
          onDelete={() => {
            void deleteMutation.mutateAsync(id).then(() => {
              router.push("/s3-profiles")
            })
          }}
        />
      </div>
      {profile.usedByBackups && profile.usedByBackups.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Used by {profile.usedByBackups.length} backup
          {profile.usedByBackups.length === 1 ? "" : "s"}.
        </p>
      )}
      <S3ProfileForm
        initial={initial}
        submitting={submitting}
        submitLabel="Save Changes"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
