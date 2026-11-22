"use client"

import { Button } from "@/components/ui/button"
import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { QueryState } from "@/components/ui/query-state"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import { CopyButton } from "@/components/settings/copy-button"
import { useSecretReveal } from "@/components/settings/secret-reveal"
import { usePeers } from "@/lib/hooks/usePeers"
import { useTailscale } from "@/lib/hooks/useTailscale"
import { NetworkIcon, UsersIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function BroSpaceSettingsPanel() {
  const peers = usePeers()
  const tailscale = useTailscale()
  const { reveal, dismiss } = useSecretReveal()
  const [baseUrl, setBaseUrl] = useState("")
  const [label, setLabel] = useState("My LazyBackup")
  const [quotaGb, setQuotaGb] = useState("50")
  const [createdInvite, setCreatedInvite] = useState<{
    code: string
    expiresAt: string
  } | null>(null)
  const [acceptCode, setAcceptCode] = useState("")
  const [acceptLabel, setAcceptLabel] = useState("My LazyBackup")
  const [authKey, setAuthKey] = useState("")

  useEffect(() => {
    if (peers.data?.instanceBaseUrl) {
      setBaseUrl(peers.data.instanceBaseUrl)
    }
  }, [peers.data?.instanceBaseUrl])

  useEffect(() => {
    if (tailscale.data?.instanceBaseUrl) {
      setBaseUrl(tailscale.data.instanceBaseUrl)
    }
  }, [tailscale.data?.instanceBaseUrl])

  const ts = tailscale.data
  const pendingInvites = (peers.data?.invites ?? []).filter(
    (invite) => invite.status === "pending"
  )
  const pairedPeers = peers.data?.peers ?? []

  const dismissCreatedInvite = (code?: string) => {
    if (!code) return
    dismiss(`bro-invite:${code}`)
    if (createdInvite?.code === code) setCreatedInvite(null)
  }

  return (
    <div className="space-y-6">
      <Card id="bro-space" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Bro Space
          </CardTitle>
          <CardDescription>
            Lend disk space to a friend, one-to-one. Backups are encrypted before
            they leave your machine — your bro only stores sealed files. Send them
            a LazyBro invite; they install the app, paste the code, and share a
            folder.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryState
            query={peers}
            dataLabel="Bro Space"
            transformError={(error) =>
              error instanceof Error ? error.message : "Couldn’t load Bro Space settings"
            }
          >
            <div className="space-y-2">
              <Label htmlFor="instanceBaseUrl">Your LazyBackup address</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="instanceBaseUrl"
                  placeholder="https://lazybackup.example.com"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
                <LoadingButton
                  type="button"
                  isLoading={peers.setBaseUrl.isPending}
                  onClick={() => peers.setBaseUrl.mutate(baseUrl)}
                >
                  Save
                </LoadingButton>
              </div>
              <p className="text-sm text-muted-foreground">
                The link your bro’s app uses to find you. Save this before you
                create an invite.
              </p>
            </div>
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NetworkIcon className="h-5 w-5" />
            Tailscale
          </CardTitle>
          <CardDescription>
            Optional helper if this LazyBackup is hard to reach from the
            internet. Install Tailscale on the machine running LazyBackup, then
            use the suggested address as your LazyBackup address above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryState
            query={tailscale}
            dataLabel="Tailscale status"
            errorMessage="Couldn’t check Tailscale on this machine"
            transformError={(error) =>
              error instanceof Error ? error.message : "Couldn’t check Tailscale"
            }
            isDataEmpty={() => false}
          >
            {ts?.available ? (
              <div className="space-y-3 rounded-md border p-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Status: </span>
                  {ts.backendState || "connected"}
                  {ts.via !== "none" ? ` (via ${ts.via})` : ""}
                </div>
                {ts.ipv4 && (
                  <div>
                    <span className="text-muted-foreground">Address: </span>
                    <code>{ts.ipv4}</code>
                  </div>
                )}
                {ts.dnsName && (
                  <div>
                    <span className="text-muted-foreground">Name: </span>
                    <code>{ts.dnsName}</code>
                  </div>
                )}
                {ts.suggestedBaseUrl && (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs break-all">{ts.suggestedBaseUrl}</code>
                    <LoadingButton
                      type="button"
                      size="sm"
                      isLoading={tailscale.useSuggestedUrl.isPending}
                      onClick={() => {
                        tailscale.useSuggestedUrl.mutate(undefined, {
                          onSuccess: (data) => setBaseUrl(data.instanceBaseUrl),
                        })
                      }}
                    >
                      Use as LazyBackup address
                    </LoadingButton>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {ts?.hint ||
                  "Tailscale not detected on this machine. If friends can’t connect, see the README for setup options."}
              </p>
            )}

            {ts?.cliAvailable && (
              <div className="space-y-2 border-t pt-4">
                <Label htmlFor="tsAuthKey">Connect this machine with an auth key</Label>
                <p className="text-xs text-muted-foreground">
                  Paste a key from your Tailscale admin console to bring this host
                  onto your tailnet.
                </p>
                <Input
                  id="tsAuthKey"
                  type="password"
                  autoComplete="off"
                  placeholder="tskey-auth-…"
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                />
                <LoadingButton
                  type="button"
                  isLoading={tailscale.join.isPending}
                  disabled={!authKey.trim()}
                  onClick={() =>
                    tailscale.join.mutate(authKey.trim(), {
                      onSuccess: (data) => {
                        setAuthKey("")
                        if (data.instanceBaseUrl) setBaseUrl(data.instanceBaseUrl)
                      },
                    })
                  }
                >
                  Connect Tailscale
                </LoadingButton>
              </div>
            )}
          </QueryState>
        </CardContent>
      </Card>

      <Card id="bro-invite" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Invite a bro</CardTitle>
          <CardDescription>
            Choose how much space you’ll each share, then send them the invite.
            They paste it in the LazyBro app (or Accept below if they also run
            LazyBackup). Invite codes expire after 72 hours and are shown only
            once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="inviteLabel">Your name (shown to them)</Label>
              <Input
                id="inviteLabel"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="quotaGb">Quota each way (GB)</Label>
              <Input
                id="quotaGb"
                type="number"
                min={1}
                value={quotaGb}
                onChange={(e) => setQuotaGb(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
          <LoadingButton
            type="button"
            isLoading={peers.createInvite.isPending}
            onClick={async () => {
              try {
                const result = await peers.createInvite.mutateAsync({
                  label: label.trim() || "LazyBackup",
                  quotaGb: Number(quotaGb),
                })
                setCreatedInvite({
                  code: result.inviteCode,
                  expiresAt: result.expiresAt,
                })
                reveal({
                  id: `bro-invite:${result.inviteCode}`,
                  title: "New Bro invite code",
                  description:
                    "Send this to your bro now. It expires automatically, and this banner is discarded when you hide it or leave Settings. You can copy the code again from the pending invite until it is used or cancelled.",
                  value: result.inviteCode,
                  copyLabel: "Invite code",
                  extra: (
                    <p className="text-sm">
                      Expires{" "}
                      <strong>{new Date(result.expiresAt).toLocaleString()}</strong>
                      . You can copy it again from the pending invite below until
                      it is used or cancelled.
                    </p>
                  ),
                })
                toast.success("Invite ready — copy it from the banner at the top")
              } catch {
                /* toast in hook */
              }
            }}
          >
            Create invite
          </LoadingButton>

          <QueryState
            query={{
              data: peers.data ? pendingInvites : undefined,
              isLoading: peers.isLoading,
              isFetching: peers.isFetching,
              isError: peers.isError,
              error: peers.error,
              refetch: peers.refetch,
            }}
            dataLabel="pending invites"
            emptyMessage="No pending invites"
            emptyDescription="Create an invite above and send the code to your bro."
            emptyIcon={<UsersIcon className="h-12 w-12 text-muted-foreground" />}
          >
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Pending invites</h4>
              <ul className="space-y-2 text-sm">
                {pendingInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                  >
                    <div className="min-w-0 space-y-1">
                      <p>
                        {invite.label} · {invite.quotaGb} GB · expires{" "}
                        {new Date(invite.expiresAt).toLocaleString()}
                      </p>
                      {invite.code ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <code className="min-w-0 break-all font-mono text-xs">
                            {invite.code}
                          </code>
                          <CopyButton
                            value={invite.code}
                            label={`Invite code for ${invite.label}`}
                            size="sm"
                            variant="ghost"
                          />
                        </div>
                      ) : null}
                    </div>
                    <ConfirmActionDialog
                      title={`Cancel the invite for “${invite.label}”?`}
                      description="The code stops working immediately and its pending slot is removed. You can create a new invite later."
                      confirmLabel="Cancel invite"
                      pendingLabel="Cancelling…"
                      variant="destructive"
                      onConfirm={async () => {
                        await peers.cancelInvite.mutateAsync(invite.id)
                        dismissCreatedInvite(invite.code)
                      }}
                    >
                      <Button type="button" variant="ghost" size="sm">
                        Cancel
                      </Button>
                    </ConfirmActionDialog>
                  </li>
                ))}
              </ul>
            </div>
          </QueryState>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accept an invite (another LazyBackup)</CardTitle>
          <CardDescription>
            If your friend also runs full LazyBackup, paste their invite here.
            If they use the LazyBro app, they paste your invite there instead.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="acceptLabel">Your name (shown to them)</Label>
            <Input
              id="acceptLabel"
              value={acceptLabel}
              onChange={(e) => setAcceptLabel(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="acceptCode">Invite code</Label>
            <textarea
              id="acceptCode"
              className="mt-1 min-h-[100px] w-full rounded-md border bg-background p-2 font-mono text-xs"
              placeholder="lb1.…"
              value={acceptCode}
              onChange={(e) => setAcceptCode(e.target.value)}
            />
          </div>
          <LoadingButton
            type="button"
            isLoading={peers.acceptInvite.isPending}
            disabled={!acceptCode.trim()}
            onClick={() =>
              peers.acceptInvite.mutate(
                {
                  inviteCode: acceptCode.trim(),
                  label: acceptLabel.trim() || "LazyBackup",
                },
                { onSuccess: () => setAcceptCode("") }
              )
            }
          >
            Accept &amp; pair
          </LoadingButton>
        </CardContent>
      </Card>

      <Card id="bro-peers" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Paired bros</CardTitle>
          <CardDescription>
            Friends you’ve paired with. If someone is offline for a while,
            that’s okay — backups still complete here and sync when they’re back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <QueryState
            query={{
              data: peers.data ? pairedPeers : undefined,
              isLoading: peers.isLoading,
              isFetching: peers.isFetching,
              isError: peers.isError,
              error: peers.error,
              refetch: peers.refetch,
            }}
            dataLabel="peers"
            emptyMessage="No peers yet"
            emptyDescription="Pair with another LazyBackup or a LazyBro app using the invite flow above."
            emptyIcon={<UsersIcon className="h-12 w-12 text-muted-foreground" />}
          >
            <ul className="space-y-3">
              {pairedPeers.map((peer) => (
                <li
                  key={peer.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
                >
                  <div>
                    <div className="font-medium">{peer.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {peer.remoteBaseUrl ? "LazyBackup" : "LazyBro app"}
                      {peer.status !== "active" ? ` · ${peer.status}` : ""}
                    </div>
                    <div className="text-sm">
                      Using {formatBytes(peer.usedBytes)} of {peer.quotaGb} GB
                      {typeof peer.pendingSyncCount === "number" &&
                      peer.pendingSyncCount > 0
                        ? ` · ${peer.pendingSyncCount} waiting to sync`
                        : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last seen:{" "}
                      {peer.lastSeenAt
                        ? new Date(peer.lastSeenAt).toLocaleString()
                        : "not yet"}
                    </div>
                  </div>
                  {peer.status === "active" && (
                    <ConfirmActionDialog
                      title={`Revoke peer “${peer.name}”?`}
                      description="Syncing stops immediately and the pairing token is cleared. Backups already stored on that peer become unreachable from this instance until you pair again. Files already on their disk are not deleted remotely; the usage record stays listed here."
                      confirmLabel="Revoke peer"
                      pendingLabel="Revoking…"
                      variant="destructive"
                      onConfirm={async () => {
                        await peers.revokePeer.mutateAsync(peer.id)
                      }}
                      disabled={peers.revokePeer.isPending}
                    >
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={peers.revokePeer.isPending}
                      >
                        Revoke
                      </Button>
                    </ConfirmActionDialog>
                  )}
                </li>
              ))}
            </ul>
          </QueryState>
        </CardContent>
      </Card>
    </div>
  )
}
