import React from "react";
import { Sparkles, Radio } from "lucide-react";

interface LiveTranscriptProps {
  text: string;
  isRecording: boolean;
  language: "ru" | "en" | "uk";
}

export default function LiveTranscript({ text, isRecording, language }: LiveTranscriptProps) {
  if (!isRecording && !text) return null;

  return (
    <div className="w-full bg-indigo-50/40 border border-indigo-100 rounded-2xl p-4 sm:p-5 mt-4 transition-all duration-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1.5 font-mono">
          <Radio className="w-3.5 h-3.5 text-indigo-600 animate-pulse" />
          {isRecording
            ? language === "ru"
              ? "АКТИВНЫЙ ГОЛОСОВОЙ ПОТОК"
              : "LIVE SPEECH STREAM"
            : language === "ru"
            ? "РАСШИФРОВАННЫЙ ТЕКСТ"
            : "TRANSCRIBED TEXT"}
        </span>
        <span className="text-[10px] text-zinc-500 font-mono flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-amber-500 fill-amber-500" />
          Web Speech API
        </span>
      </div>
      
      <div className="text-sm text-zinc-800 leading-relaxed font-medium">
        {text ? (
          <span className="text-zinc-900 border-r-2 border-indigo-600 animate-pulse pr-0.5">{text}</span>
        ) : (
          <span className="text-zinc-400 italic">
            {language === "ru"
              ? "Начните говорить..."
              : "Listening... Speak now..."}
          </span>
        )}
      </div>
    </div>
  );
}
