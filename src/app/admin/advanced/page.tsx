"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Cpu,
  Play,
  Sparkles,
  Zap,
  Activity,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface TelemetryState {
  aiProviders: { groqConfigured: boolean; geminiConfigured: boolean };
  activities: Array<{
    id: number;
    endpoint: string;
    module: string;
    provider: string;
    latencyMs: number;
    status: string;
    createdAt: string;
  }>;
  predictions: Array<{
    id: number;
    lotId: number;
    predictedOccupancy: number;
    congestionLevel: string;
    recommendedAction: string;
  }>;
  pricingLogs: Array<{
    id: number;
    lotId: number;
    baseRate: number;
    computedRate: number;
    demandFactor: number;
    reason: string;
  }>;
  extensions: Array<{
    id: number;
    bookingId: number;
    addedMinutes: number;
    extraCharge: number;
    reason: string;
    createdAt: string;
  }>;
}

const AI_MODULES = [
  { id: "pcde", label: "PCDE Congestion & Surge", endpoint: "/api/pcde/advise", method: "POST", payload: { horizonMinutes: 60 } },
  { id: "aerr", label: "AERR Exit & Revenue Risk", endpoint: "/api/aerr/predict", method: "POST", payload: {} },
  { id: "ipre", label: "IPRE Bay Suggestions", endpoint: "/api/ipre/suggest", method: "POST", payload: { preferEv: true, createShadowHold: true } },
  { id: "gsd", label: "GSD Ghost Slot Detector", endpoint: "/api/gsd/detect", method: "POST", payload: { autoReconcile: true } },
  { id: "easas", label: "EASAS EV Bay Assignment", endpoint: "/api/easas/assign", method: "POST", payload: { minPowerKw: 22, batteryPercent: 30 } },
  { id: "easdl", label: "EASDL Edge AI Sensor", endpoint: "/api/easdl/process", method: "POST", payload: { slotId: 1, detectedOccupied: false, sensorConfidence: 0.96 } },
  { id: "rsms", label: "RSMS Slot Morphing", endpoint: "/api/rsms/morph", method: "POST", payload: { slotId: 6, toType: "vip", reason: "Executive surge morph" } },
  { id: "cdaec", label: "CDAEC Crowd Density", endpoint: "/api/cdaec/status", method: "GET", payload: null },
  { id: "advice", label: "AI Smart Hub Advice", endpoint: "/api/ai/advice", method: "POST", payload: { preferEv: true } },
];

export default function AdminAdvancedPage() {
  const { user, loading } = useAuth();
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [outputJson, setOutputJson] = useState<string>("");
  const [outputTitle, setOutputTitle] = useState<string>("Select any module to run live diagnostics");

  const authorized = user && (user.role === "admin" || user.role === "superadmin");

  const loadTelemetry = useCallback(async () => {
    const res = await fetch("/api/ai/activity", { cache: "no-store" });
    if (res.ok) {
      setTelemetry(await res.json());
    }
  }, []);

  useEffect(() => {
    if (authorized) void loadTelemetry();
  }, [authorized, loadTelemetry]);

  async function runModule(mod: (typeof AI_MODULES)[number]) {
    setRunningId(mod.id);
    try {
      const res = await fetch(mod.endpoint, {
        method: mod.method,
        headers: mod.method === "POST" ? { "Content-Type": "application/json" } : undefined,
        body: mod.method === "POST" ? JSON.stringify(mod.payload) : undefined,
      });
      const data = await res.json();
      setOutputTitle(`${mod.method} ${mod.endpoint} — HTTP ${res.status}`);
      setOutputJson(JSON.stringify(data, null, 2));
      await loadTelemetry();
    } finally {
      setRunningId(null);
    }
  }

  async function runAutoExtendJob() {
    setRunningId("worker");
    try {
      const res = await fetch("/api/jobs/auto-extend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ windowMinutes: 30, extensionMinutes: 30 }),
      });
      const data = await res.json();
      setOutputTitle(`POST /api/jobs/auto-extend — PostgreSQL Advisory-Locked Worker`);
      setOutputJson(JSON.stringify(data, null, 2));
      await loadTelemetry();
    } finally {
      setRunningId(null);
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Loading AI intelligence suite...</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-rose-500" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">Admin AI Console</h1>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white"
        >
          Sign In as Admin
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-800 bg-[#0F172A] p-6 text-white sm:flex-row sm:items-center">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase text-indigo-300">
            <Cpu className="h-4 w-4" /> PARKBOTIX AI INTELLIGENCE &amp; AUTOMATION SUITE
          </span>
          <h1 className="mt-1 text-2xl font-extrabold">
            15 Migrated AI Endpoints + Auto-Extension Background Worker
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Groq API:{" "}
            <span className="font-mono text-emerald-400">
              {telemetry?.aiProviders.groqConfigured ? "CONFIGURED" : "DETERMINISTIC FALLBACK"}
            </span>{" "}
            • Gemini API:{" "}
            <span className="font-mono text-emerald-400">
              {telemetry?.aiProviders.geminiConfigured ? "CONFIGURED" : "DETERMINISTIC FALLBACK"}
            </span>
          </p>
        </div>

        <button
          type="button"
          onClick={() => void runAutoExtendJob()}
          disabled={runningId === "worker"}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500"
        >
          <Clock className="h-4 w-4" />
          {runningId === "worker"
            ? "Running Advisory-Locked Worker..."
            : "Run Auto-Extension Worker Now"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Interactive Endpoint Launcher */}
        <div className="space-y-3 lg:col-span-5">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Live AI &amp; Smart Parking Endpoint Console
          </h2>
          <div className="grid grid-cols-1 gap-2.5">
            {AI_MODULES.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="text-xs font-bold text-slate-900">{m.label}</p>
                  <p className="font-mono text-[10px] text-slate-500">
                    {m.method} {m.endpoint}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={runningId === m.id}
                  onClick={() => void runModule(m)}
                  className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  <Play className="h-3 w-3" />
                  {runningId === m.id ? "Running..." : "Execute"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Right: JSON Telemetry Inspector + Activity Logs */}
        <div className="space-y-5 lg:col-span-7">
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-[#0F172A] text-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5">
              <span className="font-mono text-xs font-bold text-emerald-400">
                {outputTitle}
              </span>
              <Zap className="h-4 w-4 text-indigo-400" />
            </div>
            <pre className="max-h-[320px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-slate-200">
              {outputJson || "// Click 'Execute' on any AI module or 'Run Auto-Extension Worker' to inspect live PostgreSQL-backed responses."}
            </pre>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                <Activity className="h-4 w-4 text-indigo-600" />
                Recent AI Activity Log ({telemetry?.activities.length ?? 0})
              </h3>
              <div className="max-h-[220px] space-y-2 overflow-y-auto">
                {telemetry?.activities.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 font-mono text-[10px]"
                  >
                    <div className="flex justify-between font-bold text-slate-800">
                      <span>{a.endpoint}</span>
                      <span className="text-emerald-700">{a.latencyMs}ms</span>
                    </div>
                    <span className="text-slate-500">
                      {a.module} • {a.provider}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2.5 flex items-center gap-1.5 text-xs font-extrabold text-slate-900">
                <Clock className="h-4 w-4 text-emerald-600" />
                Auto-Extension Worker History ({telemetry?.extensions.length ?? 0})
              </h3>
              <div className="max-h-[220px] space-y-2 overflow-y-auto">
                {telemetry?.extensions.length ? (
                  telemetry.extensions.map((ext) => (
                    <div
                      key={ext.id}
                      className="rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-2 font-mono text-[10px]"
                    >
                      <p className="font-bold text-emerald-900">
                        Booking #{ext.bookingId} • +{ext.addedMinutes}m (+₹{ext.extraCharge})
                      </p>
                      <p className="text-slate-600">{ext.reason}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-400">
                    Click &ldquo;Run Auto-Extension Worker Now&rdquo; above to process active bookings approaching expiry.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
