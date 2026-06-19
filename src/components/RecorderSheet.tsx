import React, { useState, useRef, useEffect, useCallback } from "react";
import { Mic, Keyboard, X, Loader2, Sparkles, Calendar, CheckSquare, FileText, AlertCircle } from "lucide-react";
import type { Item, AISchema } from "./ItemList";

interface Props {
  isOpen: boolean;
  initialMode: "voice" | "text";
  onClose: () => void;
  onItemsSaved: (items: Item[]) => void;
  language: "ru" | "en" | "uk";
}

type VoiceState = "idle" | "listening" | "transcribing" | "analyzing" | "done";
type Mode = "voice" | "text";

function HighlightedTranscript({ text }: { text: string }) {
  const pattern = /\b(завтра|сьогодні|вчора|в понеділок|у вівторок|в середу|в четвер|в суботу|в неділю|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}:\d{2}|зустріч|зустрітись|купити|записати|нагадати|оплатити|ідею|ідея|нотатку|нотатк|зроби|зателефонувати|подзвонити|meeting|buy|note|idea|remind|call|pay)\b/gi;

  const parts: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>);
    parts.push(<span key={`h${m.index}`} className="text-indigo-600 font-semibold">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`t${last}`}>{text.slice(last)}</span>);
  return <p className="text-sm text-zinc-800 leading-relaxed">{parts}</p>;
}

function getItemMeta(type: string) {
  switch (type) {
    case "calendar_event":
    case "reminder":
      return { label: "КАЛЕНДАР",  Icon: Calendar };
    case "task":
      return { label: "ЗАДАЧІ",    Icon: CheckSquare };
    case "notion_note":
      return { label: "НОТАТКИ",   Icon: FileText };
    default:
      return { label: "НЕВИЗНАЧЕНО", Icon: AlertCircle };
  }
}

function formatItemDate(date: string | null, time: string | null): string | null {
  if (!date && !time) return null;
  const parts: string[] = [];
  if (date) {
    const d = new Date(date + "T00:00:00");
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (d.getTime() === today.getTime()) parts.push("Сьогодні");
    else if (d.getTime() === tomorrow.getTime()) parts.push("Завтра");
    else parts.push(d.toLocaleDateString("uk-UA", { day: "numeric", month: "short" }));
  }
  if (time) parts.push(time);
  return parts.join(" · ");
}

// ── Waveform bars ─────────────────────────────────────────────
const BAR_HEIGHTS = [8, 16, 24, 32, 20, 28, 12, 36, 20, 24, 16, 32, 8, 28, 20, 36, 12, 24, 16, 28, 8, 20, 32, 16, 24, 12, 28, 20];

function Waveform() {
  return (
    <div className="flex items-center gap-[3px] justify-center h-12">
      {BAR_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="w-1 bg-indigo-600 rounded-full animate-bar-wave"
          style={{ height: `${h}px`, animationDelay: `${i * 0.04}s` }}
        />
      ))}
    </div>
  );
}

// ── Done view (shared by voice + text after analysis) ─────────
function DoneView({
  transcript,
  parsedItems,
  isSaving,
  onAddAll,
}: {
  transcript: string;
  parsedItems: AISchema[];
  isSaving: boolean;
  onAddAll: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-bold text-zinc-900">Готово розкласти</h3>

      {/* Highlighted transcript */}
      <div className="p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
        <HighlightedTranscript text={transcript} />
      </div>

      {/* Parsed items */}
      <div className="flex flex-col gap-2">
        {parsedItems.map((item, i) => {
          const { label, Icon } = getItemMeta(item.type);
          const dateStr = formatItemDate(item.date, item.start_time);
          return (
            <div key={i} className="flex items-center gap-3 p-3 bg-zinc-50 rounded-2xl border border-zinc-100">
              <div className="w-9 h-9 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
                <Icon className="w-[18px] h-[18px] text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase text-zinc-400 tracking-wider mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-zinc-900 truncate">{item.title}</p>
              </div>
              {dateStr && (
                <span className="text-xs text-indigo-600 font-medium flex-shrink-0 text-right">{dateStr}</span>
              )}
            </div>
          );
        })}
      </div>

      <button
        onClick={onAddAll}
        disabled={isSaving}
        className="w-full py-3.5 rounded-2xl bg-indigo-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity active:scale-[0.98]"
      >
        {isSaving
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <><span>Додати все</span><Sparkles className="w-4 h-4" /></>
        }
      </button>
    </div>
  );
}

// ── Main sheet ─────────────────────────────────────────────────
export default function RecorderSheet({ isOpen, initialMode, onClose, onItemsSaved, language }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [typedText, setTypedText] = useState("");
  const [parsedItems, setParsedItems] = useState<AISchema[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const analyzeText = useCallback(async (text: string) => {
    setVoiceState("analyzing");
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: text, language }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setParsedItems(data.items ?? []);
      setVoiceState("done");
    } catch {
      setError("Помилка аналізу. Спробуйте ще раз.");
      setVoiceState("idle");
    }
  }, [language]);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript("");
    setParsedItems([]);
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setVoiceState("transcribing");
        try {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          const base64 = await new Promise<string>((res, rej) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => res((reader.result as string).split(",")[1]);
            reader.onerror = rej;
          });
          const tRes = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ audio: base64, language }),
            credentials: "include",
          });
          if (!tRes.ok) throw new Error("Transcription failed");
          const { transcript: text } = await tRes.json();
          if (!text?.trim()) {
            setError("Мову не розпізнано. Спробуйте ще раз.");
            setVoiceState("idle");
            return;
          }
          setTranscript(text);
          await analyzeText(text);
        } catch {
          setError("Помилка розпізнавання. Спробуйте ще раз.");
          setVoiceState("idle");
        }
      };
      mr.start();
      setVoiceState("listening");
    } catch {
      setError("Доступ до мікрофона заблоковано. Дозвольте у налаштуваннях браузера.");
      setVoiceState("idle");
    }
  }, [language, analyzeText]);

  // Reset + auto-start when sheet opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setVoiceState("idle");
      setTranscript("");
      setTypedText("");
      setParsedItems([]);
      setError(null);
      setIsSaving(false);
      if (initialMode === "voice") {
        startRecording();
      }
    } else {
      stopRecording();
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = () => {
    stopRecording();
    onClose();
  };

  const handleAddAll = async () => {
    if (isSaving || parsedItems.length === 0) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/items/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript, items: parsedItems }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Batch save failed");
      const data = await res.json();
      onItemsSaved(data.items ?? []);
      onClose();
    } catch {
      setError("Помилка збереження. Спробуйте ще раз.");
      setIsSaving(false);
    }
  };

  const handleTextSubmit = async () => {
    const text = typedText.trim();
    if (!text || voiceState === "analyzing") return;
    setTranscript(text);
    await analyzeText(text);
  };

  const switchMode = (m: Mode) => {
    stopRecording();
    setMode(m);
    setVoiceState("idle");
    setParsedItems([]);
    setError(null);
    if (m === "voice") startRecording();
  };

  if (!isOpen) return null;

  const isDone = voiceState === "done" && parsedItems.length > 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
        onClick={handleClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-3xl shadow-2xl animate-slide-up"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-zinc-200 rounded-full" />
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex flex-1 bg-zinc-100 rounded-xl p-1 gap-1">
            <button
              onClick={() => switchMode("voice")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                mode === "voice" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
              }`}
            >
              <Mic className="w-4 h-4" /> Голос
            </button>
            <button
              onClick={() => switchMode("text")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                mode === "text" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500"
              }`}
            >
              <Keyboard className="w-4 h-4" /> Текст
            </button>
          </div>
          <button
            onClick={handleClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 cursor-pointer hover:bg-zinc-200 transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-4 pb-2 pt-1">
          {/* ── VOICE MODE ─────────────────────────────── */}
          {mode === "voice" && (
            <>
              {voiceState === "idle" && !isDone && (
                <div className="py-8 flex flex-col items-center gap-4">
                  <p className="text-sm text-zinc-400">Готово до запису</p>
                  <button
                    onClick={startRecording}
                    className="w-16 h-16 rounded-full bg-indigo-600 flex items-center justify-center shadow-lg active:scale-95"
                  >
                    <Mic className="w-7 h-7 text-white" />
                  </button>
                </div>
              )}

              {voiceState === "listening" && (
                <>
                  <h3 className="text-base font-bold text-zinc-900 mb-3">Слухаю...</h3>
                  <Waveform />
                  <button
                    onClick={stopRecording}
                    className="w-full mt-4 py-3 rounded-2xl bg-zinc-100 text-zinc-500 text-sm font-semibold"
                  >
                    Зачекай...
                  </button>
                </>
              )}

              {(voiceState === "transcribing" || voiceState === "analyzing") && (
                <div className="py-10 flex flex-col items-center gap-3">
                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                  <p className="text-sm text-zinc-400">
                    {voiceState === "transcribing" ? "Розпізнаю мову..." : "AI аналізує..."}
                  </p>
                </div>
              )}

              {isDone && (
                <DoneView
                  transcript={transcript}
                  parsedItems={parsedItems}
                  isSaving={isSaving}
                  onAddAll={handleAddAll}
                />
              )}
            </>
          )}

          {/* ── TEXT MODE ──────────────────────────────── */}
          {mode === "text" && (
            isDone ? (
              <DoneView
                transcript={transcript}
                parsedItems={parsedItems}
                isSaving={isSaving}
                onAddAll={handleAddAll}
              />
            ) : (
              <>
                <h3 className="text-base font-bold text-zinc-900 mb-3">Введи текст</h3>
                <textarea
                  value={typedText}
                  onChange={e => setTypedText(e.target.value)}
                  placeholder={"Напиши все одним потоком — напр.\n«завтра о 10 зустріч з Іриною, оплатити інтернет, ідея для назви»"}
                  rows={4}
                  className="w-full p-3 bg-zinc-50 border border-zinc-200 rounded-2xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent leading-relaxed"
                />
                <p className="text-xs text-zinc-400 mt-2 flex items-start gap-1.5">
                  <span className="text-indigo-400 mt-0.5 flex-shrink-0">≡</span>
                  Розділяй думки комами або з нового рядка — VoiceMind сам визначить, що куди.
                </p>
                <button
                  onClick={handleTextSubmit}
                  disabled={!typedText.trim() || voiceState === "analyzing"}
                  className="w-full mt-4 py-3 rounded-2xl bg-indigo-50 text-indigo-600 font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {voiceState === "analyzing"
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : "Розкласти"
                  }
                </button>
              </>
            )
          )}

          {error && (
            <p className="mt-3 text-xs text-rose-600 text-center font-medium">{error}</p>
          )}
        </div>
      </div>
    </>
  );
}
