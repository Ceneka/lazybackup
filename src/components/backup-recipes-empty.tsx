"use client"

import {
  DatabaseIcon,
  HardDriveIcon,
  CloudIcon,
  ArrowRightIcon,
  PlusIcon,
} from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

type Recipe = {
  id: string
  title: string
  description: string
  href: string
  icon: ReactNode
  from: string
  to: string
}

const RECIPES: Recipe[] = [
  {
    id: "database-local",
    title: "Database dump → this host",
    description:
      "Logical Postgres/MySQL/MariaDB dump to a local path. Point at a DB on this host or a server.",
    href: "/backups/new?recipe=database-local",
    icon: <DatabaseIcon className="h-5 w-5 text-muted-foreground" />,
    from: "database",
    to: "this host",
  },
  {
    id: "path-s3",
    title: "Path → S3",
    description:
      "Rsync a filesystem path into an S3-compatible bucket (MinIO, R2, B2, AWS).",
    href: "/backups/new?recipe=path-s3",
    icon: <CloudIcon className="h-5 w-5 text-muted-foreground" />,
    from: "path",
    to: "S3",
  },
  {
    id: "instance",
    title: "Instance meta-backup",
    description:
      "Pack this LazyBackup’s SQLite DB, age vault, and SSH keys for disaster recovery.",
    href: "/backups/new?recipe=instance",
    icon: <HardDriveIcon className="h-5 w-5 text-muted-foreground" />,
    from: "this instance",
    to: "path / S3",
  },
]

export function BackupRecipesEmpty() {
  return (
    <div className="space-y-8 py-4">
      <div className="text-center space-y-2">
        <h3 className="text-lg font-medium">No backups yet</h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Start with a common From → To job. Each recipe opens the new-backup form with sensible
          defaults — edit paths and credentials before saving.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {RECIPES.map((recipe) => (
          <Link
            key={recipe.id}
            href={recipe.href}
            className="group flex flex-col gap-3 rounded-lg border p-5 text-left transition-colors hover:bg-accent/40 hover:border-foreground/20"
          >
            <div className="flex items-center gap-2">
              {recipe.icon}
              <span className="font-medium text-sm">{recipe.title}</span>
            </div>
            <p className="text-sm text-muted-foreground flex-1">{recipe.description}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{recipe.from}</span>
              <ArrowRightIcon className="h-3 w-3 shrink-0" />
              <span>{recipe.to}</span>
            </p>
          </Link>
        ))}
      </div>

      <div className="flex justify-center">
        <Link
          href="/backups/new"
          className="inline-flex h-10 items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Start from scratch
        </Link>
      </div>
    </div>
  )
}
