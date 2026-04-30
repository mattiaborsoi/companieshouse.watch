"use client";

import { useState } from "react";

interface Props {
  anomalyId: string;
}

export default function ExplainButton({ anomalyId }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [output, setOutput] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/anomalies/${anomalyId}/explain`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Failed to generate explanation");
        setState("error");
        return;
      }
      const d = data as { output: string; generated_at?: string };
      setOutput(d.output);
      setGeneratedAt(d.generated_at ?? null);
      setState("done");
    } catch {
      setError("Network error — please try again");
      setState("error");
    }
  }

  if (state === "done" && output) {
    return (
      <div className="panel p-4 space-y-2">
        <div className="font-mono text-[10px] uppercase tracking-widest text-[var(--accent)]">
          AI-generated explanation
        </div>
        <p className="text-sm text-[var(--text-secondary)] leading-relaxed">{output}</p>
        <p className="font-mono text-[10px] text-[var(--text-muted)]">
          AI-generated · Claude Haiku
          {generatedAt ? ` · ${new Date(generatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.
          Factual summary only — no legal conclusions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={handleClick}
        disabled={state === "loading"}
        className="btn-ghost text-xs disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state === "loading" ? "Generating…" : "Generate AI explanation"}
      </button>
      {state === "error" && error && (
        <p className="font-mono text-xs text-[var(--alert)]">{error}</p>
      )}
      <p className="font-mono text-[10px] text-[var(--text-muted)]">
        Uses Anthropic Claude Haiku. Capped at £5/day.
      </p>
    </div>
  );
}
