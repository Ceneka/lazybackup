import { redirect } from "next/navigation"

export default function GitReposPage() {
  redirect("/connections?tab=git")
}
