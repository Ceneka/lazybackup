import { redirect } from "next/navigation"

export default function ServersPage() {
  redirect("/connections?tab=servers")
}
