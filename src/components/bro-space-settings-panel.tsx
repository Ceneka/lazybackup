"use client"

import {
  NetworkIcon,
  Settings2Icon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react"
import { useEffect, useState } from "react"

import { BroInviteWizard } from "@/components/bro/bro-invite-wizard"
import { PeerHealthCard } from "@/components/bro/peer-health-card"
import { WaitingInvitesCard } from "@/components/bro/waiting-invites-card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { QueryState } from "@/components/ui/query-state"
import { Textarea } from "@/components/ui/textarea"
import { derivePeerStatus } from "@/lib/bro/peer-status"
import { recallOwnerName } from "@/lib/bro/invite-names"
import { TAILSCALE_SETUP_URL } from "@/lib/bro/links"
import { usePeers } from "@/lib/hooks/usePeers"
import { useTailscale } from "@/lib/hooks/useTailscale"

const ONBOARDING_STEPS = [
  {
    title: "Pick an address your friend can reach",
    body: "We detect Tailscale, public, and home-network addresses for you.",
  },
  {
    title: "Send them a LazyBro invite",
    body: "They paste it in the app and choose a folder with free space.",
  },
  {
    title: "Back up to their disk",
    body: "Everything is encrypted before it leaves this machine.",
  },
]

function Onboarding({ onInvite }: { onInvite: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Share a folder with a friend</p>
        <p className="text-sm text-muted-foreground">
          Your friend runs LazyBro on their computer. You keep using LazyBackup
          as usual — backups just land on their disk too.
        </p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-3">
        {ONBOARDING_STEPS.map((item, index) => (
          <li key={item.title} className="space-y-1 rounded-lg border p-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
              {index + 1}
            </span>
            <p className="text-sm font-medium">{item.title}</p>
            <p className="text-xs text-muted-foreground">{item.body}</p>
          </li>
        ))}
      </ol>
      <Button type="button" variant="outline" size="sm" onClick={onInvite}>
        <UserPlusIcon className="h-4 w-4" />
        Invite your first friend
      </Button>
    </div>
  )
}

export function BroSpaceSettingsPanel() {
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardSeed, setWizardSeed] = useState(0)
  const peers = usePeers({ wizardOpen })
  const tailscale = useTailscale()

  const [baseUrl, setBaseUrl] = useState("")
  const [acceptCode, setAcceptCode] = useState("")
  const [acceptLabel, setAcceptLabel] = useState("")
  const [authKey, setAuthKey] = useState("")

  useEffect(() => {
    if (peers.data?.instanceBaseUrl) {
      setBaseUrl(peers.data.instanceBaseUrl)
    }
  }, [peers.data?.instanceBaseUrl])

  useEffect(() => {
    setAcceptLabel((current) => current || recallOwnerName() || "My LazyBackup")
  }, [])

  const now = Date.now()
  const allPeers = peers.data?.peers ?? []
  const activePeers = allPeers.filter((peer) => peer.status === "active")
  const revokedPeers = allPeers.filter((peer) => peer.status === "revoked")
  const onlineCount = activePeers.filter(
    (peer) => derivePeerStatus(peer, now).tone === "online"
  ).length
  const pendingCount = activePeers.reduce(
    (total, peer) => total + (peer.pendingSyncCount ?? 0),
    0
  )
  const invites = peers.data?.invites ?? []
  const ts = tailscale.data

  const renamePeer = async (peerId: string, name: string) => {
    await peers.renamePeer.mutateAsync({ peerId, name })
  }
  const removePeer = async (peerId: string) => {
    await peers.removePeer.mutateAsync(peerId)
  }
  const revokePeer = async (peerId: string) => {
    await peers.revokePeer.mutateAsync(peerId)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5" />
              Bro Space
            </CardTitle>
            <CardDescription>
              Share a folder on a friend’s computer. Everything is encrypted
              before it leaves this machine — your friend can’t open it.
            </CardDescription>
          </div>
          <Button
            type="button"
            className="w-full sm:w-auto"
            onClick={() => setWizardOpen(true)}
          >
            <UserPlusIcon className="h-4 w-4" />
            Invite friend
          </Button>
        </CardHeader>

        <CardContent className="space-y-5">
          <QueryState query={peers} dataLabel="Bro Space">
            {activePeers.length === 0 ? (
              <Onboarding onInvite={() => setWizardOpen(true)} />
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {activePeers.length} friend
                  {activePeers.length === 1 ? "" : "s"}
                  {onlineCount > 0 ? ` · ${onlineCount} online now` : ""}
                  {pendingCount > 0
                    ? ` · ${pendingCount} backup${pendingCount === 1 ? "" : "s"} waiting`
                    : " · No backups waiting"}
                </p>

                <div className="space-y-3">
                  {activePeers.map((peer) => (
                    <PeerHealthCard
                      key={peer.id}
                      peer={peer}
                      onRename={renamePeer}
                      onRemove={removePeer}
                      onRevoke={revokePeer}
                    />
                  ))}
                </div>
              </>
            )}

            {revokedPeers.length > 0 ? (
              <div className="space-y-2 pt-2">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Disconnected friends
                </h3>
                <div className="space-y-3">
                  {revokedPeers.map((peer) => (
                    <PeerHealthCard
                      key={peer.id}
                      peer={peer}
                      onRename={renamePeer}
                      onRemove={removePeer}
                      onRevoke={revokePeer}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </QueryState>
        </CardContent>
      </Card>

      <WaitingInvitesCard
        invites={invites}
        onNewInvite={() => {
          // Start a fresh wizard (drop any previous draft invite state).
          setWizardSeed((seed) => seed + 1)
          setWizardOpen(true)
        }}
        onCancel={(inviteId) => peers.cancelInvite.mutateAsync(inviteId)}
        cancelling={peers.cancelInvite.isPending}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2Icon className="h-5 w-5" />
            Advanced
          </CardTitle>
          <CardDescription>
            Only needed for troubleshooting, Tailscale, or when your friend also
            runs full LazyBackup.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="address">
              <AccordionTrigger>Your LazyBackup address</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  The address your friend’s app uses to find you. The invite
                  wizard normally sets this for you.
                </p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://lazybackup.example.com"
                    aria-label="Your LazyBackup address"
                  />
                  <LoadingButton
                    type="button"
                    isLoading={peers.setBaseUrl.isPending}
                    onClick={() => peers.setBaseUrl.mutate(baseUrl)}
                    disabled={!baseUrl.trim()}
                  >
                    Save
                  </LoadingButton>
                </div>
                <p className="text-xs text-muted-foreground">
                  Current:{" "}
                  {peers.data?.instanceBaseUrl ? (
                    <code className="break-all">
                      {peers.data.instanceBaseUrl}
                    </code>
                  ) : (
                    "not set"
                  )}
                </p>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="accept">
              <AccordionTrigger>
                Pair with another LazyBackup
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Your friend also runs full LazyBackup and sent you an invite.
                  Paste it here. If they use the LazyBro app instead, use{" "}
                  <span className="font-medium text-foreground">Invite friend</span>{" "}
                  above — they paste your invite there.
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="bro-accept-label">
                    Your name (shown to them)
                  </Label>
                  <Input
                    id="bro-accept-label"
                    value={acceptLabel}
                    onChange={(event) => setAcceptLabel(event.target.value)}
                    maxLength={80}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bro-accept-code">Invite code</Label>
                  <Textarea
                    id="bro-accept-code"
                    value={acceptCode}
                    onChange={(event) => setAcceptCode(event.target.value)}
                    placeholder="lb1.…"
                    className="min-h-[100px] font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    It starts with <code>lb1.</code> — paste the whole code.
                  </p>
                </div>
                <LoadingButton
                  type="button"
                  isLoading={peers.acceptInvite.isPending}
                  disabled={!acceptCode.trim()}
                  onClick={() =>
                    peers.acceptInvite.mutate(
                      {
                        inviteCode: acceptCode.trim(),
                        label: acceptLabel.trim() || "My LazyBackup",
                      },
                      { onSuccess: () => setAcceptCode("") }
                    )
                  }
                >
                  Accept &amp; pair
                </LoadingButton>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="tailscale">
              <AccordionTrigger>
                Tailscale (optional)
              </AccordionTrigger>
              <AccordionContent className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Tailscale makes your LazyBackup reachable from anywhere. Your
                  friend must also install Tailscale and join your tailnet.
                </p>

                {tailscale.isLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Checking Tailscale…
                  </p>
                ) : ts?.available ? (
                  <div className="space-y-3 rounded-md border p-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Status: </span>
                      {ts.backendState || "connected"}
                      {ts.via !== "none" ? ` (via ${ts.via})` : ""}
                    </div>
                    {ts.ipv4 ? (
                      <div>
                        <span className="text-muted-foreground">Address: </span>
                        <code>{ts.ipv4}</code>
                      </div>
                    ) : null}
                    {ts.dnsName ? (
                      <div>
                        <span className="text-muted-foreground">Name: </span>
                        <code>{ts.dnsName}</code>
                      </div>
                    ) : null}
                    {ts.suggestedBaseUrl ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="break-all text-xs">
                          {ts.suggestedBaseUrl}
                        </code>
                        <LoadingButton
                          type="button"
                          size="sm"
                          isLoading={tailscale.useSuggestedUrl.isPending}
                          onClick={() =>
                            tailscale.useSuggestedUrl.mutate(undefined, {
                              onSuccess: (data) =>
                                setBaseUrl(data.instanceBaseUrl),
                            })
                          }
                        >
                          Use this address
                        </LoadingButton>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      Tailscale isn’t available on this host.
                    </p>
                    <Button asChild variant="outline" size="sm">
                      <a
                        href={TAILSCALE_SETUP_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <NetworkIcon className="h-4 w-4" />
                        Set up Tailscale
                      </a>
                    </Button>
                    {ts?.hint ? (
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2">
                          Technical details
                        </summary>
                        <p className="mt-1 break-words text-xs text-muted-foreground">
                          {ts.hint}
                        </p>
                      </details>
                    ) : null}
                  </div>
                )}

                {ts?.cliAvailable ? (
                  <div className="space-y-2 border-t pt-4">
                    <Label htmlFor="tsAuthKey">
                      Connect this machine with an auth key
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Paste a key from your Tailscale admin console to bring this
                      host onto your tailnet.
                    </p>
                    <Input
                      id="tsAuthKey"
                      type="password"
                      autoComplete="off"
                      placeholder="tskey-auth-…"
                      value={authKey}
                      onChange={(event) => setAuthKey(event.target.value)}
                    />
                    <LoadingButton
                      type="button"
                      isLoading={tailscale.join.isPending}
                      disabled={!authKey.trim()}
                      onClick={() =>
                        tailscale.join.mutate(authKey.trim(), {
                          onSuccess: (data) => {
                            setAuthKey("")
                            if (data.instanceBaseUrl) {
                              setBaseUrl(data.instanceBaseUrl)
                            }
                          },
                        })
                      }
                    >
                      Connect Tailscale
                    </LoadingButton>
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <BroInviteWizard
        key={wizardSeed}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
      />
    </div>
  )
}
