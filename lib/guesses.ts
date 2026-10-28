// Guesses are switches for a future reviewed change, never runtime retries/fallback submissions.
// Medium confidence: VLSKit 5fea3c62 Models/Subscription.swift L203–211 encodes isAutoRenewal directly.
// https://github.com/Fyroeo/VLSKit/blob/5fea3c62a541de8b0061755c17b76e612dcfa155/Sources/VLSKit/Models/Subscription.swift#L203-L211
export const AUTO_RENEWAL_FIELD = "isAutoRenewal";
// Low confidence alternatives suggested by GET renewalDetails; not sent automatically.
export const AUTO_RENEWAL_FALLBACK_FIELDS = ["autoRenewal", "autoRenewalValue"] as const;
// High confidence: community-README.md Android table L2418; VLSKit SubscriptionService.swift L129–136.
export const SUBSCRIPTION_MEDIA_TYPE = "application/vnd.subscription.v6+json";
