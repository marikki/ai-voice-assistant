import React from "react";
import { Sparkles, Calendar, FileText, CheckSquare, Clock, ShieldAlert, Check, AlertCircle } from "lucide-react";
import StatusBadge from "./StatusBadge";

// AI Structured Result structure
interface AISchema {
  type: "calendar_event" | "reminder" | "notion_note" | "task" | "unclear";
  title: string;
  description: string;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  duration_minutes: number | null;
  priority: "low" | "medium" | "high" | null;
  target_service: "google_calendar" | "notion" | "reminders" | "unclear";
  tags: string[];
  auto_save: boolean;
  needs_review: boolean;
  confidence: number;
}

interface Item {
  id: string;
  original_transcript: string;
  ai_parsed_result: AISchema;
  item_type: "calendar_event" | "reminder" | "notion_note" | "task" | "unclear";
  target_service: "google_calendar" | "notion" | "reminders" | "unclear";
  external_service_id: string | null;
  status: "saved" | "error" | "needs_review";
  confidence: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface AIResultCardProps {
  item: Item;
  onEdit: (item: Item) => void;
  onForceSync: (id: string) => void;
  language: "ru" | "en" | "uk";
}

export default function AIResultCard({ item, onEdit, onForceSync, language }: AIResultCardProps) {
  const result = item.ai_parsed_result;
  const t = (ru: string, uk: string, en: string) => language === "ru" ? ru : language === "uk" ? uk : en;
  const locale = language === "ru" ? "ru-RU" : language === "uk" ? "uk-UA" : "en-US";

  // Target Service visual helpers
  const getServiceInfo = (service: string) => {
    switch (service) {
      case "google_calendar":
        return {
          name: "Google Calendar",
          bgColor: "bg-blue-50 text-blue-800 border-blue-200",
          icon: <Calendar className="w-4 h-4 text-blue-600" />
        };
      case "notion":
        return {
          name: "Notion Note Space",
          bgColor: "bg-zinc-100 text-zinc-900 border-zinc-200",
          icon: <FileText className="w-4 h-4 text-zinc-800" />
        };
      case "reminders":
        return {
          name: "Google Tasks",
          bgColor: "bg-indigo-50 text-indigo-800 border-indigo-200",
          icon: <CheckSquare className="w-4 h-4 text-indigo-600" />
        };
      default:
        return {
          name: t("Не определено", "Не визначено", "Unmapped"),
          bgColor: "bg-rose-50 text-rose-800 border-rose-200",
          icon: <ShieldAlert className="w-4 h-4 text-rose-600" />
        };
    }
  };

  const serviceInfo = getServiceInfo(result.target_service);

  return (
    <div className="bg-gradient-to-br from-indigo-500/5 via-violet-500/5 to-transparent border border-indigo-100 dark:border-indigo-950/40 rounded-3xl p-5 sm:p-7 shadow-xs mt-6">
      
      {/* Header section with sparkles & confidence */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-indigo-100/60 pb-5 mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-indigo-100 rounded-xl flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-zinc-900 leading-snug">
              {t("Результат распознавания AI", "Результат розпізнавання AI", "AI Cognitive Analysis Outcome")}
            </h4>
            <p className="text-[11px] text-zinc-500 font-medium">
              ID: {item.id} • {new Date(item.created_at).toLocaleTimeString(locale)}
            </p>
          </div>
        </div>

        {/* Confidence scale */}
        <div className="flex items-center gap-3 bg-white border border-zinc-100 rounded-2xl px-3 py-1.5 self-start sm:self-auto shadow-xs">
          <div className="text-right">
            <div className="text-xs font-mono font-bold text-zinc-800 leading-none">
              {(result.confidence * 100).toFixed(0)}%
            </div>
            <span className="text-[9px] text-zinc-400 uppercase font-mono font-bold">
              {t("Точность", "Точність", "Confidence")}
            </span>
          </div>
          <div className="w-12 bg-zinc-100 h-1.5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                result.confidence >= 0.85
                  ? "bg-emerald-500"
                  : result.confidence >= 0.7
                  ? "bg-amber-500"
                  : "bg-rose-500"
              }`}
              style={{ width: `${result.confidence * 100}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Main card representation */}
      <div>
        <div className="mb-4">
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest block mb-1">
            {t("Исходная фраза", "Оригінальна фраза", "Original voice recording")}
          </span>
          <p className="text-sm text-zinc-700 italic font-medium leading-relaxed bg-white border border-zinc-50 rounded-xl p-3 shadow-xs">
            "{item.original_transcript}"
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5 bg-white border border-zinc-100 rounded-2xl p-4 sm:p-5 shadow-xs">
          
          {/* Left panel: Parsed text & summary */}
          <div className="flex flex-col justify-between">
            <div>
              <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider block mb-1 font-mono">
                {t("Сформированный заголовок", "Сформований заголовок", "Formed Actionable Title")}
              </span>
              <h3 className="text-base font-bold text-zinc-900 capitalize-first leading-snug">
                {result.title}
              </h3>
              
              <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mt-3 mb-1">
                {t("Описание / Детали", "Опис / Деталі", "Description / Details")}
              </span>
              <p className="text-xs text-zinc-600 leading-relaxed font-normal">
                {result.description || t("Без описания", "Без опису", "No description mapped")}
              </p>
            </div>

            {/* Dynamic tags */}
            {result.tags && result.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {result.tags.map((tag, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] bg-zinc-50 border border-zinc-200/60 text-zinc-600 px-2 py-0.5 rounded-md font-medium"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Right panel: Extracted entities */}
          <div className="border-t md:border-t-0 md:border-l border-zinc-100 pt-4 md:pt-0 md:pl-6 flex flex-col gap-3">
            
            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 font-medium">{t("Сервис", "Сервіс", "Mapped Service")}:</span>
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 border rounded-lg text-xs font-semibold ${serviceInfo.bgColor}`}>
                {serviceInfo.icon}
                <span>{serviceInfo.name}</span>
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 font-medium">{t("Дата", "Дата", "Target Date")}:</span>
              <span className="font-mono font-bold text-zinc-900 bg-zinc-50 rounded px-2 py-0.5 border border-zinc-100">
                {result.date || "—"}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 font-medium">{t("Время", "Час", "Scheduled Time")}:</span>
              <span className="font-mono font-bold text-zinc-900 bg-zinc-50 rounded px-2 py-0.5 border border-zinc-100 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-zinc-400" />
                {result.start_time ? `${result.start_time}${result.end_time ? ` - ${result.end_time}` : ""}` : "—"}
              </span>
            </div>

            {result.duration_minutes && (
              <div className="flex justify-between items-center text-xs">
                <span className="text-zinc-500 font-medium">{t("Длительность", "Тривалість", "Duration")}:</span>
                <span className="font-mono font-bold text-zinc-700">
                  {result.duration_minutes} {t("мин.", "хв.", "mins")}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center text-xs">
              <span className="text-zinc-500 font-medium">{t("Приоритет", "Пріоритет", "Priority")}:</span>
              <span className={`font-semibold capitalize text-xs ${
                result.priority === "high"
                  ? "text-rose-600"
                  : result.priority === "medium"
                  ? "text-amber-600"
                  : "text-zinc-500"
              }`}>
                {result.priority ? (
                  language === "ru"
                    ? (result.priority === "high" ? "высокий" : result.priority === "medium" ? "средний" : "низкий")
                    : language === "uk"
                    ? (result.priority === "high" ? "високий" : result.priority === "medium" ? "середній" : "низький")
                    : result.priority
                ) : "—"}
              </span>
            </div>

            <div className="flex justify-between items-center text-xs border-t border-zinc-100 pt-2 mt-1">
              <span className="text-zinc-500 font-medium">{t("Статус действия", "Статус дії", "Operation status")}:</span>
              <StatusBadge status={item.status} language={language} />
            </div>

          </div>
        </div>
      </div>

      {/* Warning if needs review or was saved to local due to disconnection */}
      {item.status === "needs_review" && (
        <div className="mt-4 bg-amber-50 border border-amber-200/60 text-amber-900 rounded-xl p-3 flex items-start gap-2.5">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold">
              {t("Требуется проверка", "Потрібна перевірка", "Requires Adjustment")}:
            </span>{" "}
            {item.error_message || t("Низкая уверенность AI или недостаточно данных для автосохранения.", "Низька впевненість AI або недостатньо даних для автозбереження.", "Low model classification confidence or missing critical event scheduling fields.")}
          </div>
        </div>
      )}

      {/* Button controls on footer */}
      <div className="flex flex-wrap items-center justify-end gap-3 mt-6 border-t border-indigo-100/40 pt-4">
        <button
          onClick={() => onEdit(item)}
          className="bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border border-zinc-200 shrink-0 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200"
        >
          {t("Редактировать параметры", "Редагувати параметри", "Edit Parameter details")}
        </button>

        {item.status !== "saved" && (
          <button
            onClick={() => onForceSync(item.id)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-indigo-100 shrink-0 px-5 py-2 rounded-xl text-xs font-semibold cursor-pointer transition-all duration-200 flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            {t("Переотправить в сервис", "Повторно надіслати", "Retry push to Sync")}
          </button>
        )}
      </div>

    </div>
  );
}
