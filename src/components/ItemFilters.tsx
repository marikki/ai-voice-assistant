import React from "react";
import { List, Calendar, FileText, CheckSquare, AlertTriangle } from "lucide-react";

export type FilterValue = "all" | "calendar_event" | "notion_note" | "reminder" | "task" | "needs_review";
// "task" kept in type for backwards-compatibility with existing db items

interface ItemFiltersProps {
  currentFilter: FilterValue;
  onFilterChange: (filter: FilterValue) => void;
  language: "ru" | "en" | "uk";
  counts: Record<FilterValue, number>;
}

export default function ItemFilters({ currentFilter, onFilterChange, language, counts }: ItemFiltersProps) {
  const t = (ru: string, uk: string, en: string) => language === "ru" ? ru : language === "uk" ? uk : en;

  const filters = [
    {
      value: "all" as FilterValue,
      label: t("Все", "Всі", "All"),
      icon: <List className="w-3.5 h-3.5" />
    },
    {
      value: "calendar_event" as FilterValue,
      label: t("Календарь", "Календар", "Calendar"),
      icon: <Calendar className="w-3.5 h-3.5" />
    },
    {
      value: "task" as FilterValue,
      label: "Google Tasks",
      icon: <CheckSquare className="w-3.5 h-3.5" />
    },
    {
      value: "notion_note" as FilterValue,
      label: t("Заметки", "Нотатки", "Notion Notes"),
      icon: <FileText className="w-3.5 h-3.5" />
    },
    {
      value: "needs_review" as FilterValue,
      label: t("Требуют проверки", "Потребують перевірки", "Inbox / Review"),
      icon: <AlertTriangle className="w-3.5 h-3.5" />
    }
  ];

  return (
    <div className="w-full overflow-x-auto pb-2 scrollbar-none">
      <div className="flex gap-2 min-w-max p-1 bg-zinc-100 rounded-2xl">
        {filters.map((f) => {
          const isActive = currentFilter === f.value;
          const count = counts[f.value] || 0;
          return (
            <button
              key={f.value}
              onClick={() => onFilterChange(f.value)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl cursor-pointer transition-all duration-150 ${
                isActive
                  ? "bg-white text-zinc-900 shadow-xs"
                  : "text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50/60"
              }`}
            >
              {f.icon}
              <span>{f.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                isActive
                  ? "bg-indigo-50 text-indigo-700 font-bold"
                  : "bg-zinc-200 text-zinc-600"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
