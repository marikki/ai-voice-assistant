import React from "react";
import { Calendar, FileText, CheckSquare, AlertCircle, Trash2, RefreshCw } from "lucide-react";

export interface AISchema {
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
  completed?: boolean;
}

export interface Item {
  id: string;
  original_transcript: string;
  ai_parsed_result: AISchema;
  item_type: "calendar_event" | "reminder" | "notion_note" | "task" | "unclear";
  target_service: "google_calendar" | "notion" | "reminders" | "unclear";
  external_service_id: string | null;
  status: "saved" | "error" | "needs_review" | "saving";
  confidence: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type ListVariant = "feed" | "calendar" | "tasks" | "notes";

interface Props {
  items: Item[];
  variant?: ListVariant;
  onSelectItem: (item: Item) => void;
  onDeleteItem: (id: string, e: React.MouseEvent) => void;
  onForceSync: (id: string, e: React.MouseEvent) => void;
  onToggleComplete?: (id: string) => void;
  language: "ru" | "en" | "uk";
  singleColumn?: boolean;
}

function formatDate(date: string | null, time: string | null, locale: string): string | null {
  if (!date && !time) return null;
  const parts: string[] = [];
  if (date) {
    const d = new Date(date + "T00:00:00");
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    if (d.getTime() === today.getTime()) parts.push("Сьогодні");
    else if (d.getTime() === tomorrow.getTime()) parts.push("Завтра");
    else parts.push(d.toLocaleDateString(locale, { day: "numeric", month: "short" }));
  }
  if (time) parts.push(time);
  return parts.join(" · ");
}

function getCategoryMeta(item: Item) {
  const svc = item.target_service || item.item_type;
  if (svc === "google_calendar" || item.item_type === "calendar_event" || item.item_type === "reminder") {
    return { label: "КАЛЕНДАР", Icon: Calendar, iconBg: "bg-indigo-100", iconColor: "text-indigo-600" };
  }
  if (svc === "reminders" || item.item_type === "task") {
    return { label: "ЗАДАЧІ", Icon: CheckSquare, iconBg: "bg-indigo-100", iconColor: "text-indigo-600" };
  }
  if (svc === "notion" || item.item_type === "notion_note") {
    return { label: "НОТАТКИ", Icon: FileText, iconBg: "bg-indigo-100", iconColor: "text-indigo-600" };
  }
  return { label: "НЕВИЗНАЧЕНО", Icon: AlertCircle, iconBg: "bg-amber-100", iconColor: "text-amber-600" };
}

// ── Feed card ─────────────────────────────────────────────────
function FeedCard({ item, onClick, onDelete, onSync }: {
  item: Item;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onSync: (e: React.MouseEvent) => void;
}) {
  const { label, Icon, iconColor } = getCategoryMeta(item);
  const parsed = item.ai_parsed_result;
  const locale = "uk-UA";
  const dateStr = formatDate(parsed.date, parsed.start_time, locale);
  const needsReview = item.status === "needs_review" || item.status === "error";
  const isDone = false; // no completed state in current data model

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-transform relative group ${
        needsReview ? "border-l-4 border-l-amber-400 border border-zinc-100" : "border border-zinc-100"
      }`}
    >
      {/* Category label */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${iconColor}`} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{label}</span>
        {needsReview && (
          <span className="ml-auto text-[9px] font-bold uppercase text-amber-500 tracking-wide">Потребує перевірки</span>
        )}
      </div>

      {/* Title */}
      <h3 className={`text-[15px] font-semibold text-zinc-900 leading-snug ${isDone ? "line-through text-zinc-400" : ""}`}>
        {parsed.title || item.original_transcript}
      </h3>

      {/* Date */}
      {dateStr && (
        <p className="text-xs text-zinc-400 mt-1 font-medium">{dateStr}</p>
      )}

      {/* Quick actions - show on hover */}
      <div className="absolute right-3 top-3 hidden group-hover:flex items-center gap-1">
        {item.status !== "saved" && (
          <button
            onClick={onSync}
            className="p-1.5 hover:bg-indigo-50 text-zinc-400 hover:text-indigo-600 rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={onDelete}
          className="p-1.5 hover:bg-rose-50 text-zinc-400 hover:text-rose-500 rounded-lg transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Calendar card ─────────────────────────────────────────────
function CalendarCard({ item, onClick, onDelete }: {
  item: Item;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const parsed = item.ai_parsed_result;
  const locale = "uk-UA";
  const dateStr = formatDate(parsed.date, parsed.start_time, locale);

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl p-4 border border-zinc-100 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-transform group"
    >
      <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
        <Calendar className="w-5 h-5 text-indigo-600" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] font-semibold text-zinc-900 truncate leading-snug">
          {parsed.title || item.original_transcript}
        </h3>
        {dateStr && (
          <p className="text-xs font-medium text-indigo-600 mt-0.5">{dateStr}</p>
        )}
      </div>
      <button
        onClick={onDelete}
        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-zinc-400 hover:text-rose-500 rounded-lg transition-all flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────
function TaskCard({ item, onClick, onDelete, onToggle }: {
  item: Item;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
  onToggle?: () => void;
}) {
  const parsed = item.ai_parsed_result;
  const isDone = !!parsed.completed;

  const handleCheckbox = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle?.();
  };

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl px-4 py-3.5 border border-zinc-100 flex items-center gap-3 cursor-pointer active:scale-[0.99] transition-all group"
    >
      {/* Checkbox */}
      <button
        onClick={handleCheckbox}
        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all duration-200 ${
          isDone ? "bg-indigo-600 border-indigo-600" : "border-zinc-300 hover:border-indigo-400"
        }`}
      >
        {isDone && (
          <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      <span className={`flex-1 text-[15px] font-medium leading-snug transition-colors ${
        isDone ? "line-through text-zinc-400" : "text-zinc-900"
      }`}>
        {parsed.title || item.original_transcript}
      </span>

      <button
        onClick={onDelete}
        className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-zinc-400 hover:text-rose-500 rounded-lg transition-all flex-shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Notes card (used in 2-col grid from parent) ───────────────
function NoteCard({ item, onClick, onDelete }: {
  item: Item;
  onClick: () => void;
  onDelete: (e: React.MouseEvent) => void;
}) {
  const parsed = item.ai_parsed_result;
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl p-4 border border-zinc-100 cursor-pointer active:scale-[0.99] transition-transform group relative"
    >
      <h3 className="text-[15px] font-semibold text-zinc-900 leading-snug mb-1">
        {parsed.title || item.original_transcript}
      </h3>
      <p className="text-xs text-zinc-400 font-medium">Нотатка</p>
      <button
        onClick={onDelete}
        className="absolute top-3 right-3 p-1 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-zinc-400 hover:text-rose-500 rounded-lg transition-all"
      >
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptyState({ variant }: { variant: ListVariant }) {
  const messages: Record<ListVariant, string> = {
    feed: "Тут з'являтимуться всі записи. Натисни мікрофон!",
    calendar: "Немає подій у календарі.",
    tasks: "Немає задач. Надиктуй першу!",
    notes: "Немає нотаток.",
  };
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-4">
      <div className="w-14 h-14 rounded-2xl bg-zinc-100 flex items-center justify-center mb-3">
        <FileText className="w-6 h-6 text-zinc-300" />
      </div>
      <p className="text-sm text-zinc-400 font-medium">{messages[variant]}</p>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────
export default function ItemList({ items, variant = "feed", onSelectItem, onDeleteItem, onForceSync, onToggleComplete, singleColumn }: Props) {
  if (items.length === 0) return <EmptyState variant={variant} />;

  if (variant === "notes") {
    return (
      <div className={singleColumn ? "flex flex-col gap-2" : "grid grid-cols-2 gap-3"}>
        {items.map(item => (
          <NoteCard
            key={item.id}
            item={item}
            onClick={() => onSelectItem(item)}
            onDelete={e => onDeleteItem(item.id, e)}
          />
        ))}
      </div>
    );
  }

  if (variant === "calendar") {
    return (
      <div className="flex flex-col gap-2">
        {items.map(item => (
          <CalendarCard
            key={item.id}
            item={item}
            onClick={() => onSelectItem(item)}
            onDelete={e => onDeleteItem(item.id, e)}
          />
        ))}
      </div>
    );
  }

  if (variant === "tasks") {
    return (
      <div className="flex flex-col gap-2">
        {items.map(item => (
          <TaskCard
            key={item.id}
            item={item}
            onClick={() => onSelectItem(item)}
            onDelete={e => onDeleteItem(item.id, e)}
            onToggle={onToggleComplete ? () => onToggleComplete(item.id) : undefined}
          />
        ))}
      </div>
    );
  }

  // Default: feed
  return (
    <div className="flex flex-col gap-2">
      {items.map(item => (
        <FeedCard
          key={item.id}
          item={item}
          onClick={() => onSelectItem(item)}
          onDelete={e => onDeleteItem(item.id, e)}
          onSync={e => onForceSync(item.id, e)}
        />
      ))}
    </div>
  );
}
