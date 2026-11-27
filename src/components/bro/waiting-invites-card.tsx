"use client"

import { CopyIcon, MailIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { ManualCopyDialog } from "@/components/bro/manual-copy-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getInviteExpiry } from "@/lib/bro/invite-lifecycle"
import { buildInviteMessage } from "@/lib/bro/invite-message"
import { recallInviteFriendName } from "@/lib/bro/invite-names"
import { copyText } from "@/lib/clipboard"
import type { PeerInviteSummary } from "@/lib/hooks/usePeers"

export type WaitingInvitesCardProps = {
  invites: PeerInviteSummary[]
  onNewInvite: () => void
  onCancel: (inviteId: string) => void | Promise<unknown>
  cancelling?: boolean
}

/**
 * Pending/expired invites that were not completed in the wizard.
 * Expiry is derived from `expiresAt` (the API can still return "pending").
 */
export function WaitingInvitesCard({
  invites,
  onNewInvite,
  onCancel,
  cancelling,
}: WaitingInvitesCardProps) {
  const [manualCopy, setManualCopy] = useState<{
    title: string
    text: string
  } | null>(null)

  const pending = invites.filter((invite) => invite.status === "pending")
  if (!pending.length) return null

  const copyMessage = async (invite: PeerInviteSummary) => {
    const friendName = recallInviteFriendName(invite.code) ?? "there"
    const message = buildInviteMessage({
      friendName,
      inviteCode: invite.code,
      quotaGb: invite.quotaGb,
      expiresAt: invite.expiresAt,
    })
    const ok = await copyText(message)
    if (ok) {
      toast.success("Invite message copied")
      return
    }
    setManualCopy({ title: "Copy invite message", text: message })
    toast.info("Copy didn’t work automatically. Select the text below.")
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MailIcon className="h-5 w-5" />
            Waiting for a friend to accept
          </CardTitle>
          <CardDescription>
            These invites are still valid. Copy the message again if your friend
            lost it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {pending.map((invite) => {
            const expiry = getInviteExpiry(invite.expiresAt)
            const friendName = recallInviteFriendName(invite.code)
            return (
              <div key={invite.id} className="space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {friendName ? `Invite for ${friendName}` : "Invite"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {invite.quotaGb} GB each way · {expiry.label}
                    </p>
                  </div>
                  <Badge variant={expiry.expired ? "secondary" : "outline"}>
                    {expiry.expired ? "Expired" : "Waiting"}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={expiry.expired}
                    onClick={() => void copyMessage(invite)}
                  >
                    <CopyIcon className="h-4 w-4" />
                    Copy message
                  </Button>
                  {expiry.expired ? (
                    <Button type="button" size="sm" onClick={onNewInvite}>
                      New invite
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={cancelling}
                    onClick={() => void onCancel(invite.id)}
                  >
                    {expiry.expired ? "Remove" : "Cancel"}
                  </Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <ManualCopyDialog
        open={Boolean(manualCopy)}
        onOpenChange={(next) => {
          if (!next) setManualCopy(null)
        }}
        title={manualCopy?.title ?? "Copy invite"}
        text={manualCopy?.text ?? ""}
      />
    </>
  )
}
