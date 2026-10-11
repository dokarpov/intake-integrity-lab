export function buildWebhookRequest(envelope, { url, headers = {} } = {}) {
  if (!url) throw new Error('webhook_url_missing');
  return {
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      'x-idempotency-key': envelope.intakeId,
      ...headers
    },
    body: envelope
  };
}
