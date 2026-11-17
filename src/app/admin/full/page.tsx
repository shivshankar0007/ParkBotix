"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Crown,
  Users,
  Key,
  Settings,
  FileText,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  assignedLotId: number | null;
  isActive: boolean;
}

interface SettingRow {
  id: number;
  key: string;
  value: string;
  category: string;
  description: string | null;
}

interface ApiKeyRow {
  id: number;
  name: string;
  keyPrefix: string;
  scopes: string[];
  isActive: boolean;
  createdAt: string;
}

interface AuditRow {
  id: number;
  actorId: number | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  createdAt: string;
}

export default function AdminFullPage() {
  const { user, loading } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [settingsList, setSettingsList] = useState<SettingRow[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>([]);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const authorized = user && (user.role === "superadmin" || user.role === "admin");

  const loadAll = useCallback(async () => {
    const [uRes, sRes, kRes, aRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/admin/settings", { cache: "no-store" }),
      fetch("/api/admin/api-keys", { cache: "no-store" }),
      fetch("/api/admin/audit-logs", { cache: "no-store" }),
    ]);
    if (uRes.ok) setUsers((await uRes.json()).users ?? []);
    if (sRes.ok) setSettingsList((await sRes.json()).settings ?? []);
    if (kRes.ok) setApiKeys((await kRes.json()).apiKeys ?? []);
    if (aRes.ok) setAudits((await aRes.json()).auditLogs ?? []);
  }, []);

  useEffect(() => {
    if (authorized) void loadAll();
  }, [authorized, loadAll]);

  async function handleRoleChange(userId: number, role: string, assignedLotId: number | null) {
    setNotice(null);
    const res = await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, role, assignedLotId }),
    });
    const out = await res.json();
    setNotice(res.ok ? `Updated user #${userId} (${out.user.role}).` : out.error);
    await loadAll();
  }

  async function handleSettingUpdate(s: SettingRow, newValue: string) {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: s.key, value: newValue, category: s.category }),
    });
    if (res.ok) {
      setNotice(`Saved setting ${s.key} = ${newValue}`);
      await loadAll();
    }
  }

  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault();
    setCreatedRawKey(null);
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newKeyName }),
    });
    const out = await res.json();
    if (res.ok) {
      setNewKeyName("");
      setCreatedRawKey(out.plainTextKeyOnce);
      await loadAll();
    } else {
      setNotice(out.error);
    }
  }

  async function handleDeleteKey(id: number) {
    const res = await fetch(`/api/admin/api-keys?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setNotice(`Revoked API key #${id}.`);
      await loadAll();
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-sm text-slate-500">Loading platform governance...</div>;
  }

  if (!authorized) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <ShieldAlert className="mx-auto h-12 w-12 text-rose-500" />
        <h1 className="mt-3 text-xl font-extrabold text-slate-900">Restricted Platform Console</h1>
        <Link
          href="/login"
          className="mt-5 inline-block rounded-xl bg-indigo-600 px-6 py-2.5 text-xs font-bold text-white"
        >
          Sign In
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase text-indigo-600">
            <Crown className="h-3.5 w-3.5" /> FULL PLATFORM &amp; SUPERADMIN GOVERNANCE
          </span>
          <h1 className="text-2xl font-extrabold text-slate-900">
            RBAC Roles, API Keys, System Settings &amp; Security Audit Trail
          </h1>
        </div>
        <Link
          href="/admin"
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700"
        >
          ← Back to Admin Overview
        </Link>
      </div>

      {notice && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-xs font-semibold text-indigo-900">
          {notice}
        </div>
      )}

      {/* User Role & Employee Assignment Table */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
          <Users className="h-4 w-4 text-indigo-600" />
          User Directory &amp; Role Governance ({users.length})
        </h2>
        <p className="mb-3 text-[11px] text-slate-500">
          Backend RBAC Guard: Only SuperAdmin can assign or revoke Admin/SuperAdmin permissions.
          Admins can assign/remove Employees and update lot scopes.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 font-mono text-[10px] uppercase text-slate-400">
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Assigned Lot #</th>
                <th className="py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2.5 pr-3 font-bold text-slate-900">{u.name}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-500">{u.email}</td>
                  <td className="py-2.5 pr-3">
                    <select
                      defaultValue={u.role}
                      onChange={(e) =>
                        void handleRoleChange(u.id, e.target.value, u.assignedLotId)
                      }
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 font-mono text-xs font-semibold"
                    >
                      <option value="customer">customer</option>
                      <option value="employee">employee</option>
                      <option value="owner">owner</option>
                      <option value="admin">admin</option>
                      <option value="superadmin">superadmin</option>
                    </select>
                  </td>
                  <td className="py-2.5 pr-3">
                    <input
                      type="number"
                      defaultValue={u.assignedLotId ?? ""}
                      placeholder="None"
                      onBlur={(e) =>
                        void handleRoleChange(
                          u.id,
                          u.role,
                          e.target.value ? Number(e.target.value) : null
                        )
                      }
                      className="w-20 rounded-lg border border-slate-200 px-2 py-1 font-mono text-xs"
                    />
                  </td>
                  <td className="py-2.5 font-mono text-[10px] text-emerald-600">
                    {u.isActive ? "ACTIVE" : "DISABLED"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* System Settings */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <Settings className="h-4 w-4 text-indigo-600" />
            Platform Settings
          </h2>
          <div className="space-y-3">
            {settingsList.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-mono font-bold text-slate-900">{s.key}</p>
                  <p className="text-[11px] text-slate-500">{s.description}</p>
                </div>
                <input
                  type="text"
                  defaultValue={s.value}
                  onBlur={(e) => {
                    if (e.target.value !== s.value) {
                      void handleSettingUpdate(s, e.target.value);
                    }
                  }}
                  className="w-44 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-mono text-xs"
                />
              </div>
            ))}
          </div>
        </section>

        {/* API Keys (SuperAdmin creation) */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <Key className="h-4 w-4 text-indigo-600" />
            API Key Management (SHA-256 Hashed Storage)
          </h2>
          {user.role === "superadmin" && (
            <form onSubmit={handleCreateApiKey} className="mb-4 flex gap-2">
              <input
                required
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="Key Name (e.g. Gate Edge Node #1)"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
              >
                Generate Key
              </button>
            </form>
          )}
          {createdRawKey && (
            <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-3 font-mono text-[11px] text-amber-900">
              <strong className="block">Copy Secret Now (shown once):</strong>
              <span className="break-all font-bold">{createdRawKey}</span>
            </div>
          )}
          <div className="space-y-2">
            {apiKeys.length === 0 ? (
              <p className="text-xs text-slate-400">No external API keys issued yet.</p>
            ) : (
              apiKeys.map((k) => (
                <div
                  key={k.id}
                  className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-bold text-slate-900">{k.name}</p>
                    <p className="font-mono text-[10px] text-slate-500">
                      {k.keyPrefix}••••••••
                    </p>
                  </div>
                  {user.role === "superadmin" && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteKey(k.id)}
                      className="rounded-lg border border-rose-200 bg-rose-50 p-1.5 text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* Security Audit Logs */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold text-slate-900">
          <FileText className="h-4 w-4 text-indigo-600" />
          Administrative &amp; Security Audit Trail ({audits.length})
        </h2>
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 font-mono text-[10px] uppercase text-slate-400">
                <th className="py-2 pr-3">Time</th>
                <th className="py-2 pr-3">Actor Role</th>
                <th className="py-2 pr-3">Action</th>
                <th className="py-2 pr-3">Entity</th>
                <th className="py-2">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
              {audits.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3 text-slate-500">
                    {new Date(a.createdAt).toLocaleString()}
                  </td>
                  <td className="py-2 pr-3 uppercase text-indigo-700">{a.actorRole}</td>
                  <td className="py-2 pr-3 font-bold text-slate-800">{a.action}</td>
                  <td className="py-2 pr-3 text-slate-600">
                    {a.entityType}#{a.entityId ?? "-"}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${
                        a.outcome === "success"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                    >
                      {a.outcome}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
