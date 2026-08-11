"use client"

import { QueryState } from "@/components/ui/query-state"
import { useS3Profiles } from "@/lib/hooks/useS3Profiles"
import { CloudIcon, PlusIcon } from "lucide-react"
import Link from "next/link"

export default function S3ProfilesPage() {
  const query = useS3Profiles()

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">S3 profiles</h1>
        <Link
          href="/s3-profiles/new"
          className="inline-flex items-center justify-center rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Add profile
        </Link>
      </div>

      <QueryState
        query={query}
        dataLabel="S3 profiles"
        errorIcon={<CloudIcon className="h-12 w-12 text-red-500" />}
        emptyIcon={<CloudIcon className="h-12 w-12 text-muted-foreground" />}
        emptyMessage="No S3 profiles yet"
      >
        {query.data && query.data.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {query.data.map((profile) => (
              <Link
                key={profile.id}
                href={`/s3-profiles/${profile.id}/edit`}
                className="group block p-6 bg-card text-card-foreground rounded-lg border shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-2">
                  <CloudIcon className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-medium">{profile.name}</h3>
                </div>
                <div className="mt-2 text-sm text-muted-foreground space-y-1">
                  <p className="truncate">{profile.endpoint}</p>
                  <p>
                    Bucket: {profile.bucket} · {profile.region}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </QueryState>
    </div>
  )
}
