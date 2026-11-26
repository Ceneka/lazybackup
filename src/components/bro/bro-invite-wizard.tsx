"use client"

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CopyIcon,
  GlobeIcon,
  InfoIcon,
  LaptopIcon,
  Loader2Icon,
  MonitorIcon,
  NetworkIcon,
  RefreshCwIcon,
  WifiIcon,
} from "lucide-react"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { BroStepIndicator } from "@/components/bro/bro-step-indicator"
import { LazyBroDownloadLinks } from "@/components/bro/lazybro-download-links"
import { ManualCopyDialog } from "@/components/bro/manual-copy-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  isCandidateUsable,
  normalizeAddressUrl,
  validateAddressInput,
  type AddressCandidate,
  type AddressReach,
} from "@/lib/bro/addresses"
import { formatQuotaGb, buildInviteMessage } from "@/lib/bro/invite-message"
import { getInviteExpiry } from "@/lib/bro/invite-lifecycle"
import {
  recallOwnerName,
  rememberInviteFriendName,
  rememberOwnerName,
} from "@/lib/bro/invite-names"
import { TAILSCALE_SETUP_URL } from "@/lib/bro/links"
import { useBroAddresses } from "@/lib/hooks/useBroAddresses"
import { usePeers } from "@/lib/hooks/usePeers"
import { copyText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

const STEP_ADDRESS = 0
const STEP_FRIEND = 1
const STEP_SEND = 2
const STEP_DONE = 3

const PRESET_QUOTAS = [10, 25, 50, 100] as const
const DEFAULT_QUOTA_GB = 25

type CreatedInvite = {
  code: string
  expiresAt: string
  quotaGb: number
  inviteId?: string
  friendName: string
  /** Snapshot taken before creating the invite, to spot the new peer. */
  knownPeerIds: string[]
}

function reachLabel(reach: AddressReach): string {
  switch (reach) {
    case "tailnet":
      return "Tailscale"
    case "same-network":
      return "This network"
    case "this-computer":
      return "This computer"
    default:
      return "Public address"
  }
}

function reachBadge(reach: AddressReach): string {
  switch (reach) {
    case "tailnet":
      return "Private network"
    case "same-network":
      return "Same Wi-Fi only"
    case "this-computer":
      return "This computer only"
    default:
      return "Works anywhere"
  }
}

function reachIcon(reach: AddressReach) {
  switch (reach) {
    case "tailnet":
      return NetworkIcon
    case "same-network":
      return WifiIcon
    case "this-computer":
      return LaptopIcon
    default:
      return GlobeIcon
  }
}

function preferredFriendName(peerName: string | undefined, fallback: string): string {
  const peer = peerName?.trim()
  if (peer && peer.toLowerCase() !== "lazybro") return peer
  return fallback.trim() || "Your friend"
}

export type BroInviteWizardProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Four-step "Invite a friend" flow: Address → Friend → Send → Done.
 *
 * Step 1 detects reachable addresses, step 2 creates the invite, step 3 gives
 * the host one complete message plus LazyBro downloads, and step 4 appears
 * automatically when the friend pairs (the wizard polls every 3 s).
 */
export function BroInviteWizard({ open, onOpenChange }: BroInviteWizardProps) {
  const peers = usePeers({ wizardOpen: open })
  const addresses = useBroAddresses({ enabled: open })

  const [step, setStep] = useState(STEP_ADDRESS)
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [manualAddress, setManualAddress] = useState("")
  const [useManual, setUseManual] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)

  const [friendName, setFriendName] = useState("")
  const [ownerName, setOwnerName] = useState("")
  const [quotaGb, setQuotaGb] = useState<number>(DEFAULT_QUOTA_GB)
  const [quotaMode, setQuotaMode] = useState<"preset" | "custom">("preset")
  const [customQuota, setCustomQuota] = useState("")
  const [friendError, setFriendError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const [connectedPeerId, setConnectedPeerId] = useState<string | null>(null)
  const [manualCopy, setManualCopy] = useState<{ title: string; text: string } | null>(
    null
  )

  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (!open) return
    setOwnerName((current) => current || recallOwnerName())
  }, [open])

  // If the wizard was closed on the Done step, start fresh next time.
  useEffect(() => {
    if (open && !wasOpenRef.current && step === STEP_DONE) {
      setStep(STEP_ADDRESS)
      setCreated(null)
      setConnectedPeerId(null)
    }
    wasOpenRef.current = open
  }, [open, step])

  const allowPrivate = addresses.data?.allowPrivatePeerUrls ?? false

  // Preselect the saved address when usable, otherwise the first usable
  // detected address. Never preselect loopback.
  useEffect(() => {
    if (!open || step !== STEP_ADDRESS) return
    if (selectedUrl || useManual) return
    const data = addresses.data
    if (!data) return

    const usable = data.candidates.filter((candidate) =>
      isCandidateUsable(candidate, data.allowPrivatePeerUrls)
    )
    const savedUrl = normalizeAddressUrl(data.instanceBaseUrl)
    const saved = savedUrl
      ? data.candidates.find((candidate) => candidate.url === savedUrl)
      : undefined
    const pick =
      saved && isCandidateUsable(saved, data.allowPrivatePeerUrls)
        ? saved
        : usable[0]

    if (pick) setSelectedUrl(pick.url)
    else if (usable.length === 0) setUseManual(true)
  }, [open, step, addresses.data, selectedUrl, useManual])

  const effectiveAddress = useManual ? manualAddress : selectedUrl ?? ""
  const addressValidation = effectiveAddress.trim()
    ? validateAddressInput(effectiveAddress, {
        allowPrivatePeerUrls: allowPrivate,
      })
    : null
  const liveAddressIssue =
    addressValidation && !addressValidation.ok && addressValidation.reach
      ? addressValidation.error
      : null
  const addressIssue = addressError ?? liveAddressIssue

  const effectiveQuotaGb =
    quotaMode === "custom" ? Number(customQuota) : quotaGb
  const quotaValid =
    Number.isFinite(effectiveQuotaGb) &&
    effectiveQuotaGb >= 1 &&
    effectiveQuotaGb <= 100_000
  const quotaLabel = formatQuotaGb(quotaValid ? effectiveQuotaGb : DEFAULT_QUOTA_GB)

  const handleContinueAddress = async () => {
    if (!addressValidation?.ok) {
      setAddressError(
        addressValidation?.error ?? "Choose an address your friend can reach."
      )
      return
    }
    setAddressError(null)
    const current = normalizeAddressUrl(peers.data?.instanceBaseUrl)
    if (addressValidation.url !== current) {
      try {
        await peers.setBaseUrl.mutateAsync(addressValidation.url)
      } catch {
        return
      }
    }
    setStep(STEP_FRIEND)
  }

  const handleCreateInvite = async () => {
    const friend = friendName.trim()
    if (!friend) {
      setFriendError("Enter your friend’s name.")
      return
    }
    if (!quotaValid) {
      setFriendError("Choose how much space to share (1 to 100000 GB).")
      return
    }
    setFriendError(null)

    const label = ownerName.trim() || "My LazyBackup"
    rememberOwnerName(label)
    const knownPeerIds = (peers.data?.peers ?? []).map((peer) => peer.id)
    const previousInviteId =
      created?.inviteId ??
      peers.data?.invites.find((invite) => invite.code === created?.code)?.id

    try {
      const result = await peers.createInvite.mutateAsync({
        label,
        quotaGb: effectiveQuotaGb,
      })
      rememberInviteFriendName(result.inviteCode, friend)

      const fresh = await peers.refetch()
      const inviteId = fresh.data?.invites.find(
        (invite) => invite.code === result.inviteCode
      )?.id

      setCreated({
        code: result.inviteCode,
        expiresAt: result.expiresAt,
        quotaGb: effectiveQuotaGb,
        inviteId,
        friendName: friend,
        knownPeerIds,
      })
      setConnectedPeerId(null)
      setStep(STEP_SEND)

      // Replace the previous draft invite instead of leaving two pending.
      if (previousInviteId && previousInviteId !== inviteId) {
        void peers.cancelInvite.mutateAsync(previousInviteId).catch(() => {})
      }
    } catch {
      // Toast comes from usePeers.
    }
  }

  const currentInvite = created
    ? peers.data?.invites.find(
        (invite) =>
          (created.inviteId && invite.id === created.inviteId) ||
          invite.code === created.code
      )
    : undefined
  const inviteAccepted = currentInvite?.status === "accepted"
  const invitePeer = currentInvite?.peerId
    ? peers.data?.peers.find((peer) => peer.id === currentInvite.peerId) ?? null
    : null

  const newPeer = useMemo(() => {
    if (!created) return null
    return (
      peers.data?.peers.find(
        (peer) =>
          peer.status === "active" && !created.knownPeerIds.includes(peer.id)
      ) ?? null
    )
  }, [created, peers.data?.peers])

  const connectedPeer = connectedPeerId
    ? peers.data?.peers.find((peer) => peer.id === connectedPeerId) ?? null
    : invitePeer ?? newPeer

  const createdExpiry = created ? getInviteExpiry(created.expiresAt) : null
  const friendDisplayName = preferredFriendName(
    connectedPeer?.name,
    created?.friendName ?? friendName
  )
  const inviteMessage = created
    ? buildInviteMessage({
        friendName: created.friendName,
        inviteCode: created.code,
        quotaGb: created.quotaGb,
        expiresAt: created.expiresAt,
      })
    : ""

  // Auto-advance as soon as the invite is consumed or a new peer appears.
  useEffect(() => {
    if (!open || !created) return
    if (step !== STEP_SEND) return
    if (!newPeer && !inviteAccepted) return

    const acceptedPeer = newPeer ?? invitePeer
    if (acceptedPeer) setConnectedPeerId(acceptedPeer.id)
    setStep(STEP_DONE)
    toast.success(
      `${preferredFriendName(acceptedPeer?.name, created.friendName)} is connected!`
    )
  }, [open, created, step, newPeer, invitePeer, inviteAccepted])

  useEffect(() => {
    if (step === STEP_DONE && newPeer && connectedPeerId !== newPeer.id) {
      setConnectedPeerId(newPeer.id)
    }
  }, [step, newPeer, connectedPeerId])

  const handleCopy = async (text: string, title: string, success: string) => {
    const ok = await copyText(text)
    if (ok) {
      toast.success(success)
      return
    }
    setManualCopy({ title, text })
    toast.info("Copy didn’t work automatically. Select the text below.")
  }

  const findCreatedInviteId = (): string | undefined =>
    created?.inviteId ??
    peers.data?.invites.find((invite) => invite.code === created?.code)?.id

  const handleCancelInvite = async () => {
    const inviteId = findCreatedInviteId()
    if (!inviteId) {
      toast.error("Couldn’t find that invite. Refresh and try again.")
      return
    }
    try {
      await peers.cancelInvite.mutateAsync(inviteId)
      setCreated(null)
      setStep(STEP_FRIEND)
    } catch {
      // toast in usePeers
    }
  }

  const handleNewInvite = async () => {
    const inviteId = findCreatedInviteId()
    if (inviteId) {
      try {
        await peers.cancelInvite.mutateAsync(inviteId)
      } catch {
        return
      }
    }
    setCreated(null)
    setStep(STEP_FRIEND)
  }

  const resetWizard = () => {
    setStep(STEP_ADDRESS)
    setSelectedUrl(null)
    setManualAddress("")
    setUseManual(false)
    setAddressError(null)
    setFriendName("")
    setFriendError(null)
    setQuotaGb(DEFAULT_QUOTA_GB)
    setQuotaMode("preset")
    setCustomQuota("")
    setCreated(null)
    setConnectedPeerId(null)
    setManualCopy(null)
  }

  const finish = () => {
    resetWizard()
    onOpenChange(false)
  }

  const closeWithoutResetting = () => onOpenChange(false)

  const candidates = addresses.data?.candidates ?? []
  const hasSameNetworkCandidate = candidates.some(
    (candidate) => candidate.reach === "same-network"
  )
  const sameNetworkBlocked =
    Boolean(addresses.data) &&
    !allowPrivate &&
    hasSameNetworkCandidate

  const footer =
    step === STEP_ADDRESS ? (
      <>
        <Button type="button" variant="outline" onClick={closeWithoutResetting}>
          Cancel
        </Button>
        <LoadingButton
          type="button"
          isLoading={peers.setBaseUrl.isPending}
          loadingText="Saving address…"
          disabled={!addressValidation?.ok}
          onClick={() => void handleContinueAddress()}
        >
          Continue
        </LoadingButton>
      </>
    ) : step === STEP_FRIEND ? (
      <>
        <Button
          type="button"
          variant="outline"
          onClick={() => setStep(STEP_ADDRESS)}
          disabled={peers.createInvite.isPending}
        >
          Back
        </Button>
        <LoadingButton
          type="button"
          isLoading={peers.createInvite.isPending}
          loadingText="Creating invite…"
          disabled={!friendName.trim() || !quotaValid}
          onClick={() => void handleCreateInvite()}
        >
          Create invite
        </LoadingButton>
      </>
    ) : step === STEP_SEND ? (
      <Button
        type="button"
        variant="outline"
        onClick={() => setStep(STEP_FRIEND)}
      >
        Back
      </Button>
    ) : (
      <>
        <Button type="button" variant="outline" onClick={finish}>
          Done
        </Button>
        {connectedPeer ? (
          <Button asChild onClick={finish}>
            <Link
              href={`/backups/new?peerId=${encodeURIComponent(connectedPeer.id)}`}
            >
              Back up to {friendDisplayName}
            </Link>
          </Button>
        ) : (
          <Button disabled>Back up to {friendDisplayName}</Button>
        )}
      </>
    )

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Invite a friend</DialogTitle>
            <DialogDescription>
              Share a folder on your friend’s computer. Everything is encrypted
              before it leaves this machine.
            </DialogDescription>
          </DialogHeader>

          <BroStepIndicator current={step} />

          {step === STEP_ADDRESS ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">Where can your friend find you?</h3>
                <p className="text-sm text-muted-foreground">
                  Pick the address your friend’s LazyBro app will use. It must be
                  reachable from their computer.
                </p>
              </div>

              {addresses.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Looking for addresses…
                </p>
              ) : null}

              {addresses.isError ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <InfoIcon className="h-4 w-4" />
                  <AlertTitle>Couldn’t detect addresses automatically</AlertTitle>
                  <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
                    Enter an address below — public, Tailscale, or an allowed
                    home-network address.
                  </AlertDescription>
                </Alert>
              ) : null}

              {!addresses.isLoading && addresses.data && !candidates.length ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <p className="text-sm font-medium">
                    We couldn’t find an address your friend can use.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline">
                      <a
                        href={TAILSCALE_SETUP_URL}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Set up Tailscale
                      </a>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setUseManual(true)}
                    >
                      Enter an address
                    </Button>
                  </div>
                </div>
              ) : null}

              <div
                role="radiogroup"
                aria-label="Address your friend can reach"
                className="space-y-2"
              >
                {candidates.map((candidate) => (
                  <AddressOption
                    key={`${candidate.kind}-${candidate.url}`}
                    candidate={candidate}
                    selected={!useManual && selectedUrl === candidate.url}
                    onSelect={() => {
                      setUseManual(false)
                      setSelectedUrl(candidate.url)
                      setAddressError(null)
                    }}
                  />
                ))}

                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                    useManual
                      ? "border-primary ring-1 ring-primary"
                      : "hover:bg-muted/40"
                  )}
                >
                  <input
                    type="radio"
                    name="bro-address"
                    className="sr-only"
                    checked={useManual}
                    onChange={() => {
                      setUseManual(true)
                      setSelectedUrl(null)
                      setAddressError(null)
                    }}
                  />
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                      useManual && "border-primary"
                    )}
                  >
                    {useManual ? (
                      <span className="h-2 w-2 rounded-full bg-primary" />
                    ) : null}
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">Enter an address</span>
                      <MonitorIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Public HTTPS, a Tailscale name, or an allowed home-network
                      address.
                    </span>
                  </span>
                </label>
              </div>

              {useManual ? (
                <Input
                  value={manualAddress}
                  onChange={(event) => {
                    setManualAddress(event.target.value)
                    setAddressError(null)
                  }}
                  placeholder="https://lazybackup.example.com"
                  autoFocus
                  inputMode="url"
                  aria-label="Your LazyBackup address"
                />
              ) : null}

              {sameNetworkBlocked ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <AlertTitle>Home-network addresses are blocked here</AlertTitle>
                  <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
                    Set <code>ALLOW_PRIVATE_PEER_URLS=true</code> on this
                    LazyBackup host and restart, or pick Tailscale or a public
                    address.
                  </AlertDescription>
                </Alert>
              ) : null}

              {addressIssue ? (
                <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <AlertTitle>That address won’t work</AlertTitle>
                  <AlertDescription className="text-destructive/90">
                    {addressIssue}
                  </AlertDescription>
                </Alert>
              ) : null}

              {hasSameNetworkCandidate ? (
                <p className="text-xs text-muted-foreground">
                  Using a home-network address? A friend who also runs full
                  LazyBackup needs{" "}
                  <code className="text-[11px]">ALLOW_PRIVATE_PEER_URLS=true</code>{" "}
                  on their side too.
                </p>
              ) : null}

              {addresses.data?.tailscale.available === false ? (
                <p className="text-xs text-muted-foreground">
                  Tailscale isn’t available on this host.{" "}
                  <a
                    href={TAILSCALE_SETUP_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline underline-offset-2 hover:no-underline"
                  >
                    Set up Tailscale
                  </a>{" "}
                  if you need to reach this machine from anywhere.
                </p>
              ) : null}

              <div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void addresses.refetch()}
                  disabled={addresses.isFetching}
                >
                  <RefreshCwIcon
                    className={cn("h-3.5 w-3.5", addresses.isFetching && "animate-spin")}
                  />
                  Check again
                </Button>
              </div>
            </div>
          ) : null}

          {step === STEP_FRIEND ? (
            <div className="space-y-5">
              <div>
                <h3 className="font-medium">Who are you inviting?</h3>
                <p className="text-sm text-muted-foreground">
                  Your friend installs LazyBro, pastes the invite, and picks a
                  folder.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bro-friend-name">Friend’s name</Label>
                <Input
                  id="bro-friend-name"
                  value={friendName}
                  onChange={(event) => {
                    setFriendName(event.target.value)
                    setFriendError(null)
                  }}
                  placeholder="Alex"
                  maxLength={80}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Used to label their space here and in the message.
                </p>
                {friendError ? (
                  <p className="text-xs text-destructive">{friendError}</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label>Space to share</Label>
                <div
                  role="radiogroup"
                  aria-label="Space to share"
                  className="flex flex-wrap gap-2"
                >
                  {PRESET_QUOTAS.map((preset) => {
                    const active = quotaMode === "preset" && quotaGb === preset
                    return (
                      <button
                        key={preset}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => {
                          setQuotaMode("preset")
                          setQuotaGb(preset)
                          setFriendError(null)
                        }}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm transition-colors",
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                      >
                        {preset} GB
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={quotaMode === "custom"}
                    onClick={() => {
                      setQuotaMode("custom")
                      setCustomQuota((current) => current || String(quotaGb))
                      setFriendError(null)
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm transition-colors",
                      quotaMode === "custom"
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    )}
                  >
                    Custom
                  </button>
                </div>
                {quotaMode === "custom" ? (
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={100000}
                      value={customQuota}
                      onChange={(event) => {
                        setCustomQuota(event.target.value)
                        setFriendError(null)
                      }}
                      placeholder="25"
                      className="max-w-[140px]"
                      aria-label="Custom space in GB"
                    />
                    <span className="text-sm text-muted-foreground">GB</span>
                  </div>
                ) : null}
                {quotaMode === "custom" && !quotaValid ? (
                  <p className="text-xs text-destructive">
                    Enter an amount between 1 and 100000 GB.
                  </p>
                ) : null}
                <p className="text-sm text-muted-foreground">
                  You’ll each lend the other up to{" "}
                  <span className="font-medium text-foreground">
                    {quotaLabel} GB
                  </span>
                  . You can change this later.
                </p>
              </div>

              <div className="space-y-1.5 border-t pt-4">
                <Label htmlFor="bro-owner-name">
                  Your name (shown to {friendName.trim() || "your friend"})
                </Label>
                <Input
                  id="bro-owner-name"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="Juan"
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground">
                  They’ll see this in LazyBro.
                </p>
              </div>
            </div>
          ) : null}

          {step === STEP_SEND && created ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">Send this to {friendDisplayName}</h3>
                <p className="text-sm text-muted-foreground">
                  Copy the whole message into a chat. It includes the invite and
                  the download link.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/40 p-3">
                <pre className="whitespace-pre-wrap break-all font-sans text-sm leading-relaxed">
                  {inviteMessage}
                </pre>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  type="button"
                  className="sm:flex-1"
                  disabled={createdExpiry?.expired}
                  onClick={() =>
                    void handleCopy(
                      inviteMessage,
                      "Copy invite message",
                      "Invite message copied"
                    )
                  }
                >
                  <CopyIcon className="h-4 w-4" />
                  Copy invite message
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={createdExpiry?.expired}
                  onClick={() =>
                    void handleCopy(
                      created.code,
                      "Copy invite code",
                      "Invite code copied"
                    )
                  }
                >
                  <CopyIcon className="h-4 w-4" />
                  Copy code only
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {createdExpiry?.expired
                  ? "Copy is disabled because this invite expired."
                  : "Send the message, or copy the code for a friend who also runs LazyBackup."}
              </p>

              <div className="border-t pt-4">
                <LazyBroDownloadLinks />
              </div>

              {createdExpiry?.expired ? (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  <AlertTriangleIcon className="h-4 w-4" />
                  <AlertTitle>This invite expired</AlertTitle>
                  <AlertDescription className="text-amber-900/80 dark:text-amber-200/80">
                    Invites last 3 days. Create a new one and send it to{" "}
                    {friendDisplayName}.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="flex items-start gap-3 rounded-lg border p-3">
                  <Loader2Icon className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-medium">
                      Waiting for {friendDisplayName} to accept…
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Keep this page open — it updates automatically.
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {createdExpiry?.label}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {createdExpiry?.expired ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleNewInvite()}
                  >
                    New invite
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleCancelInvite()}
                  disabled={peers.cancelInvite.isPending}
                >
                  Cancel invite
                </Button>
                {createdExpiry && !createdExpiry.expired ? (
                  <Badge variant="outline">{createdExpiry.label}</Badge>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === STEP_DONE ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                <CheckCircle2Icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-semibold">
                {friendDisplayName} is connected.
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                Now choose what to back up — you can change this later.
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                Backups keep syncing while LazyBro stays open on{" "}
                {friendDisplayName}’s computer.
              </p>
            </div>
          ) : null}

          <DialogFooter>{footer}</DialogFooter>
        </DialogContent>
      </Dialog>

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

function AddressOption({
  candidate,
  selected,
  onSelect,
}: {
  candidate: AddressCandidate
  selected: boolean
  onSelect: () => void
}) {
  const Icon = reachIcon(candidate.reach)
  const loopback = candidate.reach === "this-computer"

  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
        selected
          ? "border-primary ring-1 ring-primary"
          : "hover:bg-muted/40",
        loopback && "border-destructive/40 bg-destructive/5"
      )}
    >
      <input
        type="radio"
        name="bro-address"
        className="sr-only"
        checked={selected}
        onChange={onSelect}
      />
      <span
        className={cn(
          "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          selected && "border-primary"
        )}
      >
        {selected ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{reachLabel(candidate.reach)}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-normal",
              loopback
                ? "border-transparent bg-destructive text-white"
                : "border-transparent bg-secondary text-secondary-foreground"
            )}
          >
            {reachBadge(candidate.reach)}
          </span>
          {candidate.kind === "saved" ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-normal">
              Saved
            </span>
          ) : null}
        </span>
        <code className="block break-all text-xs text-muted-foreground">
          {candidate.url}
        </code>
        <span
          className={cn(
            "block text-xs",
            loopback ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {candidate.note}
        </span>
      </span>
    </label>
  )
}
