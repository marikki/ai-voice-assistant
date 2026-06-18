import React from "react";
import { Calendar, FileText, CheckSquare, Clock, Trash2, ArrowRightLeft, Sparkles, AlertCircle, RefreshCw } from "lucide-react";
import StatusBadge from "./StatusBadge";

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

interface ItemListProps {
  items: Item[];
  onSelectItem: (item: Item) => void;
  onDeleteItem: (id: string, e: React.MouseEvent) => void;
  onForceSync: (id: string, e: React.MouseEvent) => void;
  language: "ru" | "en" | "uk";
}

export default function ItemList({ items, onSelectItem, onDeleteItem, onForceSync, language }: ItemListProps) {
  const t =(ru: string, uk: string, en: string) => language === "ru" ? ru : language === "uk" ? uk : en;
  const locale = language === "ru" ? "ru-RU" : language === "uk" ? "uk-UA" : "en-US";

  const getServiceLabelAndIcon = (service: string) => {
    switch (service) {
      case "google_calendar":
        return {
          label: t("Календарь", "Календар", "Calendar"),
          icon: <Calendar className="w-3.5 h-3.5 text-blue-500" />,
          color: "text-blue-600 bg-blue-50 border-blue-100"
        };
      case "notion":
        return {
          label: t("Заметка", "Нотатка", "Notion"),
          icon: <FileText className="w-3.5 h-3.5 text-zinc-700" />,
          color: "text-zinc-800 bg-zinc-50 border-zinc-200"
        };
      case "reminders":
        return {
          label: t("Задача", "Завдання", "Tasks"),
          icon: <CheckSquare className="w-3.5 h-3.5 text-indigo-500" />,
          color: "text-indigo-600 bg-indigo-50 border-indigo-100"
        };
      default:
        return {
          label: t("Не распределен", "Не розподілено", "Unmapped"),
          icon: <AlertCircle className="w-3.5 h-3.5 text-amber-500" />,
          color: "text-amber-800 bg-amber-50 border-amber-100"
        };
    }
  };

  if (items.length === 0) {
    return (
      <div className="w-full bg-white rounded-3xl border border-zinc-100 p-12 text-center text-zinc-500 shadow-xs">
        <div className="w-16 h-16 bg-zinc-50 border border-zinc-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-8 h-8 text-zinc-400" />
        </div>
        <h4 className="font-semibold text-zinc-800 text-base mb-1">
          {t("Список пуст", "Список порожній", "List is empty")}
        </h4>
        <p className="text-xs text-zinc-400 max-w-sm mx-auto leading-relaxed">
          {t("Здесь будут отображаться задиктованные задачи и заметки. Попробуйте нажать кнопку записи!", "Тут відображатимуться продиктовані завдання та нотатки. Натисніть кнопку запису!", "No items recorded in this filter scope yet. Tap the microphone and make a call!")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      {items.map((item) => {
        const parsed = item.ai_parsed_result;
        const sInfo = getServiceLabelAndIcon(item.target_service);
        
        return (
          <div
            key={item.id}
            onClick={() => onSelectItem(item)}
            className="w-full bg-white hover:bg-zinc-50/40 border border-zinc-100 hover:border-indigo-100/60 rounded-2xl p-4 sm:p-5 transition-all duration-150 cursor-pointer shadow-sm relative group"
          >
            {/* Top row: service badge + date + status on one line */}
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] font-bold uppercase rounded-lg ${sInfo.color}`}>
                {sInfo.icon}
                <span>{sInfo.label}</span>
              </span>
              <span className="text-[10px] text-zinc-400 font-medium">
                {new Date(item.created_at).toLocaleDateString(locale, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit"
                })}
              </span>
              <StatusBadge status={item.status} language={language} />
            </div>

            {/* Core Content: parsed title and original transcription excerpt */}
            <div className="mb-1.5">
              <h3 className="text-sm sm:text-base font-bold text-zinc-900 group-hover:text-indigo-950 leading-snug pr-8 capitalize-first">
                {parsed.title || item.original_transcript}
              </h3>
              
              <p className="text-xs text-zinc-500 line-clamp-1 mt-1 shrink-0 font-medium leading-relaxed">
                "{item.original_transcript}"
              </p>
            </div>

            {/* Bottom details context: dates and tags */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-50 pt-2 mt-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 font-medium">
                {parsed.date && (
                  <span className="flex items-center gap-1 font-mono">
                    <Calendar className="w-3.5 h-3.5 text-zinc-400" />
                    {parsed.date}
                  </span>
                )}
                {parsed.start_time && (
                  <span className="flex items-center gap-1 font-mono">
                    <Clock className="w-3.5 h-3.5 text-zinc-400" />
                    {parsed.start_time}
                  </span>
                )}
                {parsed.tags && parsed.tags.length > 0 && (
                  <div className="flex gap-1">
                    {parsed.tags.slice(0, 2).map((tag, i) => (
                      <span key={i} className="text-[10px] text-zinc-400 font-medium">
                        #{tag}
                      </span>
                    ))}
                    {parsed.tags.length > 2 && (
                      <span className="text-[10px] text-zinc-400">+{parsed.tags.length - 2}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Instant Controls */}
              <div className="flex items-center gap-2">
                {item.status !== "saved" && (
                  <button
                    onClick={(e) => onForceSync(item.id, e)}
                    className="p-1 px-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 hover:text-indigo-900 text-[10px] font-bold rounded-lg cursor-pointer transition-colors flex items-center gap-1"
                    title={t("Синхронизировать сейчас", "Синхронізувати зараз", "Push to server")}
                  >
                    <RefreshCw className="w-3 h-3 animate-pulse" />
                    {t("Отправить", "Надіслати", "Sync")}
                  </button>
                )}

                <button
                  onClick={(e) => onDeleteItem(item.id, e)}
                  className="p-1.5 hover:bg-rose-50 text-zinc-400 hover:text-rose-600 rounded-lg cursor-pointer transition-colors"
                  title={t("Удалить запись", "Видалити запис", "Delete voice log")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

          </div>
        );
      })}
    </div>
  );
}
