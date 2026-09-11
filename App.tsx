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

type Tab = "capture" | "records" | "insights";

const TABS: { key: Tab; icon: string; label: string }[] = [
  { key: "capture", icon: "＋", label: "Captura" },
  { key: "records", icon: "☰", label: "Registros" },
  { key: "insights", icon: "◈", label: "Insights" },
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
  const { theme, toggleMode } = useTheme();
  const styles = makeStyles(theme);
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });
  const store = useStore();
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
  const activeIndex = TABS.findIndex((t) => t.key === activeTab);
  // trackX is the single source of truth for the row's position, in drag and
  // at rest alike — the finger writes straight into it during the gesture,
  // and release animates it onward from wherever it already sits. Switching
  // to a separate dragX-on-top-of-trackX model (reset to 0 on release, with
  // trackX only catching up a render later via useEffect) caused a visible
  // jump-then-pause: the row snapped back to its old resting spot the instant
  // you lifted your finger, then paused until the effect fired and the
  // animation finally started.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const lastBackPressRef = useRef(0);

  // Android's back gesture/button used to exit the app straight from any tab.
  // Now it unwinds one step at a time: cancel an in-progress edit or draft
  // review first, then clear a client filter, then go back to Captura. Once
  // there's nothing left to unwind, it follows the standard Android pattern
  // of requiring a second press within a couple seconds to actually exit,
  // so a single stray back press from the resting state can't kill the app.
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
      ToastAndroid.show("Pulsa de nuevo para salir", ToastAndroid.SHORT);
      return true;
    });
    return () => sub.remove();
  }, []);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 20 && Math.abs(g.dx) > Math.abs(g.dy) * SWIPE_DIRECTION_RATIO,
      onPanResponderGrant: () => {
        trackX.stopAnimation((value) => { trackXBase.current = value; });
      },
      onPanResponderMove: (_, g) => {
        const idx = TABS.findIndex((t) => t.key === activeTabRef.current);
        // Resist dragging past the first/last tab instead of letting it slide into empty space.
        const resisted = (idx === 0 && g.dx > 0) || (idx === TABS.length - 1 && g.dx < 0) ? g.dx / 3 : g.dx;
        trackX.setValue(trackXBase.current + resisted);
      },
      onPanResponderRelease: (_, g) => {
        const idx = TABS.findIndex((t) => t.key === activeTabRef.current);
        if (g.dx <= -SWIPE_DISTANCE && idx < TABS.length - 1) setActiveTab(TABS[idx + 1].key);
        else if (g.dx >= SWIPE_DISTANCE && idx > 0) setActiveTab(TABS[idx - 1].key);
        else animateTrackTo(idx);
      },
      onPanResponderTerminate: () => {
        const idx = TABS.findIndex((t) => t.key === activeTabRef.current);
        animateTrackTo(idx);
      },
    }),
  ).current;

  if (!fontsLoaded) return <SafeAreaView style={styles.safe} />;

  const aiLabel = captureBusy && activeTab !== "capture"
    ? "Extracción en curso en Capturar…"
    : store.status.ready
      ? `IA local lista${store.status.device ? ` · ${store.status.device.toUpperCase()}` : ""}`
      : `Cargando modelo${store.progress != null ? ` ${Math.round(store.progress)}%` : "…"}`;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle={theme.mode === "dark" ? "light-content" : "dark-content"} backgroundColor={theme.color.surface} />

      <View style={styles.header}>
        <View style={styles.aiStatus}>
          <View style={[styles.dot, { backgroundColor: captureBusy ? theme.color.warn : store.status.ready ? theme.color.ok : theme.color.textTertiary }]} />
          <Text style={theme.type.caption}>{aiLabel}</Text>
        </View>
        <Pressable
          onPress={toggleMode}
          accessibilityRole="button"
          accessibilityLabel={theme.mode === "dark" ? "Cambiar a modo diurno" : "Cambiar a modo nocturno"}
          hitSlop={8}
          style={styles.themeBtn}
        >
          <Text style={styles.themeBtnIcon}>{theme.mode === "dark" ? "☀️" : "🌙"}</Text>
        </Pressable>
      </View>

      <View style={styles.body} {...panResponder.panHandlers}>
        <Animated.View
          style={[
            styles.track,
            { width: screenWidth * TABS.length, transform: [{ translateX: trackX }] },
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
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <Pressable key={tab.key} style={styles.tabBtn} onPress={() => setActiveTab(tab.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
              <View style={styles.tabInner}>
                <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{tab.icon}</Text>
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
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
      borderBottomWidth: 1, borderBottomColor: color.border,
    },
    aiStatus: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    themeBtn: { paddingHorizontal: 4, paddingVertical: 2, flexShrink: 0, marginLeft: 8 },
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
