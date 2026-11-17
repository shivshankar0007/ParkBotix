import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, parkingLots, parkingSlots, coupons } from "@/db";
import { ensureSeeded } from "@/db/seed";
import { getCurrentUser } from "@/lib/auth";
import { generateAiText, recordAiActivity } from "@/lib/ai-provider";

const chatSchema = z.object({
  message: z.string().trim().min(1).max(800),
});

export async function POST(request: Request) {
  await ensureSeeded();
  const user = await getCurrentUser();
  const body = await request.json().catch(() => ({}));
  const parsed = chatSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Message is required" }, { status: 400 });
  }

  const [lots, slots, activeCoupons] = await Promise.all([
    db.select().from(parkingLots),
    db.select().from(parkingSlots),
    db.select().from(coupons).where(eq(coupons.isActive, true)),
  ]);

  const lotSummary = lots.map((lot) => {
    const ls = slots.filter((s) => s.lotId === lot.id);
    const avail = ls.filter((s) => s.status === "available").length;
    const evAvail = ls.filter((s) => s.isEvEnabled && s.status === "available").length;
    return `${lot.name} (${lot.city}): ${avail}/${ls.length} open, ${evAvail} EV bays, ₹${lot.baseHourlyRate}/hr`;
  });

  const q = parsed.data.message.toLowerCase();
  let deterministicReply = "";

  if (q.includes("coupon") || q.includes("discount") || q.includes("promo")) {
    const list = activeCoupons
      .map(
        (c) =>
          `${c.code} (${
            c.discountType === "percentage" ? `${c.discountValue}% off` : `₹${c.discountValue} off`
          }, min ₹${c.minBookingAmount})`
      )
      .join(", ");
    deterministicReply = `Active ParkBotix coupons right now: ${list}. You can also redeem Loyalty Points at 1 point = ₹0.50 during booking.`;
  } else if (q.includes("ev") || q.includes("charge") || q.includes("electric")) {
    const evHubs = lots
      .map((l) => {
        const evOpen = slots.filter(
          (s) => s.lotId === l.id && s.isEvEnabled && s.status === "available"
        ).length;
        return `${l.name}: ${evOpen} EV bays open`;
      })
      .join(" | ");
    deterministicReply = `Live EV Fast Charging availability — ${evHubs}. Use coupon EVGREEN for 25% off green mobility bookings.`;
  } else if (q.includes("cheap") || q.includes("price") || q.includes("rate")) {
    const sorted = [...lots].sort((a, b) => a.baseHourlyRate - b.baseHourlyRate);
    const cheapest = sorted[0];
    deterministicReply = cheapest
      ? `Most affordable hub right now is ${cheapest.name} at ₹${cheapest.baseHourlyRate}/hr (${
          slots.filter((s) => s.lotId === cheapest.id && s.status === "available").length
        } bays open).`
      : "No active lots configured.";
  } else {
    deterministicReply = `Here is live ParkBotix hub availability:\n• ${lotSummary.join(
      "\n• "
    )}\nTip: Click any hub card to pick an exact bay and generate an instant HMAC-signed Gate QR code.`;
  }

  const ai = await generateAiText(
    "You are ParkBotix Assistant, an expert smart parking concierge. Answer concisely using ONLY the live database facts provided below.",
    `Live Hubs:\n${lotSummary.join("\n")}\nActive Coupons: ${activeCoupons
      .map((c) => c.code)
      .join(", ")}\nLoyalty Rule: 1 point = ₹0.50\n\nUser Question: ${parsed.data.message}`,
    deterministicReply
  );

  await recordAiActivity({
    endpoint: "/api/chat",
    module: "CHAT",
    userId: user?.id ?? null,
    requestPayload: { message: parsed.data.message },
    responsePayload: { replyLength: ai.text.length, provider: ai.provider },
    provider: ai.provider,
    latencyMs: ai.latencyMs,
  });

  return Response.json({
    reply: ai.text,
    provider: ai.provider,
    latencyMs: ai.latencyMs,
  });
}
