import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DeliveryBadge } from "./delivery-badge"
import { PeerPresence } from "./peer-presence"

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
})
