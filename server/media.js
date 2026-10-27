import { fileTypeFromBuffer } from "file-type";
import { parseBuffer } from "music-metadata";
import { problem } from "./security.js";
export async function inspectMedia(bytes) {
  const detected = await fileTypeFromBuffer(bytes).catch(() => null);
  if (
    !detected ||
    !["audio/mpeg", "video/mp4", "video/webm"].includes(detected.mime)
  )
    return null;
  try {
    const { format } = await parseBuffer(
      bytes,
      { mimeType: detected.mime, size: bytes.length },
      {
        skipCovers: true,
        duration: true,
        maxMemoryAllocation: 8 * 1024 * 1024,
        maxMetadataEntries: 10000,
      },
    );
    const video = format.trackInfo.find((t) => t.video),
      duration = format.containerDuration || format.duration;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
      throw new Error();
    if (detected.mime === "audio/mpeg") {
      if (!format.hasAudio || format.hasVideo) throw new Error();
      return {
        kind: "audio",
        mime: "audio/mpeg",
        extension: "mp3",
        metadata: { duration },
      };
    }
    if (
      !video ||
      !video.video.pixelWidth ||
      !video.video.pixelHeight ||
      video.video.pixelWidth * video.video.pixelHeight > 16_000_000
    )
      throw new Error();
    const codec = video.codecId || "";
    if (
      detected.mime === "video/mp4" &&
      !["avc1", "avc3", "av01"].includes(codec)
    )
      throw new Error();
    if (
      detected.mime === "video/webm" &&
      !["V_VP8", "V_VP9", "V_AV1"].includes(codec)
    )
      throw new Error();
    return {
      kind: "video",
      mime: detected.mime,
      extension: detected.mime === "video/mp4" ? "mp4" : "webm",
      metadata: {
        duration,
        width: video.video.pixelWidth,
        height: video.video.pixelHeight,
        codec,
      },
    };
  } catch {
    throw problem(
      "Choose a playable MP3, MP4 (H.264/AV1), or WebM video, up to 24 hours and 16 million pixels.",
    );
  }
}
