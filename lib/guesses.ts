// Guesses are switches for a future reviewed change, never runtime retries/fallback submissions.
// Medium confidence: VLSKit 5fea3c62 Models/Subscription.swift L203–211 encodes isAutoRenewal directly.
// https://github.com/Fyroeo/VLSKit/blob/5fea3c62a541de8b0061755c17b76e612dcfa155/Sources/VLSKit/Models/Subscription.swift#L203-L211
export const AUTO_RENEWAL_FIELD = "isAutoRenewal";
// Low confidence alternatives suggested by GET renewalDetails; not sent automatically.
export const AUTO_RENEWAL_FALLBACK_FIELDS = ["autoRenewal", "autoRenewalValue"] as const;
// High confidence: community-README.md Android table L2418; VLSKit SubscriptionService.swift L129–136.
export const SUBSCRIPTION_MEDIA_TYPE = "application/vnd.subscription.v6+json";

/** Via: community-README §5.5 / Android ug/r.g; VLSKit SubscriptionService.swift (5fea3c6), lines 93–116. Confidence: high for media type and field. */
export const VIA_MEDIA_TYPE = "application/vnd.subscription.v6+json";
export const VIA_STATION_FIELD = "stationId";
/** VLSKit Models/Subscription.swift lines 131–158 uses Int64 and explicitly assumes a station number (unverified). Confidence: medium. Change only this line to "uuid" after confirmation, never retry with another format. */
export const VIA_STATION_IDENTIFIER: "number" | "uuid" = "number";

/** Mail: high confidence field names/media type, Android qi/e.a in docs/api/community-README.md §10 table.
 * Enum values: medium confidence, reconstructed client Fyroeo/VLSKit EmailService.swift L6–14.
 * Source: https://github.com/Fyroeo/VLSKit/blob/5fea3c62a541de8b0061755c17b76e612dcfa155/Sources/VLSKit/Services/EmailService.swift
 * No live request has confirmed this format. Change these constants, never retry with a fallback body.
 */
export const MAIL_ACCEPT = "multipart/form-data";
// tripId is deliberately omitted: VLSKit calls it tripNumber; the dashboard only has a UUID.
// The selected trip token is appended to message instead of guessing its identifier kind.
export const MAIL_FIELDS = { complaintType: "complaintType", message: "message" } as const;
export const MAIL_COMPLAINT_TYPES = ["TRIP", "SUBSCRIPTION", "PAYMENT", "PARKING"] as const;
/** VLSKit SubscriptionService.requestExtraTime returns the string TransactionState enum (Models/Trip.swift), confidence: medium; object envelope is a defensive compatibility assumption. */
export const VIA_SUCCESS_STATE = "OK";
export const VIA_STATE_FIELD = "transactionState";
