# Member privacy requests and review acknowledgements

This workflow records a member's own request for a data export or deletion and an administrator's acknowledgement that the request was reviewed. **Reviewed does not mean fulfilled.** These endpoints do not generate an export, return a download, delete or anonymize records, disable an account, revoke membership, or dispatch email/push notifications. Fulfillment and retention execution require their separately approved implementation.

## Member endpoints

- `POST /api/v1/tribes/:tribeId/privacy-requests` accepts exactly `{ "type": "export" }` or `{ "type": "deletion" }`. It returns HTTP 200 with `id`, `type`, `status`, `createdAt`, and nullable `reviewedAt`.
- `GET /api/v1/tribes/:tribeId/privacy-requests` lists only the authenticated member's requests in that Tribe, newest first. Optional `limit` defaults to 50 and is capped at 100; `offset` defaults to zero and is capped at 10,000.

Ownership comes from a current bearer session and active membership; caller-supplied user or membership IDs are rejected. Concurrent submissions of the same kind reuse the existing pending request and create one audit event. A new request of that kind can be recorded after the prior request has been reviewed.

## Administrator review

- `GET /api/v1/tribes/:tribeId/admin/privacy-requests` defaults to pending requests. It accepts `status=pending|reviewed|all` and the same bounded pagination. The projection adds only membership ID, display name, and member number so the authority can identify the request. It does not include contact fields, profile biography, or requested export contents.
- `POST /api/v1/tribes/:tribeId/admin/privacy-requests/:requestId/review` accepts no request body and returns HTTP 204. It records reviewer and review timestamp atomically. Retries and concurrent reviews acknowledge the existing review without changing its reviewer/time or duplicating its audit event.

Review requires a live enabled, verified account, live MFA session, and active administrator or owner role in the requested Tribe. An authority can acknowledge an existing request after its subject's membership becomes inactive. No request in another Tribe is exposed or changed.

## Persistence and security

Forward migration `010_privacy_requests.sql` adds request history and a partial unique index for one pending request of each kind per membership. No existing records are deleted or rewritten. There is no automatic purge or fulfillment job in this workflow.

Operations lock the actor's user and session, then their membership with `FOR NO KEY UPDATE`; review serializes on the selected request. The immutable membership key remains compatible with foreign-key key-share locks. Audits use `privacy.requested` and `privacy.reviewed`, reference the request ID, and contain empty metadata; request values and free-form notes are not logged. Input accepts no notes, URLs, retention dates, fulfillment flags, or arbitrary metadata. API responses use `Cache-Control: no-store`.

`verify-privacy-requests.ts` exercises disposable PostgreSQL concurrency, own/foreign authority boundaries, strict input, bounded lists, audit-failure rollback, and unchanged account/profile/membership state after review. Actual data export and erasure are intentionally outside these request/review endpoints.

## Native integration requirements

The member interface should offer **Request a data export** and **Request account deletion** as request actions. Explain that submission sends a request for administrator review and performs no immediate export or deletion. Submit only the selected `type` using the current session and selected Tribe; do not send user IDs, membership IDs, notes, or fulfillment fields.

Show the returned request and refresh the member's request history after a successful response. Display `pending` as **Awaiting review** and `reviewed` as **Review acknowledged**, with an explanation that acknowledgement does not confirm fulfillment. Do not present an export download, an account-deleted state, or a fulfillment date from these responses. A pending retry returns the same request ID; disable submission while a request is in flight and do not show success before HTTP 200.

Keep empty history, loading, unavailable membership, and failed requests distinct. Treat authentication failure as a session problem; do not substitute another Tribe or persist request history across logout/account/Tribe changes. Responses are private and must not be shared through a general member directory or public URL. Use the bounded list parameters rather than assuming an unbounded history.

## Administrator integration requirements

Expose the privacy-request review surface only within the selected Tribe's server-authorized administrator/owner context. The backend remains authoritative even if controls are hidden. Start with pending requests and provide explicit reviewed/all filters and bounded pagination. Render only the review DTO's identifying fields and request timestamps; this interface does not require email, phone, date of birth, or private profile contents.

Use **Mark reviewed** for the acknowledgement action. Explain that this records review only, and avoid labels such as approve deletion, export ready, fulfilled, or deleted. Send a bodyless POST and refresh pending/history views only after HTTP 204. Repeated acknowledgements preserve the original reviewer/time and return the same success status. Clear prior Tribe data on context changes, distinguish denied access from an empty queue, and handle audit/storage failures as unsuccessful reviews.

Native/admin integration tests should verify the exact scoped URLs and request bodies, request-history refresh, duplicate-pending handling, acknowledged-versus-fulfilled wording, safe 401/403/404 handling, in-flight state, and clearing data when the session or Tribe changes. This document describes integration requirements; it does not claim that those interfaces or fulfillment tools have been implemented.
