import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from "expo-audio";
import { DICTATION_BIT_RATE, DICTATION_SAMPLE_RATE } from "../lib/media";
import { useTheme } from "../ui/theme";

const DICTATION: RecordingOptions = {
  extension: ".m4a",
  sampleRate: DICTATION_SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: DICTATION_BIT_RATE,
  android: { outputFormat: "mpeg4", audioEncoder: "aac" },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: "audio/webm", bitsPerSecond: DICTATION_BIT_RATE },
};

const MIN_MS = 700;

export function MicGlyph({ color, size = 20 }: { color: string; size?: number }) {
  const headW = size * 0.34;
  const headH = size * 0.46;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "flex-end" }}>
      <View
        style={{
          width: headW,
          height: headH,
          borderRadius: headW / 2,
          backgroundColor: color,
          marginBottom: size * 0.28,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          bottom: size * 0.18,
          width: size * 0.62,
          height: size * 0.42,
          borderBottomLeftRadius: size,
          borderBottomRightRadius: size,
          borderWidth: 2,
          borderTopWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ width: 2, height: size * 0.12, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ width: size * 0.42, height: 2, backgroundColor: color, borderRadius: 1, marginTop: 1 }} />
    </View>
  );
}

function VoiceBars({ color }: { color: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 18 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <VoiceBar key={i} color={color} delay={i * 90} peak={i === 2 ? 1 : i === 1 || i === 3 ? 0.82 : 0.55} />
      ))}
    </View>
  );
}

function VoiceBar({ color, delay, peak }: { color: string; delay: number; peak: number }) {
  const anim = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 220 + delay * 0.2, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.28, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    const id = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(id);
      loop.stop();
    };
  }, [anim, delay]);
  const scaleY = anim.interpolate({ inputRange: [0.28, 1], outputRange: [0.28, peak] });
  return (
    <Animated.View
      style={{
        width: 2.5,
        height: 16,
        borderRadius: 2,
        backgroundColor: color,
        transform: [{ scaleY }],
      }}
    />
  );
}

function PulseRing({ active, color }: { active: boolean; color: string }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      scale.setValue(1);
      opacity.setValue(0);
      return;
    }
    scale.setValue(1);
    const loop = Animated.loop(
      Animated.parallel([
        Animated.timing(scale, { toValue: 1.85, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.5, duration: 80, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1020, useNativeDriver: true }),
        ]),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, opacity, scale]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { borderRadius: 22, borderWidth: 2, borderColor: color, transform: [{ scale }], opacity },
      ]}
    />
  );
}

export function VoiceMicButton({
  disabled,
  transcribing,
  accessibilityLabel,
  onRecordingChange,
  onTranscribe,
  onPermissionDenied,
  onError,
  onTooShort,
}: {
  disabled?: boolean;
  transcribing?: boolean;
  accessibilityLabel: string;
  onRecordingChange: (recording: boolean) => void;
  onTranscribe: (uri: string, durationMs: number) => Promise<void>;
  onPermissionDenied: () => void;
  onError: (err?: unknown) => void;
  onTooShort: () => void;
}) {
  const { theme } = useTheme();
  const recorder = useAudioRecorder(DICTATION);
  const startedAt = useRef(0);
  const lock = useRef(false);
  const [recording, setRecording] = useState(false);
  const busy = disabled || transcribing;

  async function toggle() {
    if (busy || lock.current) return;
    lock.current = true;
    try {
      if (recording) {
        const durationMs = (() => {
          try {
            return recorder.getStatus().durationMillis ?? Date.now() - startedAt.current;
          } catch {
            return Date.now() - startedAt.current;
          }
        })();
        await recorder.stop();
        setRecording(false);
        onRecordingChange(false);
        const uri = recorder.uri;
        if (!uri) return;
        if (durationMs > 0 && durationMs < MIN_MS) {
          onTooShort();
          return;
        }
        await onTranscribe(uri, durationMs);
        return;
      }
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        onPermissionDenied();
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(DICTATION);
      recorder.record();
      startedAt.current = Date.now();
      setRecording(true);
      onRecordingChange(true);
    } catch (err) {
      setRecording(false);
      onRecordingChange(false);
      onError(err);
    } finally {
      lock.current = false;
    }
  }

  const fill = recording ? theme.color.danger : theme.color.primary;
  const glyph = theme.color.primaryText;

  return (
    <View style={styles.wrap}>
      <PulseRing active={recording} color={fill} />
      <Pressable
        onPress={toggle}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ busy: !!transcribing, selected: recording }}
        hitSlop={8}
        style={[styles.btn, { backgroundColor: fill, opacity: busy && !transcribing ? 0.45 : 1 }]}
      >
        {transcribing ? <ActivityIndicator color={glyph} size="small" /> : recording ? <VoiceBars color={glyph} /> : <MicGlyph color={glyph} />}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 44, height: 44 },
  btn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
