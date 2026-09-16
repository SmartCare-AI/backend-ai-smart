# P-15 · Chat (Socket.IO)

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P1 — stretch |
| **Estimate** | 2 days |
| **Owner** | Dev A |
| **Depends on** | A-02 |
| **Blocks** | P-16, D-07 |

## Goal
Real-time messaging between a patient and the doctor treating them. (BRD TR-002)

## API + socket
```
POST /chats               {otherUserId, visitId?}   -> creates or reuses the chat
GET  /chats/my?page=&limit=                         -> chats with lastMessage + unread
GET  /chats/{id}/messages?cursor=&limit=            -> { items, nextCursor }  NEWEST FIRST
POST /chats/{id}/messages {messageText?, fileId?}   REST fallback
PATCH /chats/{id}/read
PATCH /chats/{id}/leave
DELETE /chats/messages/{messageId}                  soft delete, sender only
```
Socket: connect to the **host without `/api/v1`** with
`auth: {token: accessToken}`. Events are listed in
[API-GUIDE section 8](../API-GUIDE.md#8-socketio-p-15).

## Scope
- [ ] Socket service: connect after login, reconnect with backoff, reconnect
      after a token refresh, disconnect on logout
- [ ] Chat list with the other participant's `fullName`, last message and unread count
- [ ] Conversation screen with cursor-based infinite scroll upward
- [ ] Send over the socket (`chat:send`), fall back to REST when disconnected
- [ ] Typing indicator (`chat:typing`), debounced
- [ ] Read receipts: `chat:read` on open, render `readAt` ticks
- [ ] Attachments via `POST /uploads` then `fileId`
- [ ] Connection banner when the socket is down
- [ ] Long-press own message to delete

## Acceptance criteria
- [ ] Two devices exchange messages in under a second without a manual refresh
- [ ] Killing the network and returning reconnects and backfills missed messages
- [ ] Opening a chat with a doctor who has never treated you returns 403 with the
      "book an appointment first" message — that is the privacy rule, surface it
- [ ] A message sent while offline is queued and sent on reconnect, or clearly fails
- [ ] Unread counts clear on open and the badge updates
- [ ] An expired access token does not leave a permanently dead socket
- [ ] Arabic messages render RTL inside LTR bubbles correctly

## Gotchas
- The field is **`messageText`**, not `text`.
- `POST /chats` takes a **user id**, not a profile id — the only place in the API
  that does.
- The socket authenticates on handshake only. After a token refresh you must
  reconnect, or the next reconnect attempt will fail with the old token.
