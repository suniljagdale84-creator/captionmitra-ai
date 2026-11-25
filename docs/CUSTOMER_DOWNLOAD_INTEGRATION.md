# Customer download integration

The worker exposes a private internal endpoint:

GET /internal/customer/jobs/{jobId}/download?format=srt|txt

Required headers:
- Authorization: Bearer <WORKER_SHARED_SECRET> (service-to-service only)
- X-Customer-Access-Token: per-job 256-bit random customer token

The endpoint is bound to loopback (127.0.0.1) and requires the worker shared secret before validating the customer token. It checks job completion, expiry, stored token hash, private Blob result integrity, and requested format. It responds with an attachment and no-store headers.

Do not expose the worker port publicly. A public Next.js route/reverse-proxy must be implemented separately and must forward the worker secret only from server-side environment variables. Never put WORKER_SHARED_SECRET in browser code. The customer token must be delivered once through a protected job creation/confirmation response; that job creation flow is not implemented yet.

The customer token is a bearer credential. The future UI should avoid placing it in referrer-bearing URLs, avoid analytics capture, and not persist it in localStorage. Prefer a short-lived HttpOnly secure cookie or user-entered token exchange flow once the customer job creation experience is built.
