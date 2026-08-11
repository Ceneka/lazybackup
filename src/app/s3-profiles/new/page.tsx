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
      <div className="flex items-center gap-3">
        <Link href="/s3-profiles" className="text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="h-5 w-5" />
        </Link>
        <h1 className="text-2xl font-bold">Add S3 profile</h1>
      </div>
      <S3ProfileForm
        initial={empty}
        submitting={submitting}
        submitLabel="Create profile"
        onSubmit={handleSubmit}
      />
    </div>
  )
}
