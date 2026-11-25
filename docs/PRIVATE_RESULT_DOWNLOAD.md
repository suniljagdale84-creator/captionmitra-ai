# Private result storage and customer download contract

## Worker output
The worker produces one private JSON result object per completed job. It contains captions.srt content with subtitle timestamps, captions.txt plain transcript content, job ID, output language, duration, and segment count.

The worker writes this object with the Vercel Blob SDK using private access and stores only its pathname in caption_jobs.result_blob_path. It never returns a Blob URL to the browser.

## Customer download route — required before launch
An authenticated application route must authenticate the customer, load the job by opaque ID, verify ownership, require completed status, read the private Blob server-side, and return only the requested SRT or TXT with a safe attachment filename and Cache-Control: no-store.

The browser must never supply a Blob pathname or URL. Rate-limit downloads and avoid logging transcript content.

Customer authentication and ownership columns are not implemented yet. This worker storage module is not a customer-facing download feature and must not be exposed until authentication is implemented and tested.

## Retention
A scheduled cleanup process must delete source and result blobs for expired jobs and remove temporary worker directories. Local worker temporary files are cleaned in finally; remote Blob retention still needs a durable cleanup job and lifecycle policy.
