"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  QrCode,
  Camera,
  CameraOff,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ScanLine,
  History,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface ScanResultState {
  ok: boolean;
  action?: string;
  message?: string;
  error?: string;
  slotCode?: string;
  lotName?: string;
  overtimeMinutes?: number;
  scannedAt?: string;
}

interface ScanLogRow {
  id: number;
  eventType: string;
  lotId: number | null;
  slotId: number | null;
  actorRole: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export default function ScannerPage() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"auto" | "entry" | "exit">("auto");
  const [gateName, setGateName] = useState("North Gate 01");
  const [manualInput, setManualInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResultState | null>(null);
  const [logs, setLogs] = useState<ScanLogRow[]>([]);

  const scannerInstanceRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(
    null
  );
  const lastDecodedRef = useRef<{ text: string; time: number }>({ text: "", time: 0 });

  const authorized =
    user && ["employee", "admin", "superadmin"].includes(user.role);

  const loadLogs = useCallback(async () => {
    const res = await fetch("/api/scanner/logs", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs ?? []);
    }
  }, []);

  useEffect(() => {
    if (authorized) {
      void loadLogs();
    }
  }, [authorized, loadLogs]);

  const submitScan = useCallback(
    async (qrInput: string) => {
      if (!qrInput.trim() || processing) return;
      setProcessing(true);
      try {
        const res = await fetch("/api/scanner/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrInput: qrInput.trim(), mode, gateName }),
        });
        const data = await res.json();
        setLastResult({
          ok: res.ok && Boolean(data.ok),
          action: data.action,
          message: data.message,
          error: data.error,
          slotCode: data.slotCode,
          lotName: data.lotName,
          overtimeMinutes: data.overtimeMinutes,
          scannedAt: data.scannedAt,
        });
        if (res.ok) {
          setManualInput("");
        }
        await loadLogs();
      } finally {
        setProcessing(false);
      }
    },
    [mode, gateName, processing, loadLogs]
  );

  async function startCamera() {
    setCameraError(null);
    try {
      const { Html5Qrcode } = await import("html5-qrcode");
      const html5Qr = new Html5Qrcode("parkbotix-qr-reader");
      await html5Qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          const now = Date.now();
          // Debounce same QR scan within 4 seconds
          if (
            decodedText === lastDecodedRef.current.text &&
            now - lastDecodedRef.current.time < 4000
          ) {
            return;
          }
          lastDecodedRef.current = { text: decodedText, time: now };
          void submitScan(decodedText);
        },
        () => {
          // Ignore frame-by-frame decode misses
        }
      );
      scannerInstanceRef.current = html5Qr;
      setCameraActive(true);
    } catch (err) {
      setCameraError(
        err instanceof Error
          ? `Camera unavailable (${err.message}). Ensure HTTPS/localhost permission or use Manual QR/Code Verification below.`
          : "Unable to access device camera. Use Manual QR/Code Verification below."
      );
      setCameraActive(false);
    }
  }

  async function stopCamera() {
    try {
      if (scannerInstanceRef.current) {
        await scannerInstanceRef.current.stop();
        scannerInstanceRef.current.clear();
        scannerInstanceRef.current = null;
      }
    } catch {
      // Ignore stop errors
    }
    setCameraActive(false);
  }

  useEffect(() => {
    return () => {
      if (scannerInstanceRef.current) {
        void scannerInstanceRef.current.stop().catch(() => {});
      }
    };
  }, []);

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Checking gate authorization...</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-rose-500" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">
          Authorized Gate Staff Only
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          The ParkBotix QR Entry/Exit Scanner requires an authorized Employee, Admin, or
          SuperAdmin session. Customers cannot trigger gate entry/exit operations.
        </p>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white"
        >
          Sign In as Gate Officer
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#0F172A] px-4 py-8 text-white sm:px-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-800 pb-5 sm:flex-row sm:items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 font-mono text-[11px] font-bold text-emerald-300">
              <ScanLine className="h-3.5 w-3.5" />
              GATE TERMINAL ACTIVE • OPERATOR: {user.name}
            </span>
            <h1 className="mt-2 text-2xl font-extrabold">
              ParkBotix QR Entry &amp; Exit Scanner
            </h1>
            <p className="text-xs text-slate-400">
              Cryptographic HMAC-SHA256 QR validation, duplicate scan blocking, expiry check &amp;
              overtime penalty calculation.
              {user.assignedLotId ? ` Scoped to Assigned Hub #${user.assignedLotId}.` : " All Hubs."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(["auto", "entry", "exit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`rounded-xl px-4 py-2 font-mono text-xs font-bold uppercase transition ${
                  mode === m
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/30"
                    : "border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                Mode: {m}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left: Live Webcam/Mobile Camera + Manual Scanner */}
          <div className="space-y-5 lg:col-span-7">
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Camera className="h-4 w-4 text-indigo-400" />
                  <h2 className="text-sm font-bold">Live Camera / Webcam Scanner</h2>
                </div>
                {cameraActive ? (
                  <button
                    type="button"
                    onClick={() => void stopCamera()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-rose-700"
                  >
                    <CameraOff className="h-3.5 w-3.5" /> Stop Camera
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void startCamera()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-500"
                  >
                    <Camera className="h-3.5 w-3.5" /> Start Camera Scan
                  </button>
                )}
              </div>

              <div className="relative overflow-hidden rounded-xl border border-slate-700 bg-black">
                <div id="parkbotix-qr-reader" className="min-h-[260px] w-full" />
                {!cameraActive && (
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 p-6 text-center">
                    <QrCode className="h-12 w-12 text-slate-600" />
                    <p className="mt-2 text-xs font-semibold text-slate-300">
                      Click &ldquo;Start Camera Scan&rdquo; to activate mobile rear camera or laptop webcam
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-slate-500">
                      Requires HTTPS or localhost camera permission
                    </p>
                  </div>
                )}
              </div>

              {cameraError && (
                <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {cameraError}
                </p>
              )}
            </div>

            {/* Manual QR Payload / Barcode Gun Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitScan(manualInput);
              }}
              className="rounded-2xl border border-slate-800 bg-slate-900 p-5"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold">
                  Manual QR Token / Booking Code Terminal
                </h2>
                <input
                  type="text"
                  value={gateName}
                  onChange={(e) => setGateName(e.target.value)}
                  className="w-36 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 font-mono text-[11px] text-slate-200"
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="text"
                  required
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  placeholder="Paste PBXQR... token or enter PBX-MG26-1001"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 font-mono text-xs text-white placeholder:text-slate-500 focus:border-indigo-400 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={processing}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {processing ? "Verifying..." : "Verify & Trigger Gate"}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span>Quick test seeded passes:</span>
                {["PBX-MG26-1001", "PBX-IN26-1002"].map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setManualInput(code)}
                    className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 font-mono text-[10px] text-indigo-300 hover:border-indigo-400"
                  >
                    {code}
                  </button>
                ))}
              </div>
            </form>
          </div>

          {/* Right: Gate Decision Banner + Live Event Log */}
          <div className="space-y-5 lg:col-span-5">
            {lastResult && (
              <div
                className={`rounded-2xl border p-5 ${
                  lastResult.ok
                    ? "border-emerald-500/40 bg-emerald-950/60 text-emerald-100"
                    : "border-rose-500/40 bg-rose-950/60 text-rose-100"
                }`}
              >
                <div className="flex items-start gap-3">
                  {lastResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-rose-400" />
                  )}
                  <div>
                    <p className="font-mono text-xs font-bold uppercase tracking-wider">
                      {lastResult.ok
                        ? `GATE ${lastResult.action?.toUpperCase()} GRANTED`
                        : "SCAN REJECTED"}
                    </p>
                    <p className="mt-1 text-sm font-bold text-white">
                      {lastResult.message || lastResult.error}
                    </p>
                    {lastResult.lotName && (
                      <p className="mt-1 font-mono text-[11px] text-slate-300">
                        {lastResult.lotName} • Bay {lastResult.slotCode}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <History className="h-4 w-4 text-indigo-400" />
                Live Gate Scan Telemetry ({logs.length})
              </h2>
              <div className="max-h-[380px] space-y-2.5 overflow-y-auto pr-1">
                {logs.length === 0 ? (
                  <p className="text-xs text-slate-500">No gate scans recorded yet.</p>
                ) : (
                  logs.map((l) => {
                    const isRejected = l.eventType.includes("rejected");
                    return (
                      <div
                        key={l.id}
                        className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`font-mono text-[10px] font-bold uppercase ${
                              isRejected ? "text-rose-400" : "text-emerald-400"
                            }`}
                          >
                            {l.eventType.replace(/_/g, " ")}
                          </span>
                          <span className="font-mono text-[10px] text-slate-500">
                            {new Date(l.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="mt-1 font-mono text-[11px] text-slate-300">
                          {JSON.stringify(l.details)}
                        </p>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
