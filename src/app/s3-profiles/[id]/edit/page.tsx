"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { S3ProfileForm } from "@/components/s3-profile-form"
import { s3ProfileKeys, useS3Profile, type S3ProfileInput } from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import { Loader2Icon } from "lucide-react"
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
      router.push(`/s3-profiles/${id}`)
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
    secretAccessKey: "",
    forcePathStyle: profile.forcePathStyle !== false,
  }

  return (
    <ResourceEditLayout
      backHref={`/s3-profiles/${id}`}
      backLabel="Back to S3 profile"
      title="Edit S3 Profile"
    >
      <S3ProfileForm
        initial={initial}
        submitting={submitting}
        submitLabel="Save Changes"
        cancelHref={`/s3-profiles/${id}`}
        hasSecretAccessKey={Boolean(profile.hasSecretAccessKey)}
        testStoredProfile={async () => {
          const response = await fetch(`/api/s3-profiles/${id}/test`)
          const body = await response.json()
          if (!response.ok) {
            throw new Error(body.error || "S3 connection failed")
          }
        }}
        onSubmit={handleSubmit}
      />
    </ResourceEditLayout>
  )
}
