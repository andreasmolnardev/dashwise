# Notifications
Dashwise can act as a notification gateway for anything that can call an HTTP webhook.

## Receiving notifications from external systems

### POST /api/v1/notifications
- **Auth:** A topic token (see below) passed either as `Authorization: Bearer <topicToken>` or via the `?token=` query parameter.
- **Body:** Any JSON payload. Whatever you send becomes the `content` of the `notificationItems` entry in PocketBase (Dashwise does not impose a schema).
- **Behavior:** The token is resolved against `notificationTopicTokens`. If it exists, is not expired, and is linked to a topic, the server creates a `notificationItems` document with `status: sent`, `source: token`, and the provided content. The response is `201 Created` with `{ ok: true, topicId, itemId }`.
- **Errors:** `401` if the token is missing or invalid, `400` if the token resolves but lacks a topic.

## Topic tokens (automation keys)
Topic tokens let automation systems send notifications on behalf of a topic without exposing a full user session. Tokens are stored in `notificationTopicTokens` and tie back to a `notificationTopics` record.

### POST /api/v1/notifications/topicTokens
- **Auth:** Bearer session token for a Dashwise user.
- **Body:** `{ topicId?, topicName?, expires? }`. Provide either `topicId` or `topicName` (the server ensures the topic belongs to the authenticated user). `expires` may be any ISO-ish date string. When provided it must parse to a future date; the server stores the value as ISO.
- **Response:** `201 Created` with `{ item: { id, token, topic: { id, title, userId }, expires?, created } }`. The response includes the raw token so you can copy it into your automation; keep it secret because it is the only time Dashwise returns it.
- **Extras:** Dashwise generates each token as a secure 96-hex-character string and links it to the topic via the relation field.

## Example usage

### Shoutrrr
```text
Expression: generic://${URL}/api/v1/notifications/${topicToken}$?template=json
Headers: Authorization: Bearer ${topicToken}
```

### cURL (send notification via token)
```bash
curl -X POST ${URL}/api/v1/notifications \
  -H "Authorization: Bearer ${topicToken}" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Backing up TV shows","details":"Backup completed"}'
```

Every request that reaches `/api/v1/notifications` with a valid topic token becomes a PocketBase `notificationItems` record for the linked topic. Dashwise’s frontend consumes the items via `/api/v1/notifications` for the current user, marks the items as `received`, and lets the UI display unread counts or badge states.