import type { ErrorPayload, StatusPayload, TimelineEvent } from "../../shared/types";

type Unsubscribe = () => void;

interface RecorderApi {
  startRecording: () => Promise<{ ok: boolean }>;
  stopRecording: () => Promise<{ ok: boolean }>;
  startPlayback: () => Promise<{ ok: boolean }>;
  stopPlayback: () => Promise<{ ok: boolean }>;
  setPlaybackSpeed: (speed: number) => Promise<{ ok: boolean }>;
  setRepeatCount: (count: number) => Promise<{ ok: boolean }>;
  setKeyboardPrivacyMode: (enabled: boolean) => Promise<{ ok: boolean }>;
  clearTimeline: () => Promise<{ ok: boolean }>;
  exportCSV: () => Promise<{ ok: boolean }>;
  importCSV: () => Promise<{ ok: boolean }>;
  getSnapshot: () => Promise<{ status: StatusPayload; timeline: TimelineEvent[] }>;
  onTimelineUpdated: (cb: (events: TimelineEvent[]) => void) => Unsubscribe;
  onStatusChanged: (cb: (status: StatusPayload) => void) => Unsubscribe;
  onLogEvent: (cb: (event: TimelineEvent) => void) => Unsubscribe;
  onError: (cb: (error: ErrorPayload) => void) => Unsubscribe;
}

declare global {
  interface Window {
    recorderApi: RecorderApi;
  }
}

export {};
