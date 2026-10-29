export const AUTO_RENEWAL_FIELD = "isAutoRenewal";
export const SUBSCRIPTION_MEDIA_TYPE = "application/vnd.subscription.v6+json";

export const VIA_MEDIA_TYPE = "application/vnd.subscription.v6+json";
export const VIA_STATION_FIELD = "stationId";
export const VIA_STATION_IDENTIFIER: "number" | "uuid" = "number";

export const MAIL_ACCEPT = "multipart/form-data";
export const MAIL_FIELDS = { complaintType: "complaintType", message: "message" } as const;
export const MAIL_COMPLAINT_TYPES = ["TRIP", "SUBSCRIPTION", "PAYMENT", "PARKING"] as const;
export const VIA_SUCCESS_STATE = "OK";
export const VIA_STATE_FIELD = "transactionState";


export const PROMOCODE_ACCEPT = "application/vnd.rewards.v5+json";
export const PROMOCODE_CODE_FIELD = "promoCode";
export const PROMOCODE_REWARD = "PROMOCODE";
