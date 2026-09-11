import { expect, test } from "bun:test";
import { fitWithin, VISION_MAX_EDGE, DICTATION_SAMPLE_RATE } from "../src/lib/media";
import { toNativePath, transcribeTimeoutMs, withStallTimeout } from "../src/lib/qvac";
import { missingOverlayKeys } from "../src/i18n";
import { STRINGS } from "../src/i18n/strings";
import { QUESTIONS } from "../src/i18n/questions";

test("toNativePath quita file:// y decodifica para que bare-fs encuentre el archivo", () => {
  expect(toNativePath("file:///data/user/0/dev.belta.baseiq/cache/ImagePicker/a%20b.jpg"))
    .toBe("/data/user/0/dev.belta.baseiq/cache/ImagePicker/a b.jpg");
  expect(toNativePath("file:///var/mobile/Containers/Data/rec.m4a")).toBe("/var/mobile/Containers/Data/rec.m4a");
  expect(toNativePath("file://localhost/tmp/x.m4a")).toBe("/tmp/x.m4a");
  expect(toNativePath("file:///C:/Users/x/img.jpg")).toBe("C:/Users/x/img.jpg");
  expect(toNativePath("/already/plain/path.jpg")).toBe("/already/plain/path.jpg");
  expect(toNativePath("  file:///spaced.jpg ")).toBe("/spaced.jpg");
  expect(toNativePath("file:///bad%zz.jpg")).toBe("/bad%zz.jpg");
});

test("fitWithin solo reduce; conserva proporción y no toca imágenes pequeñas", () => {
  expect(fitWithin({ width: 4000, height: 3000 })).toEqual({ width: VISION_MAX_EDGE, height: 576 });
  expect(fitWithin({ width: 3000, height: 4000 })).toEqual({ width: 576, height: VISION_MAX_EDGE });
  expect(fitWithin({ width: 640, height: 480 })).toBeNull();
  expect(fitWithin({ width: VISION_MAX_EDGE, height: 100 })).toBeNull();
  expect(fitWithin({ width: 0, height: 100 })).toBeNull();
  expect(fitWithin(null)).toBeNull();
  expect(fitWithin({ width: 10000, height: 10 }, 1000)).toEqual({ width: 1000, height: 1 });
});

test("el dictado se graba a 16 kHz, lo que Whisper consume sin resamplear", () => {
  expect(DICTATION_SAMPLE_RATE).toBe(16000);
});

test("transcribeTimeoutMs escala con la duración y tiene piso y techo", () => {
  expect(transcribeTimeoutMs(undefined)).toBe(45000);
  expect(transcribeTimeoutMs(0)).toBe(45000);
  expect(transcribeTimeoutMs(2000)).toBe(30000);
  expect(transcribeTimeoutMs(20000)).toBe(80000);
  expect(transcribeTimeoutMs(600000)).toBe(180000);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("withStallTimeout: una descarga lenta con progreso no expira; un stall sí", async () => {
  const seen: number[] = [];
  // 5 ticks × 30 ms = 150 ms total, well over the 60 ms stall window.
  const ok = await withStallTimeout(async (report) => {
    for (let pct = 20; pct <= 100; pct += 20) {
      await sleep(30);
      report(pct);
    }
    return "id-1";
  }, 60, "load_timeout", (pct) => seen.push(pct));
  expect(ok).toBe("id-1");
  expect(seen).toEqual([20, 40, 60, 80, 100]);

  await expect(withStallTimeout(async (report) => {
    report(10);
    await sleep(200);
    return "late";
  }, 50, "load_timeout")).rejects.toThrow("load_timeout");

  await expect(withStallTimeout(async () => {
    throw new Error("boom");
  }, 50, "load_timeout")).rejects.toThrow("boom");

  // Repeated identical ticks (download stuck at the same %) do not re-arm.
  await expect(withStallTimeout(async (report) => {
    for (let i = 0; i < 6; i++) {
      await sleep(20);
      report(40);
    }
    return "stuck";
  }, 50, "load_timeout")).rejects.toThrow("load_timeout");
});

test("missingOverlayKeys detecta claves nuevas frente a una caché vieja", () => {
  const full = { strings: { ...STRINGS.en } as Record<string, string>, questions: { ...QUESTIONS.en } as Record<string, string> };
  expect(missingOverlayKeys(full)).toEqual({ strings: [], questions: [] });
  const stale = { strings: { ...full.strings }, questions: { ...full.questions } };
  delete stale.strings["capture.loadingVisionModel"];
  delete stale.strings["capture.loadingVoiceModel"];
  const qKey = Object.keys(QUESTIONS.en)[0];
  delete stale.questions[qKey];
  const missing = missingOverlayKeys(stale);
  expect(missing.strings.sort()).toEqual(["capture.loadingVisionModel", "capture.loadingVoiceModel"]);
  expect(missing.questions).toEqual([qKey]);
});
