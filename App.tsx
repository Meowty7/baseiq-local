import { useCallback, useEffect, useRef, useState } from "react";
import { useFonts } from "expo-font";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import {
  Animated, BackHandler, Dimensions, Easing, PanResponder, Platform, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, ToastAndroid, View,
} from "react-native";
import { useStore } from "./src/lib/store";
import { ObservationCapture, type ObservationCaptureHandle } from "./src/components/ObservationCapture";
import { RecordsTab, type RecordsTabHandle } from "./src/components/RecordsTab";
import { InsightsTab } from "./src/components/InsightsTab";
import { ThemeProvider, font, useTheme, type Theme } from "./src/ui/theme";
import { I18nProvider, LANG_CODES, LANG_PICKER_LABELS, useI18n, type Lang } from "./src/i18n";
import { Select } from "./src/ui/primitives";

type Tab = "capture" | "records" | "insights";
type Store = ReturnType<typeof useStore>;

const TAB_META: { key: Tab; icon: string; labelKey: string }[] = [
  { key: "capture", icon: "＋", labelKey: "tab.capture" },
  { key: "records", icon: "☰", labelKey: "tab.records" },
  { key: "insights", icon: "◈", labelKey: "tab.insights" },
];

const SWIPE_DISTANCE = 60;
const SWIPE_DIRECTION_RATIO = 2;
const EXIT_PRESS_WINDOW_MS = 2000;

export default function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}

function AppShell() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const store = useStore();
  const { theme } = useTheme();
  const styles = makeStyles(theme);

  if (!fontsLoaded) return <SafeAreaView style={styles.safe} />;

  return (
    <I18nProvider lang={store.lang} localizing={store.uiLocalizing}>
      <AppChrome store={store} />
    </I18nProvider>
  );
}

function AppChrome({ store }: { store: Store }) {
  const { theme, toggleMode } = useTheme();
  const { t, localizing } = useI18n();
  const styles = makeStyles(theme);
  const [activeTab, setActiveTab] = useState<Tab>("capture");
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const [captureBusy, setCaptureBusy] = useState(false);
  const onCaptureBusy = useCallback((busy: boolean) => setCaptureBusy(busy), []);
  const [focusClient, setFocusClient] = useState<string | null>(null);
  const focusClientRef = useRef(focusClient);
  focusClientRef.current = focusClient;
  const goToRecords = useCallback((client: string) => {
    setFocusClient(client);
    setActiveTab("records");
  }, []);

  const captureRef = useRef<ObservationCaptureHandle>(null);
  const recordsRef = useRef<RecordsTabHandle>(null);

  const screenWidth = Dimensions.get("window").width;
  const activeIndex = TAB_META.findIndex((tab) => tab.key === activeTab);
  // One Animated.Value for rest + drag. A separate drag overlay reset on
  // release snaps the row back for a frame before the settle animation.
  const trackX = useRef(new Animated.Value(-activeIndex * screenWidth)).current;
  const trackXBase = useRef(-activeIndex * screenWidth);
  const animateTrackTo = useCallback((idx: number) => {
    trackXBase.current = -idx * screenWidth;
    Animated.timing(trackX, {
      toValue: trackXBase.current,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [screenWidth, trackX]);

  useEffect(() => {
    animateTrackTo(activeIndex);
  }, [activeIndex, animateTrackTo]);

  const lastBackPressRef = useRef(0);

  // Unwind edit → filter → Captura; second back within 2s exits.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const tab = activeTabRef.current;
      if (tab === "capture" && captureRef.current?.handleBack()) return true;
      if (tab === "records") {
        if (recordsRef.current?.handleBack()) return true;
        if (focusClientRef.current) {
          setFocusClient(null);
          return true;
        }
      }
      if (tab !== "capture") {
        setActiveTab("capture");
        return true;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < EXIT_PRESS_WINDOW_MS) return false;
      lastBackPressRef.current = now;
      ToastAndroid.show(t("nav.pressAgainToExit"), ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, [t]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_DIRECTION_RATIO,
      onPanResponderGrant: () => {
        trackX.stopAnimation((value) => { trackXBase.current = value; });
      },
      onPanResponderMove: (_, g) => {
        const idx = TAB_META.findIndex((tab) => tab.key === activeTabRef.current);
        const resisted = (idx === 0 && g.dx > 0) || (idx === TAB_META.length - 1 && g.dx < 0) ? g.dx / 3 : g.dx;
        trackX.setValue(trackXBase.current + resisted);
      },
      onPanResponderRelease: (_, g) => {
        const idx = TAB_META.findIndex((tab) => tab.key === activeTabRef.current);
        if (g.dx <= -SWIPE_DISTANCE && idx < TAB_META.length - 1) setActiveTab(TAB_META[idx + 1].key);
        else if (g.dx >= SWIPE_DISTANCE && idx > 0) setActiveTab(TAB_META[idx - 1].key);
        else animateTrackTo(idx);
      },
      onPanResponderTerminate: () => {
        const idx = TAB_META.findIndex((tab) => tab.key === activeTabRef.current);
        animateTrackTo(idx);
      },
    }),
  ).current;

  const aiLabel = localizing
    ? (store.uiLocalizeProgress != null ? t("lang.localizingPct", { n: Math.round(store.uiLocalizeProgress) }) : t("lang.localizing"))
    : captureBusy && activeTab !== "capture"
      ? t("ai.extracting")
      : store.status.ready
        ? t("ai.ready", { device: store.status.device ? ` · ${store.status.device.toUpperCase()}` : "" })
        : store.progress != null
          ? t("ai.loadingPct", { n: Math.round(store.progress) })
          : t("ai.loading");

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.color.surface} />

      <View style={styles.header}>
        <View style={styles.aiStatus}>
          <View style={[styles.dot, { backgroundColor: localizing || captureBusy ? theme.color.warn : store.status.ready ? theme.color.ok : theme.color.textTertiary }]} />
          <Text style={theme.type.caption}>{aiLabel}</Text>
        </View>
        <View style={styles.headerActions}>
          <Select
            style={styles.langSelect}
            label={undefined}
            value={store.lang}
            options={LANG_CODES}
            labels={LANG_PICKER_LABELS}
            placeholder={t("lang.label")}
            onChange={(v) => store.setLang(v as Lang)}
          />
          <Pressable
            onPress={toggleMode}
            accessibilityRole="button"
            accessibilityLabel={theme.mode === "dark" ? t("theme.toLight") : t("theme.toDark")}
            hitSlop={8}
            style={styles.themeBtn}
          >
            <Text style={styles.themeBtnIcon}>{theme.mode === "dark" ? "☀️" : "🌙"}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.body} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.track,
            { width: screenWidth * TAB_META.length, transform: [{ translateX: trackX }] },
          ]}
        >
          <View style={[styles.panel, { width: screenWidth }]} pointerEvents={activeTab === "capture" ? "auto" : "none"}>
            <ObservationCapture ref={captureRef} store={store} onBusyChange={onCaptureBusy} tabBarHeight={tabBarHeight} />
          </View>
          <View style={[styles.panel, { width: screenWidth }]} pointerEvents={activeTab === "records" ? "auto" : "none"}>
            <RecordsTab ref={recordsRef} store={store} focusClient={focusClient} onClearFocus={() => setFocusClient(null)} />
          </View>
          <View style={[styles.panel, { width: screenWidth }]} pointerEvents={activeTab === "insights" ? "auto" : "none"}>
            <InsightsTab overview={store.overview} observations={store.observations} onViewClient={goToRecords} />
          </View>
        </Animated.View>
      </View>

      <View style={styles.tabBar} onLayout={(e) => setTabBarHeight(e.nativeEvent.layout.height)}>
        {TAB_META.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable key={tab.key} style={styles.tabBtn} onPress={() => setActiveTab(tab.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <View style={styles.tabInner}>
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{tab.icon}</Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{t(tab.labelKey)}</Text>
                {tab.key === "capture" && captureBusy && activeTab !== "capture" && <View style={styles.tabBusyDot} />}
              </View>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function makeStyles(theme: Theme) {
  const { color } = theme;
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: color.bg },
    header: {
      flexDirection: "row", alignItems: "center", justifyContent: "space-between",
      backgroundColor: color.surface, paddingHorizontal: 16,
      // RN's SafeAreaView doesn't inset for the status bar on Android (iOS-only),
      // so the OS clock/battery/wifi icons were sitting on top of this bar.
      paddingTop: (Platform.OS === "android" ? StatusBar.currentHeight ?? 24 : 0) + 12,
      paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: color.border, gap: 8,
    },
    aiStatus: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 },
    headerActions: { flexDirection: "row", alignItems: "center", flexShrink: 0, gap: 4 },
    langSelect: { width: 148, flexShrink: 0 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    themeBtn: { paddingHorizontal: 4, paddingVertical: 2, flexShrink: 0 },
    themeBtnIcon: { fontSize: 18 },
    body: { flex: 1, overflow: "hidden" },
    track: { flex: 1, flexDirection: "row" },
    panel: { height: "100%" },
    tabBar: { flexDirection: "row", backgroundColor: color.surface, borderTopWidth: 1, borderTopColor: color.border, paddingBottom: 18, paddingTop: 6 },
    tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10 },
    tabInner: { alignItems: "center", gap: 2 },
    tabIcon: { fontSize: 18, color: color.textTertiary },
    tabIconActive: { color: color.primary },
    tabLabel: { fontFamily: font.medium, fontSize: 13, color: color.textTertiary },
    tabLabelActive: { color: color.text, fontFamily: font.semibold },
    tabBusyDot: { position: "absolute", top: -2, right: -8, width: 6, height: 6, borderRadius: 3, backgroundColor: color.warn },
  });
}
