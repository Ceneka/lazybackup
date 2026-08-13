"use client"

import { ResourceEditLayout } from "@/components/resource-detail-layout"
import { S3ProfileForm } from "@/components/s3-profile-form"
import { s3ProfileKeys, type S3ProfileInput } from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

const empty: S3ProfileInput = {
  name: "",
  endpoint: "",
  region: "us-east-1",
  bucket: "",
  accessKeyId: "",
  secretAccessKey: "",
  forcePathStyle: true,
}

export default function NewS3ProfilePage() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(data: S3ProfileInput) {
    setSubmitting(true)
    try {
      const response = await fetch("/api/s3-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      const body = await response.json()
      if (!response.ok) {
        throw new Error(body.error || "Failed to create profile")
      }
      await queryClient.invalidateQueries({ queryKey: s3ProfileKeys.lists() })
      toast.success("S3 profile created")
      router.push("/s3-profiles")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create profile")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ResourceEditLayout
      backHref="/s3-profiles"
      backLabel="Back to S3 profiles"
      title="Add S3 Profile"
    >
      <S3ProfileForm
        initial={empty}
        submitting={submitting}
        submitLabel="Add Profile"
        cancelHref="/s3-profiles"
        onSubmit={handleSubmit}
      />
    </ResourceEditLayout>
  )
}
