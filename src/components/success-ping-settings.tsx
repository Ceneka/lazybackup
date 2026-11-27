"use client"

import { LoadingButton } from "@/components/ui/loading-button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ConfirmActionDialog } from "@/components/settings/confirm-action-dialog"
import {
  SUCCESS_PING_PRESETS,
  SUCCESS_PING_TAG_KEYS,
  parseSuccessPingMethod,
  type SuccessPingPreset,
  type WebhookHttpMethod,
} from "@/lib/notify/presets"
import { useSettings } from "@/lib/hooks/useSettings"
import { cn } from "@/lib/utils"
import { useEffect, useState } from "react"
import { toast } from "sonner"

type Props = {
  settings: ReturnType<typeof useSettings>
}

export function SuccessPingSettings({ settings }: Props) {
  const savedUrl = settings.settings.successPingUrl || ""
  const savedMethod = parseSuccessPingMethod(settings.settings.successPingMethod)
  const savedHeaders = settings.settings.successPingHeaders || ""
  const savedBody = settings.settings.successPingBody || ""

  const [url, setUrl] = useState(savedUrl)
  const [method, setMethod] = useState<WebhookHttpMethod>(savedMethod)
  const [headers, setHeaders] = useState(savedHeaders)
  const [body, setBody] = useState(savedBody)
  const [activePreset, setActivePreset] = useState<SuccessPingPreset | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [testLoading, setTestLoading] = useState(false)

  useEffect(() => {
    setUrl(savedUrl)
    setMethod(savedMethod)
    setHeaders(savedHeaders)
    setBody(savedBody)
  }, [savedUrl, savedMethod, savedHeaders, savedBody])

  const dirty =
    url.trim() !== savedUrl ||
    method !== savedMethod ||
    headers !== savedHeaders ||
    body !== savedBody
  const hasExistingConfig = Boolean(savedUrl || savedHeaders || savedBody)

  const applyPreset = (preset: SuccessPingPreset) => {
    setUrl(preset.url)
    setMethod(preset.method)
    setHeaders(preset.headers)
    setBody(preset.body)
    setActivePreset(preset)
  }

  const save = async () => {
    await settings.updateSettings.mutateAsync({
      values: {
        successPingUrl: url.trim(),
        successPingMethod: method,
        successPingHeaders: headers,
        successPingBody: body,
      },
      label: "Success ping",
    })
    setActivePreset(null)
  }

  const requestSave = () => {
    if (hasExistingConfig && dirty) {
      setConfirmReplace(true)
      return
    }
    void save().catch(() => {
      // toast in hook
    })
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
        disables pings. Changes are not saved until you click{" "}
        <strong>Save success ping</strong>.
      </p>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {SUCCESS_PING_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              aria-pressed={activePreset?.id === preset.id}
              onClick={() => applyPreset(preset)}
              className={cn(
                "rounded-md border bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent hover:text-accent-foreground",
                activePreset?.id === preset.id && "border-primary bg-primary/10"
              )}
            >
              {preset.name}
            </button>
          ))}
        </div>
        {activePreset ? (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <p className="font-medium text-foreground">{activePreset.name}</p>
            <p className="mt-0.5 text-muted-foreground">{activePreset.description}</p>
            <p className="mt-1 text-muted-foreground">
              Filled into the form only — review the placeholders and click Save
              to apply.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Presets only fill this form; nothing is saved until you click Save.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-[7rem_1fr]">
        <div>
          <Label htmlFor="successPingMethod">Method</Label>
          <select
            id="successPingMethod"
            value={method}
            onChange={(e) => setMethod(e.target.value as WebhookHttpMethod)}
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

      <div className="flex flex-wrap items-center gap-2">
        <LoadingButton
          type="button"
          onClick={requestSave}
          isLoading={settings.updateSettings.isPending}
          loadingText="Saving…"
          disabled={!dirty}
        >
          Save success ping
        </LoadingButton>
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
        {dirty ? (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        ) : (
          <span className="text-xs text-muted-foreground">Saved</span>
        )}
      </div>

      <ConfirmActionDialog
        open={confirmReplace}
        onOpenChange={setConfirmReplace}
        hideTrigger
        title="Replace the current success ping?"
        description={
          <>
            The saved ping URL{" "}
            <code className="break-all">{savedUrl || "an existing configuration"}</code>{" "}
            will be replaced with the values currently in this form.
          </>
        }
        confirmLabel="Replace success ping"
        pendingLabel="Saving…"
        onConfirm={save}
      />
    </div>
  )
}
