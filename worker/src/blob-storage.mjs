import { get } from "@vercel/blob";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

function validatePathname(pathname) {
  if (typeof pathname !== "string" || pathname.length < 1 || pathname.length > 1024) {
    throw new Error("Invalid Blob pathname");
  }
  if (pathname.startsWith("/") || pathname.includes("\\") || pathname.includes("..") ||
      /^[a-z]+:\/\//i.test(pathname) || /[?#]/.test(pathname)) {
    throw new Error("Unsafe Blob pathname");
  }
  return pathname;
}

export async function downloadPrivateBlob({
  pathname, token, destination, tempDir, maxBytes = 209715200,
  getBlob = get
}) {
  validatePathname(pathname);
  if (!token) throw new Error("Blob token is required");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 209715200) {
    throw new Error("Invalid maximum download size");
  }

  const root = resolve(tempDir);
  const target = resolve(destination);
  if (target === root || !target.startsWith(root + sep)) {
    throw new Error("Download destination must be inside the worker temp directory");
  }

  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  let result;
  try {
    result = await getBlob(pathname, { access: "private", token });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("Private Blob could not be retrieved");
    }
    if (result.blob?.size != null && result.blob.size > maxBytes) {
      throw new Error("Private Blob exceeds the configured size limit");
    }

    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new Error("Private Blob exceeds the configured size limit"));
        else callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(result.stream),
      limiter,
      createWriteStream(target, { flags: "wx", mode: 0o600 })
    );
    if (bytes < 1) throw new Error("Private Blob is empty");
    return {
      path: target,
      sizeBytes: bytes,
      contentType: result.blob?.contentType || null,
      pathname: result.blob?.pathname || pathname
    };
  } catch (error) {
    await rm(target, { force: true }).catch(() => {});
    throw error;
  }
}
