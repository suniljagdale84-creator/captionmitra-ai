# Customer status and download integration

## Implemented routes

The Next.js application exposes:

- `GET /api/customer/jobs/{jobId}`
- `GET /api/customer/jobs/{jobId}/download?format=srt|txt`

Both routes forward the per-job customer access token to the worker from server-side code. The browser sends the token in the `X-Customer-Access-Token` request header; it is not placed in a URL.

The worker validates the job ID and token against the SHA-256 token hash stored in PostgreSQL. Status responses expose only customer-safe progress and payment metadata. Downloads require a completed, unexpired job and a private result object that matches the requested SRT or TXT format.

Responses use no-store cache headers. The worker reads the private Vercel Blob result server-side and does not return the Blob URL to the browser.

## Customer credential handling

The job-creation route generates a cryptographically random 256-bit per-job token and stores only its SHA-256 digest. The raw token is returned in the job-creation response and held in the current page state. The UI provides a way to display the key again during the current session.

Treat this token as a bearer credential: anyone who obtains it may access that job's status and results. Do not log it, put it in URLs, send it to analytics, or store it in localStorage. A hardened account or secure token-recovery experience may be considered separately.

## Deployment boundary

The worker defaults to binding on loopback (127.0.0.1). The Next.js routes require a reachable `WORKER_API_URL`; when the app and worker are hosted separately, configure a private network or a carefully restricted reverse proxy. Do not expose worker administration endpoints publicly, and never put `WORKER_SHARED_SECRET` in browser code.

## Not yet verified

The route implementation and unit tests are present, but a live staging test is still required for job creation, status polling, SRT/TXT downloads, expired-result rejection, and worker/network failure behavior. Do not treat the customer download flow as production-ready until those checks pass.
