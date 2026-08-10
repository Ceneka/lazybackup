"use client";

import { useEffect, useState } from "react";

type TabId = "docker" | "compose" | "bun";

const tabs: { id: TabId; label: string; recommended?: boolean }[] = [
  { id: "docker", label: "Docker", recommended: true },
  { id: "compose", label: "Compose" },
  { id: "bun", label: "Bun" },
];

type InstallTabsProps = {
  dockerCommand: string;
  composeCommand: string;
  bunCommand: string;
};

function IconCopy(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className} aria-hidden>
      <rect
        x="9"
        y="9"
        width="11"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M5 15V7a2 2 0 012-2h8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconCheck(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={props.className} aria-hidden>
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function InstallTabs({
  dockerCommand,
  composeCommand,
  bunCommand,
}: InstallTabsProps) {
  const [active, setActive] = useState<TabId>("docker");
  const [copied, setCopied] = useState(false);
  const commands: Record<TabId, string> = {
    docker: dockerCommand,
    compose: composeCommand,
    bun: bunCommand,
  };

  useEffect(() => {
    setCopied(false);
  }, [active]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(commands[active]);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mx-auto mt-10 max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-slate-950/80 text-left shadow-xl">
      <div className="flex flex-wrap items-center gap-1 border-b border-white/10 px-2 py-2">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
          role="tablist"
          aria-label="Install method"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              aria-controls="install-command-panel"
              id={`install-tab-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                active === tab.id
                  ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                  : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
              }`}
            >
              {tab.label}
              {tab.recommended ? (
                <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-emerald-400/70">
                  recommended
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={copyCommand}
          aria-label={copied ? "Copied" : "Copy command"}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            copied
              ? "bg-emerald-500/15 text-emerald-300"
              : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
          }`}
        >
          {copied ? (
            <IconCheck className="h-3.5 w-3.5" />
          ) : (
            <IconCopy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        id="install-command-panel"
        role="tabpanel"
        aria-labelledby={`install-tab-${active}`}
        className="overflow-x-auto p-5 font-mono text-sm leading-relaxed text-emerald-300/90"
      >
        <code>{commands[active]}</code>
      </pre>
    </div>
  );
}
