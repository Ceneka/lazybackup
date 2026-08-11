"use client"

import { S3ProfileForm } from "@/components/s3-profile-form"
import { s3ProfileKeys, type S3ProfileInput } from "@/lib/hooks/useS3Profiles"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowLeftIcon } from "lucide-react"
import Link from "next/link"
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
    <div className="space-y-6">
      <div className="flex items-center space-x-2">
        <Link
          href="/s3-profiles"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          <span className="sr-only">Back to S3 profiles</span>
        </Link>
        <h1 className="text-3xl font-bold">Add S3 Profile</h1>
      </div>
      <S3ProfileForm
        initial={empty}
        submitting={submitting}
        submitLabel="Create Profile"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
