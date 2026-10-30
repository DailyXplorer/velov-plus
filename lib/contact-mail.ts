import { accountCall, BASE, type Auth } from "./cyclocity.ts";
import { type ContactBody, contactMessage } from "./contact-models.ts";
import { MAIL_ACCEPT, MAIL_FIELDS } from "./guesses.ts";
import { sendWrite } from "./write-transport.ts";

export async function postContactMail({ body, ...auth }: Auth & { body: ContactBody }, send: typeof fetch = sendWrite) {
  const form = new FormData();
  form.set(MAIL_FIELDS.complaintType, body.complaintType);
  form.set(MAIL_FIELDS.message, contactMessage(body));
  const { outcome } = await accountCall(`${BASE}/accounts/${encodeURIComponent(auth.accountId)}/mail`, {
    method: "POST", headers: { Accept: MAIL_ACCEPT }, body: form
  }, auth, "Vélo’v n’a pas confirmé l’envoi du message.", send, true);
  return outcome;
}
