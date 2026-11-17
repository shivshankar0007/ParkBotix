import {
  pgTable,
  serial,
  text,
  integer,
  doublePrecision,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// 1. users
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    // superadmin | admin | owner | employee | customer
    role: text("role").notNull().default("customer"),
    assignedLotId: integer("assigned_lot_id"),
    vehicleNumber: text("vehicle_number"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("users_role_idx").on(table.role),
    index("users_assigned_lot_idx").on(table.assignedLotId),
  ]
);

// 27. sessions (secure HTTP-only cookie sessions)
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at").notNull(),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ]
);

// 2. parking_lots
export const parkingLots = pgTable(
  "parking_lots",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    address: text("address").notNull(),
    city: text("city").notNull().default("Bengaluru"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    totalSlots: integer("total_slots").notNull().default(20),
    baseHourlyRate: doublePrecision("base_hourly_rate").notNull().default(40),
    evRateMultiplier: doublePrecision("ev_rate_multiplier").notNull().default(1.35),
    ownerId: integer("owner_id").references(() => users.id, { onDelete: "set null" }),
    operatingHours: text("operating_hours").notNull().default("24/7"),
    isActive: boolean("is_active").notNull().default(true),
    amenities: jsonb("amenities").$type<string[]>().default(["CCTV", "24/7 Security", "QR Gate"]),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("parking_lots_owner_idx").on(table.ownerId),
    index("parking_lots_city_idx").on(table.city),
  ]
);

// 3. parking_slots
export const parkingSlots = pgTable(
  "parking_slots",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    slotCode: text("slot_code").notNull(),
    floor: text("floor").notNull().default("G1"),
    // standard | ev | compact | handicapped | vip
    slotType: text("slot_type").notNull().default("standard"),
    // available | reserved | occupied | locked | maintenance
    status: text("status").notNull().default("available"),
    hourlyRate: doublePrecision("hourly_rate").notNull().default(40),
    isEvEnabled: boolean("is_ev_enabled").notNull().default(false),
    lockExpiresAt: timestamp("lock_expires_at"),
    currentBookingId: integer("current_booking_id"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("parking_slots_lot_code_uidx").on(table.lotId, table.slotCode),
    index("parking_slots_status_idx").on(table.status),
  ]
);

// 4. bookings
export const bookings = pgTable(
  "bookings",
  {
    id: serial("id").primaryKey(),
    bookingCode: text("booking_code").notNull().unique(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => parkingSlots.id, { onDelete: "cascade" }),
    vehicleNumber: text("vehicle_number").notNull(),
    startTime: timestamp("start_time").notNull(),
    endTime: timestamp("end_time").notNull(),
    actualEntryTime: timestamp("actual_entry_time"),
    actualExitTime: timestamp("actual_exit_time"),
    durationHours: doublePrecision("duration_hours").notNull().default(1),
    baseAmount: doublePrecision("base_amount").notNull(),
    discountAmount: doublePrecision("discount_amount").notNull().default(0),
    loyaltyDiscount: doublePrecision("loyalty_discount").notNull().default(0),
    loyaltyPointsUsed: integer("loyalty_points_used").notNull().default(0),
    totalAmount: doublePrecision("total_amount").notNull(),
    finalAmount: doublePrecision("final_amount").notNull(),
    // pending | confirmed | active | completed | cancelled | expired
    status: text("status").notNull().default("confirmed"),
    qrCodePayload: text("qr_code_payload").notNull(),
    qrSignature: text("qr_signature").notNull(),
    couponCode: text("coupon_code"),
    autoExtendEnabled: boolean("auto_extend_enabled").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("bookings_user_idx").on(table.userId),
    index("bookings_lot_idx").on(table.lotId),
    index("bookings_slot_status_idx").on(table.slotId, table.status),
  ]
);

// 5. payments
export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id").notNull().unique(),
    upiId: text("upi_id"),
    amount: doublePrecision("amount").notNull(),
    // upi | card | wallet | cash
    method: text("method").notNull().default("upi"),
    // initiated | pending_verification | verified | failed | refunded
    status: text("status").notNull().default("initiated"),
    verificationCode: text("verification_code"),
    verifiedAt: timestamp("verified_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("payments_booking_idx").on(table.bookingId),
    index("payments_user_idx").on(table.userId),
    index("payments_status_idx").on(table.status),
  ]
);

// 6. penalties
export const penalties = pgTable(
  "penalties",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    amount: doublePrecision("amount").notNull(),
    // unpaid | paid | waived
    status: text("status").notNull().default("unpaid"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("penalties_lot_idx").on(table.lotId)]
);

// 7. api_keys
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: jsonb("scopes").$type<string[]>().default(["read:lots", "read:ai"]),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 8. ai_activity
export const aiActivity = pgTable(
  "ai_activity",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    module: text("module").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    lotId: integer("lot_id").references(() => parkingLots.id, { onDelete: "set null" }),
    requestPayload: jsonb("request_payload").$type<Record<string, unknown>>(),
    responsePayload: jsonb("response_payload").$type<Record<string, unknown>>(),
    provider: text("provider").notNull().default("deterministic-engine"),
    latencyMs: integer("latency_ms").notNull().default(0),
    status: text("status").notNull().default("success"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("ai_activity_endpoint_idx").on(table.endpoint)]
);

// 9. password_resets
export const passwordResets = pgTable(
  "password_resets",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    otpHash: text("otp_hash").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("password_resets_email_idx").on(table.email)]
);

// 10. settings
export const settings = pgTable("settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  category: text("category").notNull().default("general"),
  description: text("description"),
  updatedById: integer("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 11. feedback
export const feedback = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    bookingId: integer("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    rating: integer("rating").notNull(),
    category: text("category").notNull().default("experience"),
    comment: text("comment").notNull(),
    adminResponse: text("admin_response"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("feedback_lot_idx").on(table.lotId)]
);

// 12. coupons
export const coupons = pgTable("coupons", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  description: text("description").notNull(),
  // percentage | fixed
  discountType: text("discount_type").notNull().default("percentage"),
  discountValue: doublePrecision("discount_value").notNull(),
  minBookingAmount: doublePrecision("min_booking_amount").notNull().default(0),
  maxDiscount: doublePrecision("max_discount").notNull().default(500),
  usageLimit: integer("usage_limit").notNull().default(100),
  usedCount: integer("used_count").notNull().default(0),
  validFrom: timestamp("valid_from").defaultNow().notNull(),
  validUntil: timestamp("valid_until").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdById: integer("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 13. user_loyalty
export const userLoyalty = pgTable("user_loyalty", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  pointsBalance: integer("points_balance").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  totalRedeemed: integer("total_redeemed").notNull().default(0),
  tier: text("tier").notNull().default("Bronze"),
  lastTransactionNote: text("last_transaction_note"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// 14. subscription_plans
export const subscriptionPlans = pgTable("subscription_plans", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  monthlyPrice: doublePrecision("monthly_price").notNull(),
  includedHours: integer("included_hours").notNull().default(30),
  discountPercent: doublePrecision("discount_percent").notNull().default(10),
  evBonus: boolean("ev_bonus").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 15. user_subscriptions
export const userSubscriptions = pgTable(
  "user_subscriptions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: integer("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date").defaultNow().notNull(),
    endDate: timestamp("end_date").notNull(),
    status: text("status").notNull().default("active"),
    hoursRemaining: doublePrecision("hours_remaining").notNull().default(30),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("user_subscriptions_user_idx").on(table.userId)]
);

// 16. penalty_share_logs
export const penaltyShareLogs = pgTable("penalty_share_logs", {
  id: serial("id").primaryKey(),
  penaltyId: integer("penalty_id")
    .notNull()
    .references(() => penalties.id, { onDelete: "cascade" }),
  ownerId: integer("owner_id").references(() => users.id, { onDelete: "set null" }),
  platformShare: doublePrecision("platform_share").notNull(),
  ownerShare: doublePrecision("owner_share").notNull(),
  settled: boolean("settled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 17. dynamic_pricing_logs
export const dynamicPricingLogs = pgTable(
  "dynamic_pricing_logs",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    baseRate: doublePrecision("base_rate").notNull(),
    computedRate: doublePrecision("computed_rate").notNull(),
    occupancyRate: doublePrecision("occupancy_rate").notNull(),
    demandFactor: doublePrecision("demand_factor").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("dynamic_pricing_lot_idx").on(table.lotId)]
);

// 18. shadow_reservations
export const shadowReservations = pgTable(
  "shadow_reservations",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => parkingSlots.id, { onDelete: "cascade" }),
    confidenceScore: doublePrecision("confidence_score").notNull().default(0.82),
    predictedArrival: timestamp("predicted_arrival").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    status: text("status").notNull().default("holding"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("shadow_reservations_lot_idx").on(table.lotId)]
);

// 19. parking_events
export const parkingEvents = pgTable(
  "parking_events",
  {
    id: serial("id").primaryKey(),
    eventType: text("event_type").notNull(),
    lotId: integer("lot_id").references(() => parkingLots.id, { onDelete: "set null" }),
    slotId: integer("slot_id").references(() => parkingSlots.id, { onDelete: "set null" }),
    bookingId: integer("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role"),
    details: jsonb("details").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("parking_events_type_idx").on(table.eventType),
    index("parking_events_lot_idx").on(table.lotId),
  ]
);

// 20. slot_morphs
export const slotMorphs = pgTable("slot_morphs", {
  id: serial("id").primaryKey(),
  lotId: integer("lot_id")
    .notNull()
    .references(() => parkingLots.id, { onDelete: "cascade" }),
  slotId: integer("slot_id")
    .notNull()
    .references(() => parkingSlots.id, { onDelete: "cascade" }),
  fromType: text("from_type").notNull(),
  toType: text("to_type").notNull(),
  reason: text("reason").notNull(),
  triggeredBy: text("triggered_by").notNull().default("rsms-engine"),
  activeUntil: timestamp("active_until").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 21. auto_extensions
export const autoExtensions = pgTable(
  "auto_extensions",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => parkingSlots.id, { onDelete: "cascade" }),
    previousEndTime: timestamp("previous_end_time").notNull(),
    newEndTime: timestamp("new_end_time").notNull(),
    addedMinutes: integer("added_minutes").notNull().default(30),
    extraCharge: doublePrecision("extra_charge").notNull(),
    status: text("status").notNull().default("applied"),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("auto_extensions_booking_idx").on(table.bookingId)]
);

// 22. congestion_predictions
export const congestionPredictions = pgTable(
  "congestion_predictions",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    predictedFor: timestamp("predicted_for").notNull(),
    predictedOccupancy: doublePrecision("predicted_occupancy").notNull(),
    congestionLevel: text("congestion_level").notNull(),
    recommendedAction: text("recommended_action").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0.85),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("congestion_predictions_lot_idx").on(table.lotId)]
);

// 23. vehicle_fingerprints
export const vehicleFingerprints = pgTable(
  "vehicle_fingerprints",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vehicleNumber: text("vehicle_number").notNull().unique(),
    vehicleMake: text("vehicle_make").notNull(),
    vehicleColor: text("vehicle_color").notNull(),
    fingerprintHash: text("fingerprint_hash").notNull(),
    trustScore: doublePrecision("trust_score").notNull().default(0.95),
    verifiedCount: integer("verified_count").notNull().default(1),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("vehicle_fingerprints_user_idx").on(table.userId)]
);

// 24. ev_charging_slots
export const evChargingSlots = pgTable(
  "ev_charging_slots",
  {
    id: serial("id").primaryKey(),
    slotId: integer("slot_id")
      .notNull()
      .unique()
      .references(() => parkingSlots.id, { onDelete: "cascade" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    chargerType: text("charger_type").notNull().default("CCS2 DC Fast"),
    powerKw: doublePrecision("power_kw").notNull().default(22),
    // idle | charging | reserved | fault
    status: text("status").notNull().default("idle"),
    currentSessionKwh: doublePrecision("current_session_kwh").notNull().default(0),
    ratePerKwh: doublePrecision("rate_per_kwh").notNull().default(18),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [index("ev_charging_slots_lot_idx").on(table.lotId)]
);

// 25. marketplace_offers
export const marketplaceOffers = pgTable(
  "marketplace_offers",
  {
    id: serial("id").primaryKey(),
    bookingId: integer("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    sellerId: integer("seller_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    buyerId: integer("buyer_id").references(() => users.id, { onDelete: "set null" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => parkingSlots.id, { onDelete: "cascade" }),
    askingPrice: doublePrecision("asking_price").notNull(),
    originalPrice: doublePrecision("original_price").notNull(),
    // open | claimed | cancelled | expired
    status: text("status").notNull().default("open"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("marketplace_offers_status_idx").on(table.status)]
);

// 26. crowd_density
export const crowdDensity = pgTable(
  "crowd_density",
  {
    id: serial("id").primaryKey(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => parkingLots.id, { onDelete: "cascade" }),
    zoneName: text("zone_name").notNull(),
    densityScore: doublePrecision("density_score").notNull(),
    vehicleCount: integer("vehicle_count").notNull().default(0),
    pedestrianCount: integer("pedestrian_count").notNull().default(0),
    // low | moderate | high | critical
    alertLevel: text("alert_level").notNull().default("low"),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  (table) => [index("crowd_density_lot_idx").on(table.lotId)]
);

// 28. audit_logs (Phase 11 security & administrative audit trail)
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: integer("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    outcome: text("outcome").notNull().default("success"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("audit_logs_actor_idx").on(table.actorId),
    index("audit_logs_action_idx").on(table.action),
  ]
);
