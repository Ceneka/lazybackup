import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DeliveryBadge } from "./delivery-badge"
import { PeerPresence } from "./peer-presence"
import { PeerHealthCard } from "@/components/bro/peer-health-card"

describe("peer UI smoke render", () => {
  test("delivery badge renders waiting copy with tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(DeliveryBadge, { state: "waiting", friendName: "Alex" })
    )
    expect(html).toContain("Waiting for Alex")
    expect(html).toContain("Saved on this server. Not yet on Alex&#x27;s disk.")
  })

  test("presence renders online and app label", () => {
    const html = renderToStaticMarkup(
      createElement(PeerPresence, {
        peer: { id: "p1", name: "Alex", online: true },
      })
    )
    expect(html).toContain("Online now")
    expect(html).toContain("LazyBro app")
  })

  test("health card calls the reported timestamp a sync, not a stored backup", () => {
    const peer = {
      id: "p1",
      name: "Alex",
      remoteBaseUrl: "",
      remotePeerId: null,
      quotaBytes: 25 * 1024 ** 3,
      quotaGb: 25,
      usedBytes: 0,
      transport: "mailbox" as const,
      status: "active",
      inboundTokenPrefix: "lbpeer_x",
      lastSeenAt: "2026-01-01T00:00:00.000Z",
      lastActivityAt: "2026-01-01T00:00:00.000Z",
      remoteUsedBytes: 0,
      remoteQuotaBytes: 25 * 1024 ** 3,
      remoteLastSyncAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }
    const html = renderToStaticMarkup(
      createElement(PeerHealthCard, {
        peer,
        onRename: async () => {},
        onRemove: async () => {},
      })
    )
    expect(html).toContain("Last sync with Alex:")
    expect(html).not.toContain("Last backup stored")
  })
})
