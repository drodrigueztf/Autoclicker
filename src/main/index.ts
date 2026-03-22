import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import Papa from "papaparse";
import { Button, Key, keyboard, mouse, Point, straightTo } from "@nut-tree-fork/nut-js";
import {
  IPC_CHANNELS,
  type AppStatus,
  type CSVRow,
  type ErrorPayload,
  type PlaybackProgress,
  type StatusPayload,
  type TimelineEvent,
  type TimelineEventType
} from "../shared/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { uIOhook } = require("uiohook-napi") as { uIOhook: any };

// Disable auto delays for 1:1 reproduction speed
keyboard.config.autoDelayMs = 0;
mouse.config.autoDelayMs = 0;

const CSV_COLUMNS = ["t_ms", "type", "x", "y", "button", "key", "detail"] as const;
const MOUSE_SAMPLE_MS = 5;
const MOUSE_SAMPLE_PX = 1;

let mainWindow: BrowserWindow | null = null;
let status: AppStatus = "IDLE";
let playbackSpeed = 1;
let repeatCount = 1;
let keyboardPrivacyMode = true;

let timeline: TimelineEvent[] = [];
let recordStartMs = 0;
let hookRunning = false;
let playbackTimers: NodeJS.Timeout[] = [];
let lastSample = { t: 0, x: Number.NaN, y: Number.NaN };
let isTabPressed = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#091224",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function emit(channel: string, payload: unknown): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send(channel, payload);
}

function getStatusPayload(playback?: PlaybackProgress): StatusPayload {
  return {
    status,
    speed: playbackSpeed,
    repeatCount,
    keyboardPrivacyMode,
    isCaptureActive: status === "RECORDING",
    playback
  };
}

function emitStatus(playback?: PlaybackProgress): void {
  emit(IPC_CHANNELS.statusChanged, getStatusPayload(playback));
}

function emitTimeline(): void {
  emit(IPC_CHANNELS.timelineUpdated, timeline);
}

function emitError(message: string, detail?: string): void {
  const payload: ErrorPayload = { message, detail };
  emit(IPC_CHANNELS.error, payload);
}

function elapsedMs(): number {
  return Math.max(0, Date.now() - recordStartMs);
}

function pushEvent(event: TimelineEvent, emitList = true): void {
  timeline.push(event);
  emit(IPC_CHANNELS.logEvent, event);
  if (emitList) {
    emitTimeline();
  }
}

function pushSystem(detail: string): void {
  pushEvent({
    t_ms: status === "RECORDING" ? elapsedMs() : 0,
    type: "SYSTEM",
    detail
  });
}

function shouldSampleMove(x: number, y: number): boolean {
  const t = elapsedMs();
  const dt = t - lastSample.t;
  const dx = Number.isNaN(lastSample.x) ? Infinity : Math.abs(lastSample.x - x);
  const dy = Number.isNaN(lastSample.y) ? Infinity : Math.abs(lastSample.y - y);
  if (dt >= MOUSE_SAMPLE_MS || dx >= MOUSE_SAMPLE_PX || dy >= MOUSE_SAMPLE_PX) {
    lastSample = { t, x, y };
    return true;
  }
  return false;
}

function toVirtualCode(event: any): number | null {
  const raw = Number(event.rawcode ?? event.keycode ?? Number.NaN);
  return Number.isFinite(raw) ? raw : null;
}

const UIOHOOK_KEYCODE_TO_CHAR: Record<number, string> = {
  // Letters
  30: "A",
  48: "B",
  46: "C",
  32: "D",
  18: "E",
  33: "F",
  34: "G",
  35: "H",
  23: "I",
  36: "J",
  37: "K",
  38: "L",
  50: "M",
  49: "N",
  24: "O",
  25: "P",
  16: "Q",
  19: "R",
  31: "S",
  20: "T",
  22: "U",
  47: "V",
  17: "W",
  45: "X",
  21: "Y",
  44: "Z",
  // Number row
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  // Punctuation row / symbols (US scancode base chars)
  12: "-",
  13: "=",
  26: "[",
  27: "]",
  39: ";",
  40: "'",
  41: "`",
  43: "\\",
  51: ",",
  52: ".",
  53: "/",
  // Numpad
  55: "*",
  74: "-",
  78: "+",
  83: "."
};

function printableFromVirtualCode(code: number): string | null {
  if (code >= 65 && code <= 90) {
    return String.fromCharCode(code);
  }
  if (code >= 48 && code <= 57) {
    return String.fromCharCode(code);
  }
  return null;
}

function extractRecognizedKey(event: any): string | null {
  const keychar = Number(event.keychar ?? 0);
  if (keychar >= 32 && keychar <= 126) {
    return String.fromCharCode(keychar);
  }

  const hookCode = Number(event.keycode ?? Number.NaN);
  if (Number.isFinite(hookCode)) {
    const fromHookMap = UIOHOOK_KEYCODE_TO_CHAR[hookCode];
    if (fromHookMap) {
      return fromHookMap;
    }
  }

  const vk = toVirtualCode(event);
  if (vk === null) {
    return null;
  }
  return printableFromVirtualCode(vk);
}

function redactKey(event: any): { key?: string; detail?: string } {
  const recognized = extractRecognizedKey(event);
  const vk = toVirtualCode(event);

  if (!keyboardPrivacyMode) {
    if (recognized) {
      return { key: recognized };
    }
    return { key: `VK_${String(vk ?? "UNK")}` };
  }

  if (recognized) {
    return { key: "[REDACTED]", detail: "Text key hidden by privacy mode" };
  }

  return { key: `VK_${String(vk ?? "UNK")}` };
}

function startHook(): void {
  if (hookRunning) {
    return;
  }

  uIOhook.on("mousemove", (event: any) => {
    if (status !== "RECORDING") {
      return;
    }
    const x = Number(event.x ?? 0);
    const y = Number(event.y ?? 0);
    if (!shouldSampleMove(x, y)) {
      return;
    }
    pushEvent({ t_ms: elapsedMs(), type: "MOUSE_MOVE", x, y });
  });

  uIOhook.on("mousedown", (event: any) => {
    if (status !== "RECORDING") {
      return;
    }
    pushEvent({
      t_ms: elapsedMs(),
      type: "MOUSE_DOWN",
      x: Number(event.x ?? 0),
      y: Number(event.y ?? 0),
      button: String(event.button ?? "1")
    });
  });

  uIOhook.on("mouseup", (event: any) => {
    if (status !== "RECORDING") {
      return;
    }
    pushEvent({
      t_ms: elapsedMs(),
      type: "MOUSE_UP",
      x: Number(event.x ?? 0),
      y: Number(event.y ?? 0),
      button: String(event.button ?? "1")
    });
  });

  uIOhook.on("mousewheel", (event: any) => {
    if (status !== "RECORDING") {
      return;
    }
    pushEvent({
      t_ms: elapsedMs(),
      type: "MOUSE_WHEEL",
      x: Number(event.x ?? 0),
      y: Number(event.y ?? 0),
      detail: `delta:${String(event.rotation ?? event.amount ?? 0)}`
    });
  });

  uIOhook.on("keydown", (event: any) => {
    const vk = toVirtualCode(event);
    if (vk === 9) {
      isTabPressed = true;
    } else if (vk === 67 && isTabPressed) { // 67 is 'C'
      if (status === "RECORDING") {
        // Remove the Tab KEY_DOWN from timeline to prevent stuck keys during playback
        for (let i = timeline.length - 1; i >= 0; i--) {
          const ev = timeline[i];
          if (ev.type === "KEY_DOWN" && (ev.key === "Tab" || ev.key === "VK_9" || ev.key === "[REDACTED]")) {
            timeline.splice(i, 1);
            break;
          }
        }
        stopRecording();
        return;
      }
    }

    if (status !== "RECORDING") {
      return;
    }
    const redacted = redactKey(event);
    pushEvent({
      t_ms: elapsedMs(),
      type: "KEY_DOWN",
      key: redacted.key,
      detail: redacted.detail
    });
  });

  uIOhook.on("keyup", (event: any) => {
    const vk = toVirtualCode(event);
    if (vk === 9) {
      isTabPressed = false;
    }

    if (status !== "RECORDING") {
      return;
    }
    const redacted = redactKey(event);
    pushEvent({
      t_ms: elapsedMs(),
      type: "KEY_UP",
      key: redacted.key,
      detail: redacted.detail
    });
  });

  uIOhook.start();
  hookRunning = true;
}

function stopHook(): void {
  if (!hookRunning) {
    return;
  }
  uIOhook.removeAllListeners("mousemove");
  uIOhook.removeAllListeners("mousedown");
  uIOhook.removeAllListeners("mouseup");
  uIOhook.removeAllListeners("mousewheel");
  uIOhook.removeAllListeners("keydown");
  uIOhook.removeAllListeners("keyup");
  uIOhook.stop();
  hookRunning = false;
}

function startRecording(): void {
  if (status === "PLAYING") {
    stopPlayback();
  }
  if (status === "RECORDING") {
    return;
  }

  if (mainWindow) {
    mainWindow.minimize();
    mainWindow.hide();
  }

  isTabPressed = false;
  timeline = [];
  recordStartMs = Date.now();
  lastSample = { t: 0, x: Number.NaN, y: Number.NaN };
  status = "RECORDING";
  startHook();
  pushSystem("Recording started");
  emitStatus();
  emitTimeline();
}

function stopRecording(): void {
  if (status !== "RECORDING") {
    return;
  }
  pushSystem("Recording stopped by user");
  stopHook();
  status = "IDLE";
  emitStatus();

  if (mainWindow) {
    mainWindow.show();
    mainWindow.restore();
    mainWindow.focus();
  }
}

function clearTimers(): void {
  for (const timer of playbackTimers) {
    clearTimeout(timer);
  }
  playbackTimers = [];
}

function stopPlayback(): void {
  if (status !== "PLAYING") {
    return;
  }
  clearTimers();
  pushSystem("Playback stopped by user");
  status = "IDLE";
  emitStatus();
}

function toButton(value?: string): Button {
  switch (value) {
    case "2":
      return Button.RIGHT;
    case "3":
      return Button.MIDDLE;
    default:
      return Button.LEFT;
  }
}

function toKey(value?: string): Key | null {
  if (!value || value === "[REDACTED]") {
    return null;
  }

  const keyEnum = Key as unknown as Record<string, Key>;
  if (value.length === 1) {
    const symbolMap: Record<string, string> = {
      " ": "Space",
      ",": "Comma",
      ".": "Period",
      "/": "Slash",
      ";": "Semicolon",
      "'": "Quote",
      "[": "LeftBracket",
      "]": "RightBracket",
      "\\": "Backslash",
      "-": "Minus",
      "=": "Equal",
      "`": "Grave"
    };

    if (symbolMap[value]) {
      return keyEnum[symbolMap[value]] ?? null;
    }

    const upper = value.toUpperCase();
    const named = keyEnum[upper];
    if (named !== undefined) {
      return named;
    }
  }

  if (value.startsWith("VK_")) {
    const code = Number(value.slice(3));
    if (code >= 65 && code <= 90) {
      return keyEnum[String.fromCharCode(code)] ?? null;
    }
    if (code >= 48 && code <= 57) {
      return keyEnum[`Num${String(code - 48)}`] ?? null;
    }
    const vkMap: Record<number, string> = {
      8: "Backspace",
      9: "Tab",
      13: "Enter",
      16: "LeftShift",
      17: "LeftControl",
      18: "LeftAlt",
      27: "Escape",
      32: "Space",
      37: "Left",
      38: "Up",
      39: "Right",
      40: "Down"
    };
    const name = vkMap[code];
    if (name) {
      return keyEnum[name] ?? null;
    }
  }

  return null;
}

function isPrintableChar(value?: string): boolean {
  return typeof value === "string" && value.length === 1 && value !== "[REDACTED]";
}

async function runEvent(event: TimelineEvent): Promise<void> {
  switch (event.type) {
    case "MOUSE_MOVE": {
      if (typeof event.x === "number" && typeof event.y === "number") {
        await mouse.move(straightTo(new Point(event.x, event.y)));
      }
      return;
    }
    case "MOUSE_DOWN": {
      await mouse.pressButton(toButton(event.button));
      return;
    }
    case "MOUSE_UP": {
      await mouse.releaseButton(toButton(event.button));
      return;
    }
    case "MOUSE_WHEEL": {
      const text = event.detail ?? "";
      const match = text.match(/delta:([-]?\d+)/);
      const delta = match ? Number(match[1]) : 0;
      if (delta > 0) {
        await mouse.scrollUp(delta);
      }
      if (delta < 0) {
        await mouse.scrollDown(Math.abs(delta));
      }
      return;
    }
    case "KEY_DOWN": {
      const key = toKey(event.key);
      if (key) {
        await keyboard.pressKey(key);
      } else if (isPrintableChar(event.key)) {
        await keyboard.type(event.key);
      }
      return;
    }
    case "KEY_UP": {
      const key = toKey(event.key);
      if (key) {
        await keyboard.releaseKey(key);
      }
      return;
    }
    default:
      return;
  }
}

function startPlayback(): void {
  if (status === "RECORDING") {
    stopRecording();
  }
  if (status === "PLAYING") {
    return;
  }

  const playable = timeline.filter((e) => e.type !== "SYSTEM" && e.type !== "ERROR");
  if (playable.length === 0) {
    emitError("No hay eventos para reproducir", "Graba o importa CSV antes de reproducir");
    return;
  }

  status = "PLAYING";
  pushSystem(`Playback started (${repeatCount}x)`);
  emitStatus({ current: 0, total: playable.length * repeatCount, t_ms: 0 });

  const speed = playbackSpeed <= 0 ? 1 : playbackSpeed;
  const cycleLength = playable[playable.length - 1].t_ms;

  for (let cycle = 0; cycle < repeatCount; cycle += 1) {
    playable.forEach((event, idx) => {
      const globalIndex = cycle * playable.length + idx;
      const target = Math.floor((cycle * cycleLength + event.t_ms) / speed);
      const timer = setTimeout(() => {
        if (status !== "PLAYING") {
          return;
        }

        void runEvent(event).catch((err: unknown) => {
          emitError("Error durante reproducción", String(err));
        });

        emitStatus({
          current: globalIndex + 1,
          total: playable.length * repeatCount,
          t_ms: cycle * cycleLength + event.t_ms
        });

        if (globalIndex === playable.length * repeatCount - 1) {
          clearTimers();
          status = "IDLE";
          pushSystem("Playback finished");
          emitStatus();
        }
      }, target);
      playbackTimers.push(timer);
    });
  }
}

function rowsFromTimeline(data: TimelineEvent[]): CSVRow[] {
  return data.map((event) => ({
    t_ms: String(event.t_ms),
    type: event.type,
    x: event.x === undefined ? "" : String(event.x),
    y: event.y === undefined ? "" : String(event.y),
    button: event.button ?? "",
    key: event.key ?? "",
    detail: event.detail ?? ""
  }));
}

function parseType(type: string): TimelineEventType {
  const valid: TimelineEventType[] = [
    "MOUSE_MOVE",
    "MOUSE_DOWN",
    "MOUSE_UP",
    "MOUSE_WHEEL",
    "KEY_DOWN",
    "KEY_UP",
    "SYSTEM",
    "ERROR"
  ];
  if (!valid.includes(type as TimelineEventType)) {
    throw new Error(`Tipo inválido: ${type}`);
  }
  return type as TimelineEventType;
}

function parseRows(rows: CSVRow[]): TimelineEvent[] {
  return rows.map((row, idx) => {
    const line = idx + 2;
    const t_ms = Number(row.t_ms);
    if (!Number.isFinite(t_ms) || t_ms < 0) {
      throw new Error(`Fila ${line}: t_ms inválido`);
    }

    const parseNum = (v: string, field: string): number | undefined => {
      if (!v) {
        return undefined;
      }
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`Fila ${line}: ${field} inválido`);
      }
      return n;
    };

    return {
      t_ms,
      type: parseType(row.type),
      x: parseNum(row.x, "x"),
      y: parseNum(row.y, "y"),
      button: row.button || undefined,
      key: row.key || undefined,
      detail: row.detail || undefined
    } satisfies TimelineEvent;
  });
}

async function exportCSV(): Promise<void> {
  const result = await dialog.showSaveDialog({
    title: "Exportar timeline CSV",
    defaultPath: "timeline.csv",
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });

  if (result.canceled || !result.filePath) {
    return;
  }

  const fs = await import("node:fs/promises");
  const csv = Papa.unparse(rowsFromTimeline(timeline), { columns: [...CSV_COLUMNS], quotes: true });
  await fs.writeFile(result.filePath, csv, "utf8");
  pushSystem(`CSV exported: ${result.filePath}`);
}

async function importCSV(): Promise<void> {
  if (status !== "IDLE") {
    emitError("Detenga la actividad actual", "Importar solo en estado INACTIVO");
    return;
  }

  const result = await dialog.showOpenDialog({
    title: "Importar timeline CSV",
    properties: ["openFile"],
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return;
  }

  const fs = await import("node:fs/promises");
  const content = await fs.readFile(result.filePaths[0], "utf8");

  const parsed = Papa.parse<CSVRow>(content, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0].message);
  }

  const header = Object.keys((parsed.data[0] ?? {}) as Record<string, string>);
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(`Columnas faltantes: ${missing.join(", ")}`);
  }

  timeline = parseRows(parsed.data).sort((a, b) => a.t_ms - b.t_ms);
  pushSystem(`CSV imported: ${result.filePaths[0]}`);
  emitTimeline();
}

function registerIPC(): void {
  ipcMain.handle(IPC_CHANNELS.startRecording, async () => {
    startRecording();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.stopRecording, async () => {
    stopRecording();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.startPlayback, async () => {
    startPlayback();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.stopPlayback, async () => {
    stopPlayback();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.setPlaybackSpeed, async (_event, speed: number) => {
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
      emitError("Velocidad inválida", "Use un valor entre 0.5 y 2.0");
      return { ok: false };
    }
    playbackSpeed = speed;
    emitStatus();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.setRepeatCount, async (_event, count: number) => {
    if (!Number.isInteger(count) || count < 1 || count > 20) {
      emitError("Repeticiones inválidas", "Use un entero entre 1 y 20");
      return { ok: false };
    }
    repeatCount = count;
    emitStatus();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.setKeyboardPrivacyMode, async (_event, enabled: boolean) => {
    keyboardPrivacyMode = Boolean(enabled);
    emitStatus();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.clearTimeline, async () => {
    if (status !== "IDLE") {
      emitError("No se puede eliminar el registro ahora", "Use este boton solo en estado INACTIVO");
      return { ok: false };
    }
    timeline = [];
    emitTimeline();
    return { ok: true };
  });

  ipcMain.handle(IPC_CHANNELS.exportCSV, async () => {
    try {
      await exportCSV();
      return { ok: true };
    } catch (err: unknown) {
      emitError("No se pudo exportar CSV", String(err));
      return { ok: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.importCSV, async () => {
    try {
      await importCSV();
      return { ok: true };
    } catch (err: unknown) {
      emitError("No se pudo importar CSV", String(err));
      pushEvent({ t_ms: 0, type: "ERROR", detail: String(err) });
      return { ok: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.getSnapshot, async () => ({
    status: getStatusPayload(),
    timeline
  }));
}

app.whenReady().then(() => {
  registerIPC();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopHook();
  clearTimers();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
