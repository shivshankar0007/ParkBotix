import crypto from "crypto";
import { count, eq } from "drizzle-orm";
import {
  db,
  users,
  parkingLots,
  parkingSlots,
  evChargingSlots,
  bookings,
  payments,
  coupons,
  userLoyalty,
  subscriptionPlans,
  userSubscriptions,
  feedback,
  penalties,
  penaltyShareLogs,
  settings,
  dynamicPricingLogs,
  congestionPredictions,
  crowdDensity,
  vehicleFingerprints,
  marketplaceOffers,
  parkingEvents,
  aiActivity,
  auditLogs,
} from "@/db";
import { hashPassword } from "@/lib/auth";
import { createSignedQr } from "@/lib/qr";

let seedPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (!seedPromise) {
    seedPromise = runSeedIfEmpty().catch((err) => {
      seedPromise = null;
      throw err;
    });
  }
  return seedPromise;
}

async function runSeedIfEmpty(): Promise<void> {
  const existing = await db.select({ value: count() }).from(users);
  if ((existing[0]?.value ?? 0) > 0) {
    return;
  }

  const superAdminEmail =
    process.env.SUPERADMIN_EMAIL?.trim() || "superadmin@parkbotix.local";
  const superAdminPass =
    process.env.SUPERADMIN_PASSWORD?.trim() || "ParkBotix@Super2026!";

  const [
    superAdminHash,
    adminHash,
    ownerHash,
    employeeHash,
    customerHash,
  ] = await Promise.all([
    hashPassword(superAdminPass),
    hashPassword("Admin@1234"),
    hashPassword("Owner@1234"),
    hashPassword("Scanner@1234"),
    hashPassword("Driver@1234"),
  ]);

  // 1. Seed Users across all 5 roles
  const insertedUsers = await db
    .insert(users)
    .values([
      {
        name: "Aarav Mehta (SuperAdmin)",
        email: superAdminEmail,
        phone: "+91 98450 10001",
        passwordHash: superAdminHash,
        role: "superadmin",
        vehicleNumber: "KA-01-SA-0001",
      },
      {
        name: "Priya Sharma (Operations Admin)",
        email: "admin@parkbotix.local",
        phone: "+91 98450 10002",
        passwordHash: adminHash,
        role: "admin",
        vehicleNumber: "KA-01-AD-0002",
      },
      {
        name: "Vikram Rao (Metro Hub Owner)",
        email: "owner1@parkbotix.local",
        phone: "+91 98450 10003",
        passwordHash: ownerHash,
        role: "owner",
        vehicleNumber: "KA-03-OW-1101",
      },
      {
        name: "Neha Kulkarni (Tech Park Owner)",
        email: "owner2@parkbotix.local",
        phone: "+91 98450 10004",
        passwordHash: ownerHash,
        role: "owner",
        vehicleNumber: "KA-05-OW-2202",
      },
      {
        name: "Rohan Verma (Gate Scanner Officer)",
        email: "scanner@parkbotix.local",
        phone: "+91 98450 10005",
        passwordHash: employeeHash,
        role: "employee",
        vehicleNumber: "KA-01-EM-3303",
      },
      {
        name: "Ananya Nair",
        email: "driver@parkbotix.local",
        phone: "+91 98450 10006",
        passwordHash: customerHash,
        role: "customer",
        vehicleNumber: "KA-01-MJ-4821",
      },
    ])
    .returning();

  const [superAdmin, adminUser, owner1, owner2, scannerEmp, customer] = insertedUsers;

  // 2. Seed Parking Lots
  const insertedLots = await db
    .insert(parkingLots)
    .values([
      {
        name: "MG Road Metro Smart Hub",
        address: "14 Mahatma Gandhi Rd, Shivaji Nagar, Bengaluru 560001",
        city: "Bengaluru",
        latitude: 12.9756,
        longitude: 77.6066,
        totalSlots: 16,
        baseHourlyRate: 50,
        evRateMultiplier: 1.3,
        ownerId: owner1.id,
        operatingHours: "24/7 Automated QR Gate",
        amenities: ["CCTV", "CCS2 Fast EV", "Covered Deck", "ANPR Gate", "Valet"],
        imageUrl: "/images/smart-parking-hero.jpg",
      },
      {
        name: "Indiranagar 100ft Smart Plaza",
        address: "742 100 Feet Rd, HAL 2nd Stage, Indiranagar, Bengaluru 560038",
        city: "Bengaluru",
        latitude: 12.9784,
        longitude: 77.6408,
        totalSlots: 14,
        baseHourlyRate: 60,
        evRateMultiplier: 1.25,
        ownerId: owner1.id,
        operatingHours: "06:00 AM – 11:30 PM",
        amenities: ["CCTV", "Type-2 EV", "Roof Solar", "QR Gate"],
        imageUrl: "/images/smart-parking-hero.jpg",
      },
      {
        name: "Electronic City Phase 1 Tech Deck",
        address: "Plot 44 Hosur Rd, Electronics City Phase 1, Bengaluru 560100",
        city: "Bengaluru",
        latitude: 12.8452,
        longitude: 77.6602,
        totalSlots: 16,
        baseHourlyRate: 35,
        evRateMultiplier: 1.35,
        ownerId: owner2.id,
        operatingHours: "24/7 Automated QR Gate",
        amenities: ["CCTV", "60kW DC Fast EV", "Multi-Level", "Security Patrol"],
        imageUrl: "/images/smart-parking-hero.jpg",
      },
      {
        name: "Koramangala Nexus Smart Garage",
        address: "21 Hosur Rd, 7th Block, Koramangala, Bengaluru 560095",
        city: "Bengaluru",
        latitude: 12.9345,
        longitude: 77.6115,
        totalSlots: 12,
        baseHourlyRate: 45,
        evRateMultiplier: 1.3,
        ownerId: owner2.id,
        operatingHours: "07:00 AM – 12:00 AM",
        amenities: ["CCTV", "EV Chargers", "Mall Direct Lift", "QR Gate"],
        imageUrl: "/images/smart-parking-hero.jpg",
      },
    ])
    .returning();

  // Assign scanner employee to Lot 1
  await db
    .update(users)
    .set({ assignedLotId: insertedLots[0].id })
    .where(eq(users.id, scannerEmp.id));

  // 3. Seed Parking Slots & EV Charging Slots for all 4 lots
  const allSlots: Array<typeof parkingSlots.$inferSelect> = [];
  for (const lot of insertedLots) {
    const slotValues: Array<typeof parkingSlots.$inferInsert> = [];
    const total = lot.totalSlots;
    const evCount = Math.max(2, Math.floor(total / 4));
    for (let i = 1; i <= total; i++) {
      const isEv = i <= evCount;
      const isVip = !isEv && i === evCount + 1;
      const isHandicapped = !isEv && i === evCount + 2;
      const floor = i <= Math.ceil(total / 2) ? "L1" : "L2";
      const code = isEv
        ? `EV-${String(i).padStart(2, "0")}`
        : `${floor === "L1" ? "A" : "B"}-${String(i).padStart(2, "0")}`;
      const slotType = isEv
        ? "ev"
        : isVip
        ? "vip"
        : isHandicapped
        ? "handicapped"
        : "standard";
      const rate = isEv
        ? Math.round(lot.baseHourlyRate * lot.evRateMultiplier)
        : isVip
        ? Math.round(lot.baseHourlyRate * 1.4)
        : lot.baseHourlyRate;

      slotValues.push({
        lotId: lot.id,
        slotCode: code,
        floor,
        slotType,
        status: "available",
        hourlyRate: rate,
        isEvEnabled: isEv,
      });
    }

    const createdSlots = await db
      .insert(parkingSlots)
      .values(slotValues)
      .returning();
    allSlots.push(...createdSlots);

    const evSlotsToInsert = createdSlots
      .filter((s) => s.isEvEnabled)
      .map((s, idx) => ({
        slotId: s.id,
        lotId: lot.id,
        chargerType: idx % 2 === 0 ? "CCS2 DC Fast" : "Type-2 AC 22kW",
        powerKw: idx % 2 === 0 ? 60 : 22,
        status: "idle",
        currentSessionKwh: 0,
        ratePerKwh: idx % 2 === 0 ? 20 : 15,
      }));
    if (evSlotsToInsert.length > 0) {
      await db.insert(evChargingSlots).values(evSlotsToInsert);
    }
  }

  // 4. Seed Coupons
  const now = new Date();
  const nextQuarter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  await db.insert(coupons).values([
    {
      code: "PARK20",
      description: "20% off smart parking bookings above ₹80 (max ₹100)",
      discountType: "percentage",
      discountValue: 20,
      minBookingAmount: 80,
      maxDiscount: 100,
      usageLimit: 500,
      usedCount: 14,
      validFrom: now,
      validUntil: nextQuarter,
      isActive: true,
      createdById: adminUser.id,
    },
    {
      code: "FIRST50",
      description: "Flat ₹50 instant off on bookings above ₹100",
      discountType: "fixed",
      discountValue: 50,
      minBookingAmount: 100,
      maxDiscount: 50,
      usageLimit: 250,
      usedCount: 28,
      validFrom: now,
      validUntil: nextQuarter,
      isActive: true,
      createdById: adminUser.id,
    },
    {
      code: "EVGREEN",
      description: "25% Green EV Mobility discount (max ₹150)",
      discountType: "percentage",
      discountValue: 25,
      minBookingAmount: 50,
      maxDiscount: 150,
      usageLimit: 300,
      usedCount: 9,
      validFrom: now,
      validUntil: nextQuarter,
      isActive: true,
      createdById: superAdmin.id,
    },
  ]);

  // 5. Seed Loyalty accounts (1 point = ₹0.50)
  await db.insert(userLoyalty).values([
    {
      userId: customer.id,
      pointsBalance: 320,
      totalEarned: 440,
      totalRedeemed: 120,
      tier: "Silver",
      lastTransactionNote: "Earned 40 pts from MG Road Metro Smart Hub session",
    },
    {
      userId: superAdmin.id,
      pointsBalance: 1000,
      totalEarned: 1000,
      totalRedeemed: 0,
      tier: "Gold",
      lastTransactionNote: "Platform founder loyalty balance",
    },
    {
      userId: adminUser.id,
      pointsBalance: 200,
      totalEarned: 200,
      totalRedeemed: 0,
      tier: "Bronze",
      lastTransactionNote: "Welcome loyalty credit",
    },
  ]);

  // 6. Seed Subscription Plans & Customer Subscription
  const plans = await db
    .insert(subscriptionPlans)
    .values([
      {
        name: "Metro Commuter Pass",
        description: "30 monthly smart parking hours + 10% extra discount across all hubs.",
        monthlyPrice: 999,
        includedHours: 30,
        discountPercent: 10,
        evBonus: false,
      },
      {
        name: "EV Charge & Park Pro",
        description: "50 monthly hours + priority CCS2/Type-2 EV bays + 15% discount.",
        monthlyPrice: 1699,
        includedHours: 50,
        discountPercent: 15,
        evBonus: true,
      },
      {
        name: "Executive Unlimited",
        description: "120 monthly hours + VIP bay priority + automatic free grace extension.",
        monthlyPrice: 2999,
        includedHours: 120,
        discountPercent: 25,
        evBonus: true,
      },
    ])
    .returning();

  await db.insert(userSubscriptions).values({
    userId: customer.id,
    planId: plans[0].id,
    startDate: now,
    endDate: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    status: "active",
    hoursRemaining: 24.5,
  });

  // 7. Seed Realistic Bookings (1 Confirmed Ready for QR Entry, 1 Active with Auto-Extend nearing expiry, 1 Completed)
  const lot1Slots = allSlots.filter((s) => s.lotId === insertedLots[0].id);
  const lot2Slots = allSlots.filter((s) => s.lotId === insertedLots[1].id);
  const lot3Slots = allSlots.filter((s) => s.lotId === insertedLots[2].id);

  const b1Start = new Date(now.getTime() - 15 * 60 * 1000);
  const b1End = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const qr1 = createSignedQr({
    bookingCode: "PBX-MG26-1001",
    lotId: insertedLots[0].id,
    slotId: lot1Slots[0].id,
    userId: customer.id,
    endTime: b1End,
  });

  // Active booking ending in 12 minutes so Auto-Extension Worker can actually extend it!
  const b2Start = new Date(now.getTime() - 108 * 60 * 1000);
  const b2End = new Date(now.getTime() + 12 * 60 * 1000);
  const qr2 = createSignedQr({
    bookingCode: "PBX-IN26-1002",
    lotId: insertedLots[1].id,
    slotId: lot2Slots[2].id,
    userId: customer.id,
    endTime: b2End,
  });

  const b3Start = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  const b3End = new Date(now.getTime() - 23 * 60 * 60 * 1000);
  const qr3 = createSignedQr({
    bookingCode: "PBX-EC26-1003",
    lotId: insertedLots[2].id,
    slotId: lot3Slots[1].id,
    userId: customer.id,
    endTime: b3End,
  });

  const createdBookings = await db
    .insert(bookings)
    .values([
      {
        bookingCode: "PBX-MG26-1001",
        userId: customer.id,
        lotId: insertedLots[0].id,
        slotId: lot1Slots[0].id,
        vehicleNumber: "KA-01-MJ-4821",
        startTime: b1Start,
        endTime: b1End,
        durationHours: 2,
        baseAmount: 130,
        discountAmount: 26,
        loyaltyDiscount: 0,
        loyaltyPointsUsed: 0,
        totalAmount: 130,
        finalAmount: 104,
        status: "confirmed",
        qrCodePayload: qr1.qrToken,
        qrSignature: qr1.signature,
        couponCode: "PARK20",
        autoExtendEnabled: true,
      },
      {
        bookingCode: "PBX-IN26-1002",
        userId: customer.id,
        lotId: insertedLots[1].id,
        slotId: lot2Slots[2].id,
        vehicleNumber: "KA-01-MJ-4821",
        startTime: b2Start,
        endTime: b2End,
        actualEntryTime: b2Start,
        durationHours: 2,
        baseAmount: 150,
        discountAmount: 0,
        loyaltyDiscount: 20,
        loyaltyPointsUsed: 40,
        totalAmount: 150,
        finalAmount: 130,
        status: "active",
        qrCodePayload: qr2.qrToken,
        qrSignature: qr2.signature,
        autoExtendEnabled: true,
      },
      {
        bookingCode: "PBX-EC26-1003",
        userId: customer.id,
        lotId: insertedLots[2].id,
        slotId: lot3Slots[1].id,
        vehicleNumber: "KA-01-MJ-4821",
        startTime: b3Start,
        endTime: b3End,
        actualEntryTime: b3Start,
        actualExitTime: new Date(b3End.getTime() + 18 * 60 * 1000),
        durationHours: 3,
        baseAmount: 141,
        discountAmount: 0,
        loyaltyDiscount: 0,
        loyaltyPointsUsed: 0,
        totalAmount: 141,
        finalAmount: 141,
        status: "completed",
        qrCodePayload: qr3.qrToken,
        qrSignature: qr3.signature,
        autoExtendEnabled: false,
      },
    ])
    .returning();

  // Sync slot statuses with seeded bookings
  await db
    .update(parkingSlots)
    .set({ status: "reserved", currentBookingId: createdBookings[0].id })
    .where(eq(parkingSlots.id, lot1Slots[0].id));
  await db
    .update(parkingSlots)
    .set({ status: "occupied", currentBookingId: createdBookings[1].id })
    .where(eq(parkingSlots.id, lot2Slots[2].id));

  // Mark a few more slots as occupied across lots for realistic live occupancy telemetry
  await db
    .update(parkingSlots)
    .set({ status: "occupied" })
    .where(eq(parkingSlots.id, lot1Slots[4].id));
  await db
    .update(parkingSlots)
    .set({ status: "occupied" })
    .where(eq(parkingSlots.id, lot1Slots[5].id));
  await db
    .update(parkingSlots)
    .set({ status: "occupied" })
    .where(eq(parkingSlots.id, lot3Slots[4].id));

  // 8. Seed Payments
  await db.insert(payments).values([
    {
      bookingId: createdBookings[0].id,
      userId: customer.id,
      transactionId: "TXN-UPI-260101",
      upiId: "ananya.nair@okicici",
      amount: 104,
      method: "upi",
      status: "verified",
      verificationCode: "849201",
      verifiedAt: now,
    },
    {
      bookingId: createdBookings[1].id,
      userId: customer.id,
      transactionId: "TXN-UPI-260102",
      upiId: "ananya.nair@okicici",
      amount: 130,
      method: "upi",
      status: "verified",
      verificationCode: "512984",
      verifiedAt: b2Start,
    },
    {
      bookingId: createdBookings[2].id,
      userId: customer.id,
      transactionId: "TXN-UPI-260103",
      upiId: "ananya.nair@okicici",
      amount: 141,
      method: "upi",
      status: "verified",
      verificationCode: "774120",
      verifiedAt: b3Start,
    },
  ]);

  // 9. Seed Penalty & Penalty Share Log for Owner 2
  const insertedPenalties = await db
    .insert(penalties)
    .values({
      bookingId: createdBookings[2].id,
      userId: customer.id,
      lotId: insertedLots[2].id,
      reason: "18 minutes overtime beyond scheduled exit",
      overtimeMinutes: 18,
      amount: 30,
      status: "paid",
    })
    .returning();

  await db.insert(penaltyShareLogs).values({
    penaltyId: insertedPenalties[0].id,
    ownerId: owner2.id,
    platformShare: 6,
    ownerShare: 24,
    settled: true,
  });

  // 10. Seed Feedback
  await db.insert(feedback).values([
    {
      userId: customer.id,
      lotId: insertedLots[0].id,
      bookingId: createdBookings[0].id,
      rating: 5,
      category: "scanner",
      comment: "Instant QR gate unlock and fast CCS2 charger on L1!",
      adminResponse: "Thank you Ananya! We recently upgraded L1 chargers to 60kW.",
      status: "resolved",
    },
    {
      userId: customer.id,
      lotId: insertedLots[2].id,
      bookingId: createdBookings[2].id,
      rating: 4,
      category: "navigation",
      comment: "Very clean tech deck. Signage near B-02 exit ramp could be brighter.",
      status: "open",
    },
  ]);

  // 11. Seed Vehicle Fingerprint
  await db.insert(vehicleFingerprints).values({
    userId: customer.id,
    vehicleNumber: "KA-01-MJ-4821",
    vehicleMake: "Tata Nexon EV Max",
    vehicleColor: "Pristine White",
    fingerprintHash: crypto
      .createHash("sha256")
      .update("KA-01-MJ-4821|Tata Nexon EV Max|Pristine White")
      .digest("hex")
      .slice(0, 32),
    trustScore: 0.97,
    verifiedCount: 12,
  });

  // 12. Seed Marketplace Offer
  await db.insert(marketplaceOffers).values({
    bookingId: createdBookings[0].id,
    sellerId: customer.id,
    lotId: insertedLots[0].id,
    slotId: lot1Slots[0].id,
    askingPrice: 95,
    originalPrice: 104,
    status: "open",
    expiresAt: b1End,
  });

  // 13. Seed Telemetry: Congestion Predictions, Dynamic Pricing, Crowd Density
  await db.insert(congestionPredictions).values(
    insertedLots.map((lot, idx) => ({
      lotId: lot.id,
      predictedFor: new Date(now.getTime() + 60 * 60 * 1000),
      predictedOccupancy: [0.76, 0.84, 0.52, 0.68][idx] ?? 0.65,
      congestionLevel: ["high", "high", "moderate", "moderate"][idx] ?? "moderate",
      recommendedAction:
        idx < 2
          ? "Enable +15% peak surge & divert standard sedans to L2"
          : "Maintain base rate and highlight EV bays on discovery feed",
      confidence: 0.88,
    }))
  );

  await db.insert(dynamicPricingLogs).values(
    insertedLots.map((lot, idx) => ({
      lotId: lot.id,
      baseRate: lot.baseHourlyRate,
      computedRate: Math.round(lot.baseHourlyRate * (idx < 2 ? 1.15 : 1.0)),
      occupancyRate: [0.76, 0.84, 0.52, 0.68][idx] ?? 0.6,
      demandFactor: idx < 2 ? 1.15 : 1.0,
      reason: idx < 2 ? "Evening metro peak demand surge" : "Balanced utilization",
    }))
  );

  await db.insert(crowdDensity).values(
    insertedLots.map((lot, idx) => ({
      lotId: lot.id,
      zoneName: "Main Entry Ramp & Lift Lobby",
      densityScore: [0.64, 0.72, 0.38, 0.55][idx] ?? 0.5,
      vehicleCount: [14, 17, 9, 11][idx] ?? 10,
      pedestrianCount: [22, 31, 12, 19][idx] ?? 15,
      alertLevel: idx === 1 ? "high" : "moderate",
    }))
  );

  // 14. Seed System Settings
  await db.insert(settings).values([
    {
      key: "loyalty_point_value_inr",
      value: "0.50",
      category: "loyalty",
      description: "INR discount value per redeemed loyalty point (1 point = ₹0.50)",
      updatedById: superAdmin.id,
    },
    {
      key: "loyalty_earn_rate_percent",
      value: "10",
      category: "loyalty",
      description: "Points awarded per ₹100 paid on verified bookings",
      updatedById: superAdmin.id,
    },
    {
      key: "overtime_penalty_per_15m_inr",
      value: "25",
      category: "pricing",
      description: "Overtime penalty charged per 15-minute grace-exceeded block",
      updatedById: superAdmin.id,
    },
    {
      key: "auto_extension_minutes",
      value: "30",
      category: "automation",
      description: "Default auto-extension window when slot has no upcoming conflict",
      updatedById: superAdmin.id,
    },
    {
      key: "upi_merchant_vpa",
      value: "parkbotix.smart@okhdfcbank",
      category: "payments",
      description: "Configured UPI VPA displayed during UPI checkout workflow",
      updatedById: superAdmin.id,
    },
  ]);

  // 15. Seed Events, AI Activity & Audit Log
  await db.insert(parkingEvents).values([
    {
      eventType: "qr_entry_verified",
      lotId: insertedLots[1].id,
      slotId: lot2Slots[2].id,
      bookingId: createdBookings[1].id,
      actorId: scannerEmp.id,
      actorRole: "employee",
      details: { bookingCode: "PBX-IN26-1002", gate: "North-01", method: "QR-HMAC" },
    },
    {
      eventType: "qr_exit_verified",
      lotId: insertedLots[2].id,
      slotId: lot3Slots[1].id,
      bookingId: createdBookings[2].id,
      actorId: scannerEmp.id,
      actorRole: "employee",
      details: { bookingCode: "PBX-EC26-1003", overtimeMinutes: 18, penaltyInr: 30 },
    },
  ]);

  await db.insert(aiActivity).values({
    endpoint: "/api/pcde/advise",
    module: "PCDE",
    userId: adminUser.id,
    lotId: insertedLots[0].id,
    requestPayload: { lotId: insertedLots[0].id },
    responsePayload: { congestionLevel: "high", recommendedMultiplier: 1.15 },
    provider: "deterministic-engine",
    latencyMs: 11,
    status: "success",
  });

  await db.insert(auditLogs).values({
    actorId: superAdmin.id,
    actorRole: "superadmin",
    action: "SYSTEM_BOOTSTRAP",
    entityType: "platform",
    entityId: "parkbotix-v2",
    outcome: "success",
    metadata: { lotsSeeded: insertedLots.length, slotsSeeded: allSlots.length },
  });
}
