/**
 * Pre-processing for media handed to the on-device models.
 *
 * Native Expo modules are imported lazily so this file stays importable from
 * `bun test`, where only the pure helpers run.
 */

/** Longest edge sent to the VLM. Qwen3.5-VL packs ~28 px per visual token, so
 * 768 px keeps a nameplate photo around 500–700 tokens: readable text, but an
 * encode that finishes in seconds on a phone CPU instead of tens of seconds
 * for a 12 MP capture. */
export const VISION_MAX_EDGE = 768;
/** JPEG quality for the downscaled copy; text on plates survives 0.8 fine. */
export const VISION_JPEG_QUALITY = 0.8;

/** Bitrate/rate for dictation: Whisper wants 16 kHz mono, so recording
 * anything richer only makes the FFmpeg decode inside the worker slower. */
export const DICTATION_SAMPLE_RATE = 16000;
export const DICTATION_BIT_RATE = 48000;

export interface Size {
  width: number;
  height: number;
}

/**
 * Size that fits `maxEdge` while preserving aspect ratio, or null when the
 * image is already small enough (no resize needed).
 */
export function fitWithin(size: Partial<Size> | null | undefined, maxEdge = VISION_MAX_EDGE): Size | null {
  const w = size?.width ?? 0;
  const h = size?.height ?? 0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return null;
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

export interface PreparedImage {
  uri: string;
  /** True when `uri` points at a temp file we created and should delete. */
  temp: boolean;
  width: number | null;
  height: number | null;
}

/**
 * Downscale + re-encode a picked photo for the vision model. Falls back to
 * the original URI if the manipulator is unavailable or fails, so a resize
 * problem never blocks the extraction itself.
 */
export async function prepareImageForVision(uri: string, size?: Partial<Size> | null): Promise<PreparedImage> {
  const known = size?.width && size?.height ? { width: size.width, height: size.height } : null;
  if (known && !fitWithin(known)) return { uri, temp: false, ...known };
  try {
    const { ImageManipulator, SaveFormat } = await import("expo-image-manipulator");
    const ctx = ImageManipulator.manipulate(uri);
    let dims: Size | null = known;
    if (!dims) {
      // Picker did not report dimensions: decode once to learn them.
      const probe = await ctx.renderAsync();
      dims = { width: probe.width, height: probe.height };
    }
    const target = fitWithin(dims);
    if (!target) return { uri, temp: false, ...dims };
    // One dimension only: the manipulator derives the other, preserving ratio.
    ctx.resize(target.width >= target.height ? { width: target.width } : { height: target.height });
    const image = await ctx.renderAsync();
    const out = await image.saveAsync({ compress: VISION_JPEG_QUALITY, format: SaveFormat.JPEG });
    return { uri: out.uri, temp: true, width: out.width, height: out.height };
  } catch (err) {
    console.warn("▸ image prepare failed, sending original:", err instanceof Error ? err.message : err);
    return { uri, temp: false, width: known?.width ?? null, height: known?.height ?? null };
  }
}

/** Best-effort removal of temp media (recordings, resized copies). */
export async function discardTempFile(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  try {
    const FileSystem = await import("expo-file-system/legacy");
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    /* cache dir is reclaimed by the OS eventually */
  }
}
