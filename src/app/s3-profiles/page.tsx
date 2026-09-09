import { redirect } from "next/navigation"

export default function S3ProfilesPage() {
  redirect("/connections?tab=s3")
}
