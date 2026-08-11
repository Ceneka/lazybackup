"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  WEBHOOK_PRESETS,
  WEBHOOK_TAG_KEYS,
  type WebhookHttpMethod,
  type WebhookPreset,
} from "@/lib/notify/failure-webhook"
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

export function FailureWebhookSettings({ settings }: Props) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState("")
  const [method, setMethod] = useState<WebhookHttpMethod>("POST")
  const [headers, setHeaders] = useState("")
  const [body, setBody] = useState("")
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    if (!settings.settings) return
    setUrl(settings.settings.failureWebhookUrl || "")
    const m = (settings.settings.failureWebhookMethod || "POST").toUpperCase()
    setMethod(m === "GET" || m === "PUT" ? m : "POST")
    setHeaders(settings.settings.failureWebhookHeaders || "")
    setBody(settings.settings.failureWebhookBody || "")
  }, [settings.settings])

  const save = (key: string, value: string) => {
    settings.updateSetting.mutate({ key, value })
  }

  const applyPreset = async (preset: WebhookPreset) => {
    setUrl(preset.url)
    setMethod(preset.method)
    setHeaders(preset.headers)
    setBody(preset.body)
    try {
      await postSetting("failureWebhookUrl", preset.url)
      await postSetting("failureWebhookMethod", preset.method)
      await postSetting("failureWebhookHeaders", preset.headers)
      await postSetting("failureWebhookBody", preset.body)
      await queryClient.invalidateQueries({ queryKey: ["settings"] })
      toast.success(`Applied ${preset.name} preset — edit placeholders before testing`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to apply preset")
    }
  }

  const handleTest = async () => {
    setTestLoading(true)
    try {
      const response = await fetch("/api/settings/webhook-test", {
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
        throw new Error(data.error || "Failed to send test notification")
      }
      toast.success("Test notification sent")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to send test notification")
    } finally {
      setTestLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use <code className="text-xs">{"{{tags}}"}</code> in the URL, headers, or body.
        Empty URL disables notifications.
      </p>

      <div className="flex flex-wrap gap-2">
        {WEBHOOK_PRESETS.map((preset) => (
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
          <Label htmlFor="failureWebhookMethod">Method</Label>
          <select
            id="failureWebhookMethod"
            value={method}
            onChange={(e) => {
              const next = e.target.value as WebhookHttpMethod
              setMethod(next)
              save("failureWebhookMethod", next)
            }}
            className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="POST">POST</option>
            <option value="GET">GET</option>
            <option value="PUT">PUT</option>
          </select>
        </div>
        <div>
          <Label htmlFor="failureWebhookUrlInput">URL</Label>
          <Input
            id="failureWebhookUrlInput"
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={(e) => save("failureWebhookUrl", e.target.value.trim())}
            placeholder="https://hooks.example.com/… or Kuma push URL"
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="failureWebhookHeaders">Headers</Label>
        <Textarea
          id="failureWebhookHeaders"
          value={headers}
          onChange={(e) => setHeaders(e.target.value)}
          onBlur={(e) => save("failureWebhookHeaders", e.target.value)}
          placeholder={"Content-Type: application/json\nAuthorization: Bearer …"}
          className="mt-1 min-h-[88px] font-mono text-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          One <code>Name: value</code> per line, or a JSON object. Tags work in values.
        </p>
      </div>

      <div>
        <Label htmlFor="failureWebhookBody">Body template</Label>
        <Textarea
          id="failureWebhookBody"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onBlur={(e) => save("failureWebhookBody", e.target.value)}
          placeholder='Leave empty for default JSON, or e.g. {"content":"{{backupName}}: {{errorMessage}}"}'
          className="mt-1 min-h-[120px] font-mono text-xs"
          disabled={method === "GET"}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          {method === "GET"
            ? "GET requests have no body — put tags in the URL query string instead."
            : "Empty body sends the default backup.failed JSON. HTTPS required (http allowed for localhost/LAN)."}
        </p>
      </div>

      <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Available tags</p>
        <p className="mt-1 break-all">
          {WEBHOOK_TAG_KEYS.map((t) => `{{${t}}}`).join(" · ")}
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
        Send test notification
      </LoadingButton>
    </div>
  )
}
