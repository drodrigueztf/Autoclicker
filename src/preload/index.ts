import { contextBridge, ipcRenderer } from "electron";
import {
  IPC_CHANNELS,
  type ErrorPayload,
  type StatusPayload,
  type TimelineEvent
} from "../shared/types";

type Unsubscribe = () => void;

const api = {
  startRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.startRecording),
  stopRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.stopRecording),
  startPlayback: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.startPlayback),
  stopPlayback: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.stopPlayback),
  setPlaybackSpeed: (speed: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.setPlaybackSpeed, speed),
  setRepeatCount: (count: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.setRepeatCount, count),
  setKeyboardPrivacyMode: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC_CHANNELS.setKeyboardPrivacyMode, enabled),
  clearTimeline: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.clearTimeline),
  exportCSV: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.exportCSV),
  importCSV: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.importCSV),
  getSnapshot: (): Promise<{ status: StatusPayload; timeline: TimelineEvent[] }> =>
    ipcRenderer.invoke(IPC_CHANNELS.getSnapshot),
  onTimelineUpdated: (cb: (events: TimelineEvent[]) => void): Unsubscribe => {
    const listener = (_event: unknown, payload: TimelineEvent[]) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.timelineUpdated, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.timelineUpdated, listener);
  },
  onStatusChanged: (cb: (status: StatusPayload) => void): Unsubscribe => {
    const listener = (_event: unknown, payload: StatusPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.statusChanged, listener);
  },
  onLogEvent: (cb: (event: TimelineEvent) => void): Unsubscribe => {
    const listener = (_event: unknown, payload: TimelineEvent) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.logEvent, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.logEvent, listener);
  },
  onError: (cb: (error: ErrorPayload) => void): Unsubscribe => {
    const listener = (_event: unknown, payload: ErrorPayload) => cb(payload);
    ipcRenderer.on(IPC_CHANNELS.error, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.error, listener);
  }
};

contextBridge.exposeInMainWorld("recorderApi", api);

export type RecorderApi = typeof api;
