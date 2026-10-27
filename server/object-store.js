import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { pipeline } from "node:stream/promises";
import { createWriteStream, createReadStream } from "node:fs";
import {stat} from 'node:fs/promises';
export function storageOptionsFromEnv(env = process.env) {
  const quota = Number(env.WORKSPACE_STORAGE_MB ?? 1024) * 1024 * 1024,
    maxUpload = Number(env.MAX_UPLOAD_MB ?? 100) * 1024 * 1024;
  if (
    !Number.isSafeInteger(quota) ||
    quota < 1 ||
    !Number.isSafeInteger(maxUpload) ||
    maxUpload < 1 ||
    maxUpload > 500 * 1024 * 1024
  )
    throw new Error(
      "Use positive storage limits; MAX_UPLOAD_MB cannot exceed 500.",
    );
  if (!env.S3_BUCKET&&!env.S3_BACKUP_BUCKET) return { quota, maxUpload };
  if (env.S3_ENDPOINT) {
    const url = new URL(env.S3_ENDPOINT);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)||env.S3_ALLOW_HTTP==='true')
      )
    )
      throw new Error(
        "Use HTTPS for S3_ENDPOINT, or loopback HTTP for local testing.",
      );
    if (url.username || url.password || url.search || url.hash)
      throw new Error("Use a plain S3 endpoint URL.");
  }
  const common={endpoint:env.S3_ENDPOINT,region:env.S3_REGION||env.AWS_REGION||'us-east-1',forcePathStyle:env.S3_FORCE_PATH_STYLE==='true'};
  return {
    quota,
    maxUpload,
    objectStore: env.S3_BUCKET?createObjectStore({
      bucket: env.S3_BUCKET,
      prefix: env.S3_PREFIX || "openqr/media/",
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION || env.AWS_REGION || "us-east-1",
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    }):undefined,
    backupStore:env.S3_BACKUP_BUCKET?createObjectStore({...common,bucket:env.S3_BACKUP_BUCKET,prefix:env.S3_BACKUP_PREFIX||'openqr/backups/'}):undefined,
    backupBucket: env.S3_BACKUP_BUCKET,
    backupPrefix: env.S3_BACKUP_PREFIX || "openqr/backups/",
  };
}
export function createObjectStore({
  bucket,
  prefix = "openqr/media/",
  client,
  endpoint,
  region = "us-east-1",
  forcePathStyle = false,
}) {
  if (
    !bucket ||
    !/^[a-zA-Z0-9._/-]+$/.test(prefix) ||
    prefix.split("/").includes("..")
  )
    throw new Error("Choose an S3 bucket and a safe, nonempty prefix.");
  prefix = prefix.replace(/^\/+|\/+$/g, "") + "/";
  client ||= new S3Client({
    region,
    endpoint,
    forcePathStyle,
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  const send = (command) =>
      client.send(command, { abortSignal: AbortSignal.timeout(30000) }),
    key = (name) => prefix + name;
  return {
    kind: "s3",
    bucket,
    prefix,
    client,
    async put(name, body, mime = "application/octet-stream") {
      await send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key(name),
          Body: body,
          ContentType: mime,
        }),
      );
    },
    async read(name) {
      const response = await send(
        new GetObjectCommand({ Bucket: bucket, Key: key(name) }),
      );
      return Buffer.from(await response.Body.transformToByteArray());
    },
    async copyTo(name, path) {
      const response = await send(
        new GetObjectCommand({ Bucket: bucket, Key: key(name) }),
      );
      await pipeline(response.Body, createWriteStream(path, { flags: "wx" }));
    },
    async remove(name) {
      await send(new DeleteObjectCommand({ Bucket: bucket, Key: key(name) }));
    },
    async ready() {
      await send(new HeadBucketCommand({ Bucket: bucket }));
    },
    async serve(name, req, res) {
      const range = req.get("range");
      if (range && !/^bytes=(\d+-\d*|-\d+)$/.test(range)) {
        res.status(416).end();
        return;
      }
      let result;
      try {
        result = await send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key(name),
            ...(range ? { Range: range } : {}),
          }),
        );
      } catch (error) {
        if (error.$metadata?.httpStatusCode === 416) {
          res.status(416).end();
          return;
        }
        throw error;
      }
      res.set("Accept-Ranges", "bytes");
      if (result.ContentLength !== undefined)
        res.set("Content-Length", String(result.ContentLength));
      if (result.ContentRange)
        res.status(206).set("Content-Range", result.ContentRange);
      if (req.method === "HEAD") {
        result.Body.destroy();
        res.end();
        return;
      }
      await pipeline(result.Body, res);
    },
    async uploadArchive(
      path,
      name,
      targetBucket = bucket,
      targetPrefix = prefix,
    ) {
      await client.send(
        new PutObjectCommand({
          Bucket: targetBucket,
          Key: targetPrefix.replace(/\/?$/, "/") + name,
          Body: createReadStream(path),
          ContentLength:(await stat(path)).size,
          ContentType: "application/gzip",
        }),
        { abortSignal: AbortSignal.timeout(120000) },
      );
    },
  };
}
