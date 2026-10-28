import { z } from "zod";
import { outcomeSchema } from "./models.ts";

export const promoBodySchema = z.object({ expectedCost: z.number().int().nonnegative() }).strict();
export const promoResultSchema = outcomeSchema.extend({ promoCode: z.string().nullable() });
export type PromoResult = z.infer<typeof promoResultSchema>;
