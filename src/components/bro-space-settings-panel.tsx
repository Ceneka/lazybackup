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
import { usePeers } from "@/lib/hooks/usePeers"
import { useTailscale } from "@/lib/hooks/useTailscale"
import { CopyIcon, NetworkIcon, UsersIcon } from "lucide-react"
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
  const [baseUrl, setBaseUrl] = useState("")
  const [label, setLabel] = useState("My LazyBackup")
  const [quotaGb, setQuotaGb] = useState("50")
  const [inviteCode, setInviteCode] = useState<string | null>(null)
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

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            Bro Space
          </CardTitle>
          <CardDescription>
            Lend disk space to a friend 1:1. Backups are age-encrypted before they
            leave your machine — your bro only sees opaque blobs and how much
            quota you use. Both instances need a reachable URL (Tailscale, VPN, or
            public HTTPS).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <QueryState query={peers} dataLabel="Bro Space">
            <div className="space-y-2">
              <Label htmlFor="instanceBaseUrl">Your instance URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="instanceBaseUrl"
                  placeholder="https://lazybackup.example.com or http://100.x.x.x:3000"
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
                Your bro&apos;s LazyBackup must be able to open this URL when pairing
                and when storing backups.
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
            For CGNAT / home networks without port forwarding. We do{" "}
            <strong>not</strong> ship Tailscale in the LazyBackup image (~50MB+);
            install it on the host or use the optional compose overlay, then we
            auto-detect your 100.x address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tailscale.isLoading ? (
            <p className="text-sm text-muted-foreground">Checking Tailscale…</p>
          ) : ts?.available ? (
            <div className="space-y-3 rounded-md border p-3 text-sm">
              <div>
                <span className="text-muted-foreground">Status: </span>
                {ts.backendState || "connected"}
                {ts.via !== "none" ? ` (via ${ts.via})` : ""}
              </div>
              {ts.ipv4 && (
                <div>
                  <span className="text-muted-foreground">Tailscale IPv4: </span>
                  <code>{ts.ipv4}</code>
                </div>
              )}
              {ts.dnsName && (
                <div>
                  <span className="text-muted-foreground">MagicDNS: </span>
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
                    Use as instance URL
                  </LoadingButton>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{ts?.hint || "Tailscale not detected."}</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <strong>Host install (best):</strong> install Tailscale on the
                  machine, then mount{" "}
                  <code>/var/run/tailscale</code> into the container (see
                  docker-compose comment).
                </li>
                <li>
                  <strong>Compose overlay:</strong>{" "}
                  <code>
                    docker compose -f docker-compose.yml -f
                    docker-compose.tailscale.yml up -d
                  </code>{" "}
                  with <code>TS_AUTHKEY</code> in <code>.env</code>.
                </li>
              </ul>
            </div>
          )}

          {ts?.cliAvailable && (
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="tsAuthKey">Join with auth key (non-tech bro)</Label>
              <p className="text-xs text-muted-foreground">
                You create a key in the Tailscale admin console, send it to your
                bro; they paste it here (or set <code>TS_AUTHKEY</code> for the
                compose overlay). Requires the <code>tailscale</code> CLI on this
                host — not inside the slim app image.
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invite a bro</CardTitle>
          <CardDescription>
            Pick how many GB you will each lend (same amount both ways). Share the
            invite code — they paste it in Accept below.
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
                setInviteCode(result.inviteCode)
                toast.success("Invite ready — send the code to your bro")
              } catch {
                /* toast in hook */
              }
            }}
          >
            Create invite
          </LoadingButton>

          {inviteCode && (
            <div className="space-y-2 rounded-md border p-3">
              <Label>Invite code (send this)</Label>
              <textarea
                readOnly
                className="w-full min-h-[100px] rounded-md border bg-background p-2 font-mono text-xs"
                value={inviteCode}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(inviteCode)
                  toast.success("Invite code copied")
                }}
              >
                <CopyIcon className="mr-2 h-4 w-4" />
                Copy invite code
              </Button>
            </div>
          )}

          {peers.data?.invites.filter((i) => i.status === "pending").length ? (
            <div className="space-y-2">
              <Label>Pending invites</Label>
              <ul className="space-y-2 text-sm">
                {peers.data.invites
                  .filter((i) => i.status === "pending")
                  .map((i) => (
                    <li
                      key={i.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <span>
                        {i.label} · {i.quotaGb} GB · expires{" "}
                        {new Date(i.expiresAt).toLocaleString()}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => peers.cancelInvite.mutate(i.id)}
                      >
                        Cancel
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accept an invite</CardTitle>
          <CardDescription>
            Paste the code your bro sent. You will lend them the same GB they
            offered you.
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
              className="mt-1 w-full min-h-[100px] rounded-md border bg-background p-2 font-mono text-xs"
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
              peers.acceptInvite.mutate({
                inviteCode: acceptCode.trim(),
                label: acceptLabel.trim() || "LazyBackup",
              })
            }
          >
            Accept &amp; pair
          </LoadingButton>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Paired bros</CardTitle>
          <CardDescription>
            Active peers and how much of their slice they are using on your disk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!peers.data?.peers.length ? (
            <p className="text-sm text-muted-foreground">No peers yet.</p>
          ) : (
            <ul className="space-y-3">
              {peers.data.peers.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-3"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {p.remoteBaseUrl} · {p.status}
                    </div>
                    <div className="text-sm">
                      Using {formatBytes(p.usedBytes)} of {p.quotaGb} GB
                    </div>
                  </div>
                  {p.status === "active" && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Revoke peer ${p.name}?`)) {
                          peers.revokePeer.mutate(p.id)
                        }
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
