export type TimelineEventType =
  | "MOUSE_MOVE"
  | "MOUSE_DOWN"
  | "MOUSE_UP"
  | "MOUSE_WHEEL"
  | "KEY_DOWN"
  | "KEY_UP"
  | "SYSTEM"
  | "ERROR";

export type AppStatus = "IDLE" | "RECORDING" | "PLAYING";

export interface TimelineEvent {
  t_ms: number;
  type: TimelineEventType;
  x?: number;
  y?: number;
  button?: string;
  key?: string;
  detail?: string;
}

export interface PlaybackProgress {
  current: number;
  total: number;
  t_ms: number;
}

export interface StatusPayload {
  status: AppStatus;
  speed: number;
  repeatCount: number;
  keyboardPrivacyMode: boolean;
  isCaptureActive: boolean;
  playback?: PlaybackProgress;
}

export interface CSVRow {
  t_ms: string;
  type: string;
  x: string;
  y: string;
  button: string;
  key: string;
  detail: string;
}

export interface ErrorPayload {
  message: string;
  detail?: string;
}

export const IPC_CHANNELS = {
  startRecording: "startRecording",
  stopRecording: "stopRecording",
  startPlayback: "startPlayback",
  stopPlayback: "stopPlayback",
  setPlaybackSpeed: "setPlaybackSpeed",
  setRepeatCount: "setRepeatCount",
  setKeyboardPrivacyMode: "setKeyboardPrivacyMode",
  clearTimeline: "clearTimeline",
  exportCSV: "exportCSV",
  importCSV: "importCSV",
  getSnapshot: "getSnapshot",
  timelineUpdated: "timelineUpdated",
  statusChanged: "statusChanged",
  logEvent: "logEvent",
  error: "error"
} as const;
