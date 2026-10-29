import { z } from "zod";
import { MAIL_COMPLAINT_TYPES } from "./guesses.ts";

export const contactBodySchema = z.object({
  complaintType: z.enum(MAIL_COMPLAINT_TYPES),
  message: z.string().trim().min(1).max(1500),
  tripToken: z.string().trim().min(1).max(128).regex(/^[^\p{Cc}]*$/u).optional()
}).strict();
export type ContactBody = z.infer<typeof contactBodySchema>;
export const CONTACT_BODY_LIMIT = 10_240;

export function contactFits(body: unknown) {
  return new TextEncoder().encode(JSON.stringify(body)).length <= CONTACT_BODY_LIMIT;
}

export function contactMessage(body: ContactBody) {
  return [body.message.trim(), body.tripToken ? `Code du trajet : ${body.tripToken}` : null].filter(Boolean).join("\n\n");
}
