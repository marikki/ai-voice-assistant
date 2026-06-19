import React, { useState } from "react";
import { RefreshCw, Clock, Save, Hash } from "lucide-react";
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

interface DetailViewProps {
  item: Item;
  onBack: () => void;
  onUpdate: (updatedItem: Item) => void;
  onDelete: (id: string) => void;
  onSync: (id: string) => void;
  language: "ru" | "en" | "uk";
}

export default function DetailView({ item, onBack, onUpdate, onDelete, onSync, language }: DetailViewProps) {
  const isRu = language === "ru";

  // Form Fields
  const [transitTitle, setTransitTitle] = useState(item.ai_parsed_result.title);
  const [transitDesc, setTransitDesc] = useState(item.ai_parsed_result.description);
  const [transitType, setTransitType] = useState(item.ai_parsed_result.type);
  const [transitService, setTransitService] = useState(item.ai_parsed_result.target_service);
  const [transitDate, setTransitDate] = useState(item.ai_parsed_result.date || "");
  const [transitStartTime, setTransitStartTime] = useState(item.ai_parsed_result.start_time || "");
  const [transitEndTime, setTransitEndTime] = useState(item.ai_parsed_result.end_time || "");
  const [transitDuration, setTransitDuration] = useState(item.ai_parsed_result.duration_minutes || 60);
  const [transitPriority, setTransitPriority] = useState(item.ai_parsed_result.priority || "medium");
  const [transitTags, setTransitTags] = useState(item.ai_parsed_result.tags.join(", "));
  const [transcriptText, setTranscriptText] = useState(item.original_transcript);
  
  const [isSavedMsg, setIsSavedMsg] = useState(false);

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const tagArray = transitTags
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);

    const updatedItem: Item = {
      ...item,
      original_transcript: transcriptText,
      item_type: transitType,
      target_service: transitService,
      ai_parsed_result: {
        ...item.ai_parsed_result,
        title: transitTitle,
        description: transitDesc,
        type: transitType,
        target_service: transitService,
        date: transitDate || null,
        start_time: transitStartTime || null,
        end_time: transitEndTime || null,
        duration_minutes: Number(transitDuration) || null,
        priority: transitPriority as "low" | "medium" | "high" | null,
        tags: tagArray
      }
    };

    onUpdate(updatedItem);
    setIsSavedMsg(true);
    setTimeout(() => setIsSavedMsg(false), 2500);
  };

  const syncDirectly = () => {
    // First save form so sync gets newest values
    const tagArray = transitTags
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag.length > 0);

    const updatedItem: Item = {
      ...item,
      original_transcript: transcriptText,
      item_type: transitType,
      target_service: transitService,
      ai_parsed_result: {
        ...item.ai_parsed_result,
        title: transitTitle,
        description: transitDesc,
        type: transitType,
        target_service: transitService,
        date: transitDate || null,
        start_time: transitStartTime || null,
        end_time: transitEndTime || null,
        duration_minutes: Number(transitDuration) || null,
        priority: transitPriority as "low" | "medium" | "high" | null,
        tags: tagArray
      }
    };
    
    onUpdate(updatedItem);
    onSync(item.id);
  };

  return (
    <div className="w-full flex flex-col gap-6">

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Form Settings (2/3 width) */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-zinc-100 p-6 sm:p-8 shadow-sm flex flex-col gap-6">
          <div>
            <h3 className="text-base font-bold text-zinc-900 leading-tight">
              {isRu ? "Параметры элемента задачи" : "Item parameter specs editor"}
            </h3>
            <p className="text-xs text-zinc-400 leading-normal">
              {isRu ? "Вы можете изменить распознанные AI значения перед повторной отправкой в сервис" : "Manually modify text entries, categorizations and scheduling parameters."}
            </p>
          </div>

          <form onSubmit={handleFormSubmit} className="flex flex-col gap-5">
            
            {/* Title */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                {isRu ? "Заголовок задачи / заметки" : "Identified title"}
              </label>
              <input
                type="text"
                value={transitTitle}
                onChange={(e) => setTransitTitle(e.target.value)}
                required
                className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 font-medium"
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                {isRu ? "Описание / Подробности" : "Description / Details"}
              </label>
              <textarea
                value={transitDesc}
                onChange={(e) => setTransitDesc(e.target.value)}
                rows={3}
                className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 font-normal leading-relaxed"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Type Category */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Класс записи (AI классификация)" : "Classification Item Type"}
                </label>
                <select
                  value={transitType}
                  onChange={(e) => {
                    const type = e.target.value as any;
                    setTransitType(type);
                    // Match default target services logic
                    if (type === "calendar_event") setTransitService("google_calendar");
                    else if (type === "notion_note") setTransitService("notion");
                    else if (type === "reminder") setTransitService("reminders");
                    else if (type === "task") setTransitService("reminders");
                  }}
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="calendar_event">{isRu ? "Calendar Event (Google Календарь)" : "Calendar Event"}</option>
                  <option value="notion_note">{isRu ? "Notion Note (Заметка Notion)" : "Notion Note"}</option>
                  <option value="reminder">{isRu ? "Напоминание (Google Календарь)" : "Reminder (Google Calendar)"}</option>
                  <option value="task">{isRu ? "Задача (Google Tasks)" : "Task (Google Tasks)"}</option>
                  <option value="unclear">{isRu ? "Нераспознано" : "Unclear / Unsorted"}</option>
                </select>
              </div>

              {/* Target Sync Integration */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Синхронизировать в сервис" : "Target Sync Integration"}
                </label>
                <select
                  value={transitService}
                  onChange={(e) => setTransitService(e.target.value as any)}
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="google_calendar">Google Calendar</option>
                  <option value="notion">Notion Workspace Notes</option>
                  <option value="reminders">Google Tasks</option>
                  <option value="unclear">{isRu ? "Без отправки (Inbox)" : "No Sync (Inbox)"}</option>
                </select>
              </div>

            </div>

            {/* Date and Time Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              
              {/* Date */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Дата события" : "Target Date"}
                </label>
                <input
                  type="date"
                  value={transitDate}
                  onChange={(e) => setTransitDate(e.target.value)}
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 font-mono"
                />
              </div>

              {/* Start Time */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Время начала" : "Start Time"}
                </label>
                <input
                  type="text"
                  value={transitStartTime}
                  onChange={(e) => setTransitStartTime(e.target.value)}
                  placeholder="HH:mm"
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 font-mono"
                />
              </div>

              {/* End Time / Duration */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Длительность (мин)" : "Duration (minutes)"}
                </label>
                <input
                  type="number"
                  value={String(transitDuration)}
                  onChange={(e) => setTransitDuration(Number(e.target.value))}
                  placeholder="60"
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 font-mono"
                />
              </div>

            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Priority */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Приоритет исполнения" : "Priority Score"}
                </label>
                <div className="flex gap-2">
                  {["low", "medium", "high"].map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setTransitPriority(p as any)}
                      className={`flex-1 py-2 rounded-xl text-xs font-semibold border cursor-pointer capitalize transition-all ${
                        transitPriority === p
                          ? p === "high"
                            ? "bg-rose-50 border-rose-300 text-rose-700 font-extrabold"
                            : p === "medium"
                            ? "bg-amber-50 border-amber-300 text-amber-700 font-extrabold"
                            : "bg-zinc-50 border-zinc-300 text-zinc-700 font-extrabold"
                          : "bg-white text-zinc-400 border-zinc-200 hover:bg-zinc-50"
                      }`}
                    >
                      {isRu ? (p === "high" ? "высокий" : p === "medium" ? "средний" : "низкий") : p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  {isRu ? "Теги (через запятую)" : "Tags (comma separated)"}
                </label>
                <input
                  type="text"
                  value={transitTags}
                  onChange={(e) => setTransitTags(e.target.value)}
                  placeholder="работа, счета, сайт"
                  className="w-full bg-zinc-50/50 border border-zinc-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-100"
                />
              </div>

            </div>

            <div className="border-t border-zinc-100 pt-5 mt-2 flex items-center justify-between">
              {isSavedMsg && (
                <span className="text-xs font-semibold text-emerald-600 animate-pulse">
                  {isRu ? "✓ Изменения сохранены" : "✓ Local values saved"}
                </span>
              )}
              <button
                type="submit"
                className="bg-zinc-800 hover:bg-zinc-900 border border-zinc-700 text-white font-semibold text-xs px-6 py-2.5 rounded-xl cursor-pointer shadow-sm transition-all flex items-center gap-1.5 ml-auto"
              >
                <Save className="w-3.5 h-3.5" />
                {isRu ? "Сохранить изменения" : "Apply parameters cache"}
              </button>
            </div>

          </form>
        </div>

        {/* Integration Sync Panel (1/3 width) */}
        <div className="flex flex-col gap-6">
          
          <div className="bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-3xl p-5 sm:p-6 shadow-md flex flex-col gap-4">
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5 border-b border-zinc-800 pb-3 mb-1">
              <RefreshCw className="w-4.5 h-4.5 text-indigo-400" />
              {isRu ? "Синхронизация API" : "Integration Sync Panel"}
            </h4>

            <div className="flex flex-col gap-3 text-xs leading-relaxed">
              <div className="flex items-center justify-between text-zinc-400 mb-1">
                <span>{isRu ? "Канал интеграции" : "Sync Integration"}:</span>
                <span className="font-bold text-white uppercase">{transitService}</span>
              </div>
              <div className="flex items-center justify-between text-zinc-400 border-b border-zinc-800 pb-2 mb-1">
                <span>{isRu ? "Статус записи" : "Internal item status"}:</span>
                <StatusBadge status={item.status} language={language} />
              </div>

              {item.external_service_id ? (
                <div className="flex flex-col gap-1.5 bg-zinc-950 p-3 rounded-xl border border-zinc-800/60 mt-1">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase font-mono block">
                    {isRu ? "Внешний ID в сервисе" : "Connected External API ID"}
                  </span>
                  <p className="font-mono text-[11px] text-zinc-300 font-bold truncate flex items-center gap-1">
                    <Hash className="w-3.5 h-3.5 text-zinc-500" />
                    {item.external_service_id}
                  </p>
                </div>
              ) : (
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/60 mt-1 text-center py-5">
                  <p className="text-[11px] text-zinc-500 font-medium">
                    {isRu ? "Внешняя копия ещё не создана" : "Internal item not paired in GCal/Notion"}
                  </p>
                </div>
              )}

              {item.error_message && (
                <div className="bg-rose-950/20 border border-rose-900/40 text-rose-300 rounded-xl p-3 text-[11px] leading-normal font-medium mt-2">
                  <p className="font-bold mb-0.5">{isRu ? "Сообщение системы" : "Sync Error Log"}:</p>
                  {item.error_message}
                </div>
              )}
            </div>

            <button
              onClick={syncDirectly}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs py-3 rounded-xl shadow-md cursor-pointer transition-all flex items-center justify-center gap-2 mt-4"
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
              {isRu ? "Синхронизировать сейчас" : "Retry push to Sync API"}
            </button>
          </div>

          <div className="bg-zinc-50 border border-zinc-200 rounded-3xl p-5 text-xs text-zinc-650 leading-relaxed font-medium">
            <h5 className="font-bold text-zinc-800 mb-1.5 flex items-center gap-1">
              <Clock className="w-4 h-4 text-zinc-500" />
              {isRu ? "Хронология логов" : "Audit trail history"}
            </h5>
            <p className="border-b border-zinc-100 pb-2 mb-2">
              <span className="font-bold">{isRu ? "Создано" : "First parsed"}:</span>{" "}
              {new Date(item.created_at).toLocaleString(isRu ? "ru-RU" : "en-US")}
            </p>
            <p>
              <span className="font-bold">{isRu ? "Обновлено" : "Last synchronized"}:</span>{" "}
              {new Date(item.updated_at).toLocaleString(isRu ? "ru-RU" : "en-US")}
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
