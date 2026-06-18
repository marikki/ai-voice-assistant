import React, { useState, useRef } from "react";
import { Mic, MicOff, Sparkles, Loader2 } from "lucide-react";

interface VoiceRecorderProps {
  onTranscriptComplete: (transcript: string) => void;
  onLiveUpdate?: (text: string) => void;
  isProcessing: boolean;
  language: "ru" | "en" | "uk";
}

export default function VoiceRecorder({
  onTranscriptComplete,
  onLiveUpdate,
  isProcessing,
  language
}: VoiceRecorderProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [typedText, setTypedText] = useState("");
  const [recordingTime, setRecordingTime] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const startRecording = async () => {
    setErrorMessage(null);
    setTranscript("");
    chunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        await transcribeAudio(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch (err: any) {
      const isUk = language === "uk";
      setErrorMessage(
        err.name === "NotAllowedError"
          ? (language === "ru" ? "Доступ к микрофону заблокирован. Разрешите в настройках браузера." : isUk ? "Доступ до мікрофона заблоковано. Дозвольте у налаштуваннях браузера." : "Microphone access denied. Allow it in browser settings.")
          : (language === "ru" ? "Не удалось получить доступ к микрофону." : isUk ? "Не вдалося отримати доступ до мікрофона." : "Could not access microphone.")
      );
    }
  };

  const stopRecording = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  };

  const transcribeAudio = async (blob: Blob) => {
    setIsTranscribing(true);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
        reader.onerror = reject;
      });
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, language })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const text = data.transcript?.trim();
      if (text) {
        setTranscript(text);
        if (onLiveUpdate) onLiveUpdate(text);
        onTranscriptComplete(text);
      } else {
        setErrorMessage(language === "ru" ? "Речь не распознана. Попробуйте ещё раз." : language === "uk" ? "Мову не розпізнано. Спробуйте ще раз." : "No speech detected. Try again.");
      }
    } catch {
      setErrorMessage(language === "ru" ? "Ошибка распознавания. Попробуйте ещё раз." : language === "uk" ? "Помилка розпізнавання. Спробуйте ще раз." : "Transcription error. Please try again.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const toggleRecording = () => isRecording ? stopRecording() : startRecording();
  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!typedText.trim() || isProcessing) return;
    onTranscriptComplete(typedText);
    setTypedText("");
  };

  const isBusy = isTranscribing || isProcessing;

  return (
    <div className="w-full bg-white dark:bg-zinc-900 border-t border-zinc-100 md:border md:rounded-3xl md:shadow-sm">

      {/* ── Compact messenger bar (all screen sizes) ─────────── */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={toggleRecording}
          disabled={isBusy}
          className={`relative w-11 h-11 flex-shrink-0 rounded-full flex items-center justify-center transition-all duration-300 ${
            isRecording
              ? "bg-red-500 text-white"
              : isBusy
              ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
              : "bg-indigo-600 text-white cursor-pointer"
          }`}
        >
          {isRecording && (
            <span className="absolute inset-0 rounded-full bg-red-400 animate-ping opacity-40" />
          )}
          {isTranscribing
            ? <Loader2 className="w-5 h-5 animate-spin" />
            : isRecording
            ? <MicOff className="w-5 h-5" />
            : <Mic className="w-5 h-5" />}
        </button>

        {isRecording ? (
          <div className="flex-1 flex items-center gap-2 text-sm font-mono text-red-500 font-semibold">
            <span className="animate-pulse">●</span>
            {formatTime(recordingTime)}
            <span className="text-zinc-400 text-xs font-normal ml-1">
              {language === "ru" ? "нажми для остановки" : language === "uk" ? "натисни для зупинки" : "tap to stop"}
            </span>
          </div>
        ) : isTranscribing ? (
          <div className="flex-1 text-sm text-zinc-400 italic">
            {language === "ru" ? "Распознаю..." : language === "uk" ? "Розпізнаю..." : "Transcribing..."}
          </div>
        ) : isProcessing ? (
          <div className="flex-1 flex items-center gap-2 text-sm text-indigo-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            {language === "ru" ? "AI анализирует..." : language === "uk" ? "AI аналізує..." : "AI analyzing..."}
          </div>
        ) : (
          <form onSubmit={handleManualSubmit} className="flex-1 flex gap-2">
            <input
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder={language === "ru" ? "Написати..." : language === "uk" ? "Написати..." : "Type here..."}
              className="flex-1 bg-zinc-50 border border-zinc-200 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!typedText.trim() || isProcessing}
              className="w-9 h-9 flex-shrink-0 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 text-white rounded-full flex items-center justify-center transition-colors"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </form>
        )}
      </div>

      {/* Feedback messages */}
      {(errorMessage || (transcript && !isRecording)) && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {transcript && !isRecording && (
            <div className="px-3 py-1.5 bg-indigo-50 text-indigo-800 text-xs rounded-xl border border-indigo-100">
              "{transcript}"
            </div>
          )}
          {errorMessage && (
            <div className="px-3 py-1.5 bg-amber-50 text-amber-700 text-xs rounded-xl border border-amber-100">
              {errorMessage}
            </div>
          )}
        </div>
      )}

      {/* ── Desktop full layout — hidden since bar is used everywhere ── */}
      <div className="hidden p-6 sm:p-8">
        <div className="flex flex-col items-center text-center py-4">
          <div className="relative">
            {isRecording && (
              <>
                <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping scale-150 opacity-20" />
                <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping scale-125 opacity-10" />
              </>
            )}
            <button
              id="voice-record-btn"
              onClick={toggleRecording}
              disabled={isBusy}
              className={`w-28 h-28 rounded-full flex flex-col items-center justify-center transition-all duration-300 relative z-10 ${
                isRecording
                  ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-200"
                  : isBusy
                  ? "bg-zinc-100 text-zinc-400 cursor-not-allowed"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg hover:shadow-indigo-100 cursor-pointer"
              }`}
            >
              {isTranscribing
                ? <Loader2 className="w-10 h-10 mb-1 animate-spin" />
                : isRecording
                ? <MicOff className="w-10 h-10 mb-1 animate-pulse" />
                : <Mic className="w-10 h-10 mb-1" />}
              <span className="text-[10px] font-mono tracking-wider uppercase font-semibold">
                {isRecording ? formatTime(recordingTime)
                  : isTranscribing ? "..."
                  : isProcessing ? (language === "ru" ? "АНАЛИЗ" : "ANALYZE")
                  : (language === "ru" ? "ЗАПИСЬ" : "RECORD")}
              </span>
            </button>
          </div>

          {(isRecording || isTranscribing || isProcessing) && (
            <h3 className="mt-6 font-semibold text-lg text-zinc-800">
              {isRecording
                ? (language === "ru" ? "Запись вашего голоса..." : "Capturing your voice...")
                : isTranscribing
                ? (language === "ru" ? "Распознавание речи..." : "Transcribing audio...")
                : (language === "ru" ? "AI анализирует смысл..." : "AI classification pipeline active...")}
            </h3>
          )}

          {transcript && !isRecording && (
            <div className="mt-3 px-4 py-2 bg-indigo-50 text-indigo-800 text-xs rounded-xl border border-indigo-100 max-w-sm">
              "{transcript}"
            </div>
          )}

          {errorMessage && (
            <div className="mt-4 px-4 py-2 bg-amber-50 text-amber-700 text-xs rounded-xl border border-amber-100 flex items-center gap-2">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0" />
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleManualSubmit} className="w-full max-w-md mt-6 flex gap-2">
            <input
              type="text"
              value={typedText}
              onChange={(e) => setTypedText(e.target.value)}
              placeholder={
                language === "ru"
                  ? "Например: Завтра в 12 созвон по проекту"
                  : "E.g. Monday morning gym session at 7"
              }
              className="flex-1 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!typedText.trim() || isProcessing}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-200 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors flex items-center gap-1"
            >
              <Sparkles className="w-4 h-4" />
              {language === "ru" ? "Парсить" : "Parse"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
