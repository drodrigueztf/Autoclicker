import { useEffect, useMemo, useState } from "react";
import type { ErrorPayload, StatusPayload, TimelineEvent } from "../../shared/types";

type Tab = "control" | "timeline";

const INITIAL_STATUS: StatusPayload = {
  status: "IDLE",
  speed: 1,
  repeatCount: 1,
  keyboardPrivacyMode: true,
  isCaptureActive: false
};

function stateText(s: StatusPayload["status"]): string {
  if (s === "RECORDING") return "GRABANDO";
  if (s === "PLAYING") return "REPRODUCIENDO";
  return "INACTIVO";
}

function formatMs(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(rem).padStart(3, "0")}`;
}

export default function App() {
  const [tab, setTab] = useState<Tab>("control");
  const [status, setStatus] = useState<StatusPayload>(INITIAL_STATUS);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [lastError, setLastError] = useState<ErrorPayload | null>(null);

  useEffect(() => {
    const offStatus = window.recorderApi.onStatusChanged((s) => setStatus(s));
    const offTimeline = window.recorderApi.onTimelineUpdated((events) => setTimeline(events));
    const offLog = window.recorderApi.onLogEvent(() => {});
    const offError = window.recorderApi.onError((err) => setLastError(err));

    void window.recorderApi.getSnapshot().then((snapshot) => {
      setStatus(snapshot.status);
      setTimeline(snapshot.timeline);
    });

    return () => {
      offStatus();
      offTimeline();
      offLog();
      offError();
    };
  }, []);

  const isRecording = status.status === "RECORDING";
  const isPlaying = status.status === "PLAYING";
  const hasPlayable = timeline.some((e) => e.type !== "SYSTEM" && e.type !== "ERROR");

  const duration = useMemo(() => {
    if (timeline.length === 0) return 0;
    return Math.max(...timeline.map((e) => e.t_ms));
  }, [timeline]);

  const mainLabel = isRecording ? "DETENER" : isPlaying ? "PARAR" : "GRABAR";

  const onMain = async (): Promise<void> => {
    if (isRecording) {
      await window.recorderApi.stopRecording();
      return;
    }
    if (isPlaying) {
      await window.recorderApi.stopPlayback();
      return;
    }
    await window.recorderApi.startRecording();
  };

  const onPlay = async (): Promise<void> => {
    if (isPlaying) {
      await window.recorderApi.stopPlayback();
      return;
    }
    await window.recorderApi.startPlayback();
  };

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Input Recorder</h1>
          <p>Grabacion y reproduccion transparente de mouse y teclado</p>
        </div>
        <div className={`status ${status.status.toLowerCase()}`}>{stateText(status.status)}</div>
      </header>

      <div className={`capture ${status.isCaptureActive ? "on" : "off"}`}>
        {status.isCaptureActive ? "CAPTURA ACTIVA" : "CAPTURA INACTIVA"}
      </div>

      <div className="tabs">
        <button className={tab === "control" ? "active" : ""} onClick={() => setTab("control")}>Control</button>
        <button className={tab === "timeline" ? "active" : ""} onClick={() => setTab("timeline")}>Registro / Timeline</button>
      </div>

      {tab === "control" ? (
        <section className="panel control">
          <div className="hero-actions">
            <button className={`hero ${isRecording || isPlaying ? "stop" : "record"}`} onClick={onMain}>
              {mainLabel}
            </button>
            <button className="hero play" onClick={onPlay} disabled={isRecording || (!isPlaying && !hasPlayable)}>
              {isPlaying ? "PARAR" : "REPRODUCIR"}
            </button>
          </div>

          <div className="grid">
            <label>
              Velocidad: {status.speed.toFixed(2)}x
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.1}
                value={status.speed}
                disabled={isRecording}
                onChange={(e) => void window.recorderApi.setPlaybackSpeed(Number(e.target.value))}
              />
            </label>

            <label>
              Repeticiones
              <input
                type="number"
                min={1}
                max={20}
                value={status.repeatCount}
                disabled={isRecording || isPlaying}
                onChange={(e) => void window.recorderApi.setRepeatCount(Number(e.target.value))}
              />
            </label>

            <label className="privacy">
              <input
                type="checkbox"
                checked={status.keyboardPrivacyMode}
                disabled={isRecording}
                onChange={(e) => void window.recorderApi.setKeyboardPrivacyMode(e.target.checked)}
              />
              Modo privacidad teclado (ocultar teclas de texto)
            </label>
          </div>

          <div className="progress">
            Progreso: {status.playback ? `${status.playback.current}/${status.playback.total}` : "Sin reproduccion"}
          </div>

          <div className="perm">
            macOS: habilita Accessibilidad e Input Monitoring para esta app. Linux puede requerir permisos extra segun X11/Wayland.
          </div>
        </section>
      ) : (
        <section className="panel timeline">
          <div className="stats">
            <div><span>Eventos</span><strong>{timeline.length}</strong></div>
            <div><span>Duracion</span><strong>{formatMs(duration)}</strong></div>
          </div>

          <div className="actions">
            <button onClick={() => void window.recorderApi.exportCSV()} disabled={isRecording || isPlaying || timeline.length === 0}>Exportar CSV</button>
            <button onClick={() => void window.recorderApi.importCSV()} disabled={isRecording || isPlaying}>Importar CSV</button>
            <button
              onClick={() => {
                if (timeline.length === 0) return;
                if (!window.confirm("Se eliminara todo el registro actual. Continuar?")) return;
                void window.recorderApi.clearTimeline();
              }}
              disabled={isRecording || isPlaying || timeline.length === 0}
            >
              Eliminar registro
            </button>
          </div>

          {lastError ? <div className="error">{lastError.message} {lastError.detail ? `| ${lastError.detail}` : ""}</div> : null}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>t_ms</th>
                  <th>type</th>
                  <th>x</th>
                  <th>y</th>
                  <th>button</th>
                  <th>key</th>
                  <th>detail</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((e, i) => (
                  <tr key={`${e.type}-${e.t_ms}-${i}`}>
                    <td>{e.t_ms}</td>
                    <td>{e.type}</td>
                    <td>{e.x ?? ""}</td>
                    <td>{e.y ?? ""}</td>
                    <td>{e.button ?? ""}</td>
                    <td>{e.key ?? ""}</td>
                    <td>{e.detail ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
