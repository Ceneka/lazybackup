"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  SUCCESS_PING_PRESETS,
  SUCCESS_PING_TAG_KEYS,
  type SuccessPingPreset,
  parseSuccessPingMethod,
} from "@/lib/notify/success-ping"
import type { WebhookHttpMethod } from "@/lib/notify/failure-webhook"
import { useSettings } from "@/lib/hooks/useSettings"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type Props = {
  settings: ReturnType<typeof useSettings>
}

async function postSetting(key: string, value: string) {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || "Failed to update setting")
  }
}

export function SuccessPingSettings({ settings }: Props) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState("")
  const [method, setMethod] = useState<WebhookHttpMethod>("GET")
  const [headers, setHeaders] = useState("")
  const [body, setBody] = useState("")
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    if (!settings.settings) return
    setUrl(settings.settings.successPingUrl || "")
    setMethod(parseSuccessPingMethod(settings.settings.successPingMethod))
    setHeaders(settings.settings.successPingHeaders || "")
    setBody(settings.settings.successPingBody || "")
  }, [settings.settings])

  const save = (key: string, value: string) => {
    settings.updateSetting.mutate({ key, value })
  }

  const applyPreset = async (preset: SuccessPingPreset) => {
    setUrl(preset.url)
    setMethod(preset.method)
    setHeaders(preset.headers)
    setBody(preset.body)
    try {
      await postSetting("successPingUrl", preset.url)
      await postSetting("successPingMethod", preset.method)
      await postSetting("successPingHeaders", preset.headers)
      await postSetting("successPingBody", preset.body)
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success(`Applied ${preset.name} preset — edit placeholders before testing`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply preset")
    }
  }

  const handleTest = async () => {
    setTestLoading(true)
    try {
      const response = await fetch("/api/settings/success-ping-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || undefined,
          method,
          headers,
          body,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "Failed to send success ping")
      }
      toast.success("Success ping sent")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send success ping")
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Ping Healthchecks.io, Uptime Kuma, or any URL when a backup succeeds. Use{" "}
        <code className="text-xs">{"{{tags}}"}</code> in the URL, headers, or body. Empty URL
        disables pings.
      </p>

      <div className="flex flex-wrap gap-2">
        {SUCCESS_PING_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            title={preset.description}
            onClick={() => void applyPreset(preset)}
            className="rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground"
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <div>
          <Label htmlFor="successPingMethod">Method</Label>
          <select
            id="successPingMethod"
            value={method}
            onChange={(e) => {
              const next = e.target.value as WebhookHttpMethod
              setMethod(next)
              save("successPingMethod", next)
            }}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
        <div>
          <Label htmlFor="successPingUrlInput">URL</Label>
          <Input
            id="successPingUrlInput"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => save("successPingUrl", e.target.value.trim())}
            placeholder="https://hc-ping.com/… or Kuma push URL"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="successPingHeaders">Headers</Label>
        <Textarea
          id="successPingHeaders"
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          onBlur={(e) => save("successPingHeaders", e.target.value)}
          placeholder={"Authorization: Bearer …"}
          className="mt-1 min-h-[72px] font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          One <code>Name: value</code> per line, or a JSON object. Optional for most ping URLs.
        </p>
      </div>

      <div>
        <Label htmlFor="successPingBody">Body template</Label>
        <Textarea
          id="successPingBody"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={(e) => save("successPingBody", e.target.value)}
          placeholder='Leave empty for default JSON (POST/PUT), or custom {{tags}}'
          className="mt-1 min-h-[100px] font-mono text-xs"
          disabled={method === "GET"}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {method === "GET"
            ? "GET requests have no body — Healthchecks and Kuma usually need only the URL."
            : "Empty body sends the default backup.succeeded JSON. HTTPS required (http allowed for localhost/LAN)."}
        </p>
      </div>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Available tags</p>
        <p className="mt-1 break-all">
          {SUCCESS_PING_TAG_KEYS.map((t) => `{{${t}}}`).join(" · ")}
        </p>
      </div>

      <LoadingButton
        variant="outline"
        size="sm"
        onClick={() => void handleTest()}
        isLoading={testLoading}
        loadingText="Sending…"
        disabled={!url.trim()}
      >
        Send test ping
      </LoadingButton>
    </div>
  )
}
