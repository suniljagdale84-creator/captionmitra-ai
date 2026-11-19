
import { issueSignedToken } from "@vercel/blob";
import {
  handleUploadPresigned,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 200 * 1024 * 1024;

const ALLOWED_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/x-matroska",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/mp4",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
];

async function verifyTurnstile(token: string, request: Request) {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (!secret) {
    throw new Error("Turnstile Secret Key is missing in Vercel.");
  }

  const ip = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        secret,
        response: token,
        remoteip: ip,
      }),
    }
  );

  if (!response.ok) return false;

  const result = (await response.json()) as {
    success: boolean;
  };

  return result.success === true;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadPresignedBody;

    const result = await handleUploadPresigned({
      body,
      request,

      getSignedToken: async (pathname, clientPayload) => {
        let turnstileToken = "";

        try {
          const payload = JSON.parse(clientPayload || "{}");
          turnstileToken = payload.turnstileToken || "";
        } catch {
          throw new Error("Invalid CAPTCHA information.");
        }

        if (!turnstileToken) {
          throw new Error("Please complete the CAPTCHA first.");
        }

        const verified = await verifyTurnstile(
          turnstileToken,
          request
        );

        if (!verified) {
          throw new Error("CAPTCHA verification failed. Please try again.");
        }

        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: MAX_FILE_SIZE,
          validUntil: Date.now() + 10 * 60 * 1000,
        });

        return {
          token,
          urlOptions: {
            allowedContentTypes: ALLOWED_CONTENT_TYPES,
            maximumSizeInBytes: MAX_FILE_SIZE,
            validUntil: Date.now() + 10 * 60 * 1000,
            addRandomSuffix: true,
            allowOverwrite: false,
          },
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Upload authorization failed.";

    return NextResponse.json(
      { error: message },
      { status: 400 }
    );
  }
}

