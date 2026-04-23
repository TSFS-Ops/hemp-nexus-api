# `acceptance_receipt.created` outbound webhook

Fires once per acceptance receipt, immediately after the receipt email is
verifiably delivered (i.e. `notification_dispatches.status = 'delivered'`
with a matching `email_send_log` row).

Subscribe by inserting a row into `webhook_endpoints` with
`events @> ARRAY['acceptance_receipt.created']` and `status = 'active'`.

## Delivery headers

| Header                | Description                                              |
| --------------------- | -------------------------------------------------------- |
| `Content-Type`        | `application/json`                                       |
| `X-Webhook-Event`     | `acceptance_receipt.created`                             |
| `X-Webhook-Timestamp` | ISO-8601 UTC timestamp of the outbound send (replay)     |
| `X-Webhook-Signature` | Hex-encoded HMAC-SHA256 of the **raw body** with secret  |

## Replay protection

Reject any request whose `X-Webhook-Timestamp` is more than **5 minutes**
older than your server clock. The signature is bound to the body, so
re-broadcasting an old payload will still verify cryptographically — only
the timestamp guard prevents replay.

## Verifying the signature (Node.js)

```ts
import crypto from "node:crypto";

function verify(rawBody: string, header: string, secret: string): boolean {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  // timing-safe compare
  return crypto.timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(header, "hex"),
  );
}
```

## Payload

```json
{
  "event": "acceptance_receipt.created",
  "timestamp": "2026-04-23T10:21:00.000Z",
  "orgId": "<initiator_org_id>",
  "data": {
    "receipt_id": "uuid",
    "receipt_version": 1,
    "match_id": "uuid",
    "engagement_id": "uuid",
    "initiator_org_id": "uuid",
    "counterparty_org_id": "uuid | null",
    "counterparty_email": "string | null",
    "accepted_at": "ISO-8601",
    "attestation_id": "uuid | null",
    "signature": {
      "algorithm": "sha256",
      "hash": "hex digest of signed_payload",
      "signed_payload": "canonical signed payload string"
    },
    "delivery": {
      "dispatch_id": "uuid",
      "message_id": "provider message id",
      "delivered_at": "ISO-8601"
    }
  }
}
```

The `signature.hash` and `signature.signed_payload` mirror exactly what is
stored in `acceptance_receipts.signature_hash` /
`acceptance_receipts.signed_payload`. Integrators can recompute the
SHA-256 of `signed_payload` and compare to `hash` for an end-to-end
integrity check independent of the HMAC transport guarantee.

## Reliability

* HMAC-signed delivery via the shared `_shared/webhooks.ts` helper.
* Failures recorded in `webhook_deliveries` with `next_retry_at` set 5 min out;
  the `webhook-retry` worker handles back-off.
* Circuit breaker (`webhook_record_failure`) trips an endpoint after 10
  consecutive failures.
* Polling fallback at `GET /functions/v1/webhook-events?event_type=acceptance_receipt.created`.
