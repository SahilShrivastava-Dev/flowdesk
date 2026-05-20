import axios from 'axios';

const BASE = 'https://graph.facebook.com/v19.0';

/**
 * While META_TEMPLATES_APPROVED !== "true", every outbound message falls back
 * to the pre-approved `hello_world` template (no parameters).
 * Flip the env var to "true" once Meta approves task_assignment + task_escalation
 * and all calls automatically switch to the real templates.
 */
function resolveTemplate(
  name: string,
  parameters: string[]
): { name: string; parameters: string[] } {
  if (process.env.META_TEMPLATES_APPROVED === 'true') {
    return { name, parameters };
  }
  // hello_world is pre-approved and takes zero parameters
  return { name: 'hello_world', parameters: [] };
}

/**
 * Normalise a phone number to E.164 digits-only format required by Meta.
 * "+91 98765 43210" → "919876543210"
 * "919876543210"   → "919876543210"
 */
function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, ''); // strip everything except digits
}

export async function sendWhatsApp(
  to: string,
  templateName: string,
  parameters: string[]
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return;
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number after normalisation — skipping send');
    return;
  }

  const resolved = resolveTemplate(templateName, parameters);
  console.log(`[WhatsApp] Sending "${resolved.name}" → ${normalisedTo}`);

  await axios.post(
    `${BASE}/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: normalisedTo,
      type: 'template',
      template: {
        name:     resolved.name,
        language: { code: 'en_US' },
        components: resolved.parameters.length > 0
          ? [{ type: 'body', parameters: resolved.parameters.map((text) => ({ type: 'text', text })) }]
          : [],
      },
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return;
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number after normalisation — skipping send');
    return;
  }

  await axios.post(
    `${BASE}/${phoneId}/messages`,
    {
      messaging_product: 'whatsapp',
      to: normalisedTo,
      type: 'text',
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}
