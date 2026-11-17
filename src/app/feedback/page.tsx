"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageSquare, Star, Send, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/components/AuthProvider";

interface FeedbackItem {
  id: number;
  lotId: number;
  lotName: string;
  authorName: string;
  rating: number;
  category: string;
  comment: string;
  adminResponse: string | null;
  status: string;
  createdAt: string;
}

interface LotOption {
  id: number;
  name: string;
}

export default function FeedbackPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [lots, setLots] = useState<LotOption[]>([]);
  const [lotId, setLotId] = useState<number>(1);
  const [rating, setRating] = useState<number>(5);
  const [category, setCategory] = useState<string>("experience");
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const [fbRes, lotRes] = await Promise.all([
      fetch("/api/feedback", { cache: "no-store" }),
      fetch("/api/lots", { cache: "no-store" }),
    ]);
    if (fbRes.ok) {
      const d = await fbRes.json();
      setItems(d.feedback ?? []);
    }
    if (lotRes.ok) {
      const ld = await lotRes.json();
      const list = ld.lots ?? [];
      setLots(list);
      if (list.length > 0) setLotId(list[0].id);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lotId, rating, category, comment }),
      });
      const data = await res.json();
      if (res.ok) {
        setComment("");
        setNotice("Feedback published and routed to hub managers!");
        await loadData();
      } else {
        setNotice(data.error || "Submission failed");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">
          Driver Feedback &amp; Hub Reviews
        </h1>
        <p className="text-xs text-slate-500">
          Rate QR gate speed, EV chargers, signage, and facility cleanliness.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
              <MessageSquare className="h-4 w-4 text-indigo-600" />
              Submit Hub Feedback
            </h2>
            {user ? (
              <form onSubmit={handleSubmit} className="space-y-3.5">
                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Parking Hub
                  </label>
                  <select
                    value={lotId}
                    onChange={(e) => setLotId(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                  >
                    {lots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Rating
                    </label>
                    <div className="flex gap-1 pt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          className="p-0.5"
                        >
                          <Star
                            className={`h-5 w-5 ${
                              star <= rating
                                ? "fill-amber-400 text-amber-400"
                                : "text-slate-300"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-bold text-slate-700">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold"
                    >
                      <option value="experience">Overall Experience</option>
                      <option value="scanner">QR Gate Scanner</option>
                      <option value="ev_charging">EV Charging</option>
                      <option value="navigation">Signage &amp; Navigation</option>
                      <option value="cleanliness">Cleanliness</option>
                      <option value="billing">Billing &amp; UPI</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-slate-700">
                    Comments
                  </label>
                  <textarea
                    rows={4}
                    required
                    minLength={5}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Share your experience with bay access, QR scanning, or charging..."
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {notice && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> {notice}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-2.5 text-xs font-bold text-white hover:bg-indigo-700"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitting ? "Publishing..." : "Submit Feedback"}
                </button>
              </form>
            ) : (
              <div className="space-y-3 py-4 text-center text-xs text-slate-500">
                <p>Sign in to submit verified feedback for ParkBotix hubs.</p>
                <Link
                  href="/login"
                  className="inline-block rounded-xl bg-indigo-600 px-5 py-2 text-xs font-bold text-white"
                >
                  Sign In
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 lg:col-span-7">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm font-bold text-slate-900">{item.lotName}</span>
                  <p className="text-[11px] text-slate-500">
                    By {item.authorName} •{" "}
                    <span className="uppercase">{item.category.replace("_", " ")}</span>
                  </p>
                </div>
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < item.rating
                          ? "fill-amber-400 text-amber-400"
                          : "text-slate-200"
                      }`}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-slate-700">{item.comment}</p>
              {item.adminResponse && (
                <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3 text-xs text-indigo-900">
                  <strong className="font-bold">Hub Manager Response: </strong>
                  {item.adminResponse}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
