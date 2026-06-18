import React from "react";
import { Check, AlertTriangle, XOctagon, Loader2 } from "lucide-react";

export type ItemStatus = "saved" | "error" | "needs_review" | "saving";

interface StatusBadgeProps {
  status: ItemStatus;
  language?: "ru" | "en" | "uk";
}

export default function StatusBadge({ status, language = "ru" }: StatusBadgeProps) {
  let styles = "bg-zinc-100 text-zinc-700 border-zinc-200";
  let label: string = status;
  let icon = <Loader2 className="w-3.5 h-3.5 animate-spin" />;
  let mobileIcon = icon;

  const t = (ru: string, uk: string, en: string) => language === "ru" ? ru : language === "uk" ? uk : en;

  switch (status) {
    case "saved":
      styles = "bg-emerald-500 text-white border-emerald-600";
      label = t("Сохранено", "Збережено", "Synced");
      icon = <Check className="w-3.5 h-3.5 text-white" />;
      mobileIcon = <Check className="w-4 h-4 text-emerald-500" />;
      break;
    case "needs_review":
      styles = "bg-amber-400 text-white border-amber-500";
      label = t("Требует проверки", "Потребує перевірки", "Needs Review");
      icon = <AlertTriangle className="w-3.5 h-3.5 text-white" />;
      mobileIcon = <AlertTriangle className="w-4 h-4 text-amber-400" />;
      break;
    case "error":
      styles = "bg-rose-50 text-rose-800 border-rose-200/60";
      label = t("Ошибка", "Помилка", "Failed");
      icon = <XOctagon className="w-3.5 h-3.5 text-rose-600" />;
      mobileIcon = <XOctagon className="w-4 h-4 text-rose-500" />;
      break;
    case "saving":
      styles = "bg-blue-50 text-blue-800 border-blue-200/60";
      label = t("Синхронизация...", "Синхронізація...", "Syncing...");
      icon = <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />;
      mobileIcon = <Loader2 className="w-4 h-4 animate-spin text-blue-400" />;
      break;
  }

  if (status === "saved") {
    return (
      <span className="ml-auto flex-shrink-0">
        <Check className="w-4 h-4 text-emerald-500" />
      </span>
    );
  }

  if (status === "needs_review") {
    return (
      <span className="ml-auto flex-shrink-0">
        <AlertTriangle className="w-4 h-4 text-amber-400" />
      </span>
    );
  }

  return (
    <>
      {/* Mobile: bare icon, no background */}
      <span className="sm:hidden ml-auto flex-shrink-0">
        {mobileIcon}
      </span>
      {/* Desktop: full badge with background + text */}
      <span className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${styles}`}>
        {icon}
        {label && <span>{label}</span>}
      </span>
    </>
  );
}
