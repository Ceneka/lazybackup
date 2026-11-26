import { describe, expect, test } from "bun:test"
import {
  addressReachForUrl,
  buildAddressCandidates,
  isCandidateUsable,
  normalizeAddressUrl,
  validateAddressInput,
} from "./addresses"

describe("addressReachForUrl", () => {
  test("classifies public, Tailscale, LAN, and loopback", () => {
    expect(addressReachForUrl("https://backup.example.com")).toBe("anywhere")
    expect(addressReachForUrl("http://100.70.83.23:3141")).toBe("tailnet")
    expect(addressReachForUrl("http://192.168.0.36:3141")).toBe("same-network")
    expect(addressReachForUrl("http://127.0.0.1:3141")).toBe("this-computer")
    expect(addressReachForUrl("http://localhost:3141")).toBe("this-computer")
  })

  test("rejects link-local and non-http URLs", () => {
    expect(addressReachForUrl("http://169.254.1.1:3141")).toBeNull()
    expect(addressReachForUrl("ftp://example.com")).toBeNull()
    expect(addressReachForUrl("not a url")).toBeNull()
  })
})

describe("normalizeAddressUrl", () => {
  test("drops trailing slashes, credentials, query, and hash", () => {
    expect(normalizeAddressUrl("http://192.168.0.36:3141/")).toBe(
      "http://192.168.0.36:3141"
    )
    expect(normalizeAddressUrl("https://user:pass@example.com/x?y=1#z")).toBeNull()
    expect(normalizeAddressUrl("https://example.com/base/?token=1#x")).toBe(
      "https://example.com/base"
    )
  })
})

describe("buildAddressCandidates", () => {
  test("returns saved, Tailscale, LAN, request, and loopback candidates in order", () => {
    const candidates = buildAddressCandidates({
      savedBaseUrl: "https://backup.example.com/",
      tailscaleBaseUrl: "http://100.70.83.23:3141",
      lanIpv4s: ["192.168.0.36", "172.17.0.1"],
      requestOrigin: "http://192.168.0.36:3141",
      port: "3141",
      protocol: "http",
    })

    expect(candidates.map((c) => c.kind)).toEqual([
      "saved",
      "tailscale",
      "lan",
      "lan",
      // request origin duplicates the first LAN address
      "loopback",
    ])
    expect(candidates[0]).toMatchObject({
      url: "https://backup.example.com",
      reach: "anywhere",
      note: "Looks reachable from outside your network.",
    })
    expect(candidates[1]).toMatchObject({
      url: "http://100.70.83.23:3141",
      reach: "tailnet",
      note: "Your friend must also install Tailscale and join your tailnet.",
    })
    expect(candidates[2]).toMatchObject({
      url: "http://192.168.0.36:3141",
      reach: "same-network",
      note: "Only works while your friend is on your home network.",
    })
    expect(candidates.at(-1)).toMatchObject({
      kind: "loopback",
      url: "http://127.0.0.1:3141",
      reach: "this-computer",
      note: "Only works on this computer. Your friend will not be able to connect.",
    })
  })

  test("labels a public request origin as a public address", () => {
    const candidates = buildAddressCandidates({
      requestOrigin: "https://lazy.example.com",
      port: "3000",
      protocol: "https",
    })
    expect(candidates.find((c) => c.reach === "anywhere")?.kind).toBe("request")
  })

  test("omits the loopback card when there is no port to build it with", () => {
    const candidates = buildAddressCandidates({
      requestOrigin: "https://lazy.example.com",
      port: null,
      protocol: "https",
    })
    expect(candidates.some((c) => c.kind === "loopback")).toBe(false)
  })

  test("drops duplicate URLs and keeps the first kind", () => {
    const candidates = buildAddressCandidates({
      savedBaseUrl: "http://192.168.0.36:3141",
      requestOrigin: "http://192.168.0.36:3141",
      lanIpv4s: ["192.168.0.36"],
      port: 3141,
    })
    expect(candidates).toHaveLength(2)
    expect(candidates[0].kind).toBe("saved")
    expect(candidates[1].kind).toBe("loopback")
  })
})

describe("validateAddressInput", () => {
  test("accepts public and Tailscale addresses", () => {
    expect(
      validateAddressInput("https://backup.example.com", {
        allowPrivatePeerUrls: false,
      })
    ).toMatchObject({ ok: true, reach: "anywhere" })
    expect(
      validateAddressInput("http://100.70.83.23:3141", {
        allowPrivatePeerUrls: false,
      })
    ).toMatchObject({ ok: true, reach: "tailnet" })
  })

  test("rejects loopback with the audit copy", () => {
    expect(
      validateAddressInput("http://127.0.0.1:3141", {
        allowPrivatePeerUrls: true,
      })
    ).toEqual({
      ok: false,
      error:
        "Only works on this computer. Your friend will not be able to connect.",
      reach: "this-computer",
    })
  })

  test("explains ALLOW_PRIVATE_PEER_URLS for LAN addresses", () => {
    const denied = validateAddressInput("http://192.168.0.36:3141", {
      allowPrivatePeerUrls: false,
    })
    expect(denied.ok).toBe(false)
    if (!denied.ok) {
      expect(denied.error).toContain("ALLOW_PRIVATE_PEER_URLS=true")
    }

    expect(
      validateAddressInput("http://192.168.0.36:3141", {
        allowPrivatePeerUrls: true,
      })
    ).toMatchObject({ ok: true, reach: "same-network" })
  })

  test("rejects invalid input", () => {
    expect(
      validateAddressInput("lazybackup", { allowPrivatePeerUrls: true }).ok
    ).toBe(false)
  })
})

describe("isCandidateUsable", () => {
  const lan = {
    kind: "lan" as const,
    url: "http://192.168.0.36:3141",
    reach: "same-network" as const,
    note: "",
  }

  test("LAN candidates depend on the host flag", () => {
    expect(isCandidateUsable(lan, false)).toBe(false)
    expect(isCandidateUsable(lan, true)).toBe(true)
  })

  test("loopback is never usable", () => {
    expect(
      isCandidateUsable({ ...lan, reach: "this-computer" }, true)
    ).toBe(false)
  })
})
