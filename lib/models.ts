import { z } from "zod";

export const profileSchema = z.object({
  firstName: z.string(), lastName: z.string(), email: z.string(),
  locked: z.boolean(), complete: z.boolean()
});
export const tripSchema = z.object({
  id: z.string(), status: z.string(), startedAt: z.string().nullable(), endedAt: z.string().nullable(),
  startStation: z.string().nullable(), endStation: z.string().nullable(),
  startStationNumber: z.number().nullable(), endStationNumber: z.number().nullable(),
  startStand: z.number().nullable(), endStand: z.number().nullable(), distance: z.number().nullable(),
  bikeNumber: z.number().nullable(), bikeType: z.enum(["mechanical", "electrical", "unknown"]),
  duration: z.number().nullable(), price: z.number().nullable(), fullPrice: z.number().nullable(), discount: z.number(),
  pointsEarned: z.number(), pointsSpent: z.number(),
  litigious: z.boolean(), isRated: z.boolean().nullable(), token: z.string().nullable(), origin: z.number().nullable()
});
export const rewardMovementSchema = z.object({
  id: z.string(), date: z.string().nullable(), label: z.string(), amount: z.number()
});
export const subscriptionSchema = z.object({
  title: z.string(), type: z.string(), validUntil: z.string().nullable(), active: z.boolean()
});
export const dashboardSchema = z.object({
  profile: profileSchema,
  // null: Vélo’v did not answer that read, the page says so instead of showing a default.
  rewards: z.object({ balance: z.number().nullable(), total: z.number().nullable(), autoSpend: z.boolean().nullable(), movements: z.array(rewardMovementSchema), rules: z.array(z.object({ name: z.string(), label: z.string(), points: z.number(), kind: z.enum(["earn", "spend"]) })) }),
  subscription: z.union([subscriptionSchema, z.literal("unavailable")]).nullable(), paymentValid: z.boolean().nullable(),
  trips: z.array(tripSchema).nullable(), ongoing: z.array(tripSchema).nullable(), bookings: z.number().nullable(),
  updatedAt: z.string(), warnings: z.array(z.string())
});
export const stationSchema = z.object({
  id: z.string(), number: z.number(), name: z.string(), address: z.string(),
  lat: z.number(), lon: z.number(), mechanical: z.number(), electrical: z.number(),
  stands: z.number(), open: z.boolean()
});
export const stationsSchema = z.object({ stations: z.array(stationSchema), updatedAt: z.string() });
export const bikeSchema = z.object({
  number: z.number(), type: z.enum(["mechanical", "electrical", "other"]), standNumber: z.number().nullable(),
  status: z.string().nullable(), statusLabel: z.string().nullable(), isReserved: z.boolean(),
  rating: z.object({ value: z.number(), count: z.number(), lastAt: z.string().nullable() }).nullable(),
  batteryPercent: z.number().nullable(), frameId: z.string().nullable(),
  lastTripAt: z.string().nullable(), lastControlAt: z.string().nullable(),
  nextCheckAt: z.string().nullable(), lastSignalAt: z.string().nullable(),
  nextReviewAt: z.string().nullable()
});
export type Dashboard = z.infer<typeof dashboardSchema>;
export type Trip = z.infer<typeof tripSchema>;
export type Station = z.infer<typeof stationSchema>;
export type Bike = z.infer<typeof bikeSchema>;
export type Page = "overview" | "trips" | "points" | "stations" | "account";
export type Resource<T> = { kind: "loading" } | { kind: "ready"; data: T } | { kind: "error"; message: string };

/** "Je déconseille" carries the rating of the chosen defect: 30 for a serious one, 60 otherwise. */
export const rateBodySchema = z.discriminatedUnion("recommended", [
  z.object({ bikeNumber: z.number().int().positive(), recommended: z.literal(true), rating: z.null() }).strict(),
  z.object({ bikeNumber: z.number().int().positive(), recommended: z.literal(false), rating: z.union([z.literal(30), z.literal(60)]) }).strict()
]);
export type RateBody = z.infer<typeof rateBodySchema>;

/** The official app offers the rating for 3 hours after the trip ends. */
const RATING_WINDOW = 3 * 3_600_000;
export function canRate(trip: Trip, now = Date.now()) {
  const ended = trip.endedAt ? new Date(trip.endedAt).getTime() : NaN;
  return trip.status === "FINISHED" && trip.bikeNumber != null && trip.isRated === false && now - ended < RATING_WINDOW;
}

export const loginSchema = z.object({ email: z.email().max(254), code: z.string().regex(/^\d{6}$/) });

/** "2002 - SAINT-EXUPÉRY / GARE D’OULLINS" -> "Saint-Exupéry / Gare d’Oullins": each word, hyphen part and elided word capitalised, inner d’ and l’ kept low. */
export function stationTitle(name: string) {
  return name.replace(/^\d+\s*[-–/]\s*/, "").toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s/(\-’'])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toLocaleUpperCase("fr-FR"))
    .replace(/(\s)([DL])(['’])(?=\p{L})/gu, (_, space: string, letter: string, apostrophe: string) => space + letter.toLowerCase() + apostrophe);
}

export function formatDate(value: string | null, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!value) return "Date indisponible";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date indisponible";
  return new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", ...options }).format(date);
}

export function formatPrice(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** A booking holds a bike for 15 minutes and costs 10 points (§ 5.9); the server never checks where the user stands, the app keeps 200 m. */
export const BOOKING_MINUTES = 15;
export const BOOKING_POINTS = 10;
export const RELEASE_DISTANCE = 200;
const positive = z.number().int().positive();
export const bookBodySchema = z.object({ stationNumber: positive, bikeNumber: positive }).strict();
export const unlockBodySchema = z.object({ stationNumber: positive, standNumber: positive, bikeNumber: positive }).strict();
export type BookBody = z.infer<typeof bookBodySchema>;
export type UnlockBody = z.infer<typeof unlockBodySchema>;
export const bookingSchema = z.object({
  id: z.string(), stationNumber: z.number(), stationName: z.string(), standNumber: z.number().nullable(), bikeNumber: z.number().nullable(),
  endsAt: z.string().nullable(), lat: z.number().nullable(), lon: z.number().nullable()
});
export type Booking = z.infer<typeof bookingSchema>;
/** What Vélo’v answered to a state-changing call, raw fields kept for debugging. httpStatus 0: no answer at all. */
export const outcomeSchema = z.object({
  ok: z.boolean(), httpStatus: z.number(), transactionState: z.string().nullable(), code: z.string().nullable(), message: z.string().nullable(), detail: z.string().nullable()
});
export type Outcome = z.infer<typeof outcomeSchema>;
export const bookResultSchema = outcomeSchema.extend({ booking: bookingSchema.nullable() });
export const unlockResultSchema = outcomeSchema.extend({ ongoing: z.array(tripSchema).nullable() });
export type BookResult = z.infer<typeof bookResultSchema>;
export type UnlockResult = z.infer<typeof unlockResultSchema>;
