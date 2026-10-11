# Notifications
Dashwise can act as a notification gateway for anything that can call an HTTP webhook.

## Receiving notifications from external systems

### POST /api/v1/notifications/{topic}
- **Auth:** Use a scoped topic token as `{topic}`, or use an owned topic ID with `Authorization: Bearer <dws_session_token>`. User/password Basic authentication is not supported.
- **Body:** JSON containing `content`, or a JSON payload to use directly as notification content.
- **Behavior:** A valid scoped token publishes to its linked topic. With a device-session token, the server checks ownership of the topic ID before publishing. The response is `200 OK` with `{ ok: true, topicId, itemId }`.
- **Errors:** `401` for invalid credentials; `404` when a topic ID is unavailable to the authenticated user.

`POST /api/v1/notifications` is an authenticated compatibility acknowledgement returning `{ ok: true }`; use the topic-specific route to publish a notification.

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
curl -X POST "${URL}/api/v1/notifications/${topicToken}" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Backing up TV shows","details":"Backup completed"}'
```

Every request that reaches `/api/v1/notifications/{topicToken}` with a valid topic token becomes a PocketBase `notificationItems` record for the linked topic. Dashwise’s frontend consumes the items via `/api/v1/notifications` for the current user, marks the items as `received`, and lets the UI display unread counts or badge states.