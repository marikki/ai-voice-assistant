import React from "react";
import { LayoutList, Calendar, CheckSquare, FileText, Mic } from "lucide-react";

export type Tab = "feed" | "calendar" | "tasks" | "notes";

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onMicPress: () => void;
  isRecording?: boolean;
}

const TABS = [
  { id: "feed" as Tab,     label: "Стрічка",  Icon: LayoutList },
  { id: "calendar" as Tab, label: "Календар", Icon: Calendar },
  { id: "tasks" as Tab,    label: "Задачі",   Icon: CheckSquare },
  { id: "notes" as Tab,    label: "Нотатки",  Icon: FileText },
];

export default function BottomTabBar({ activeTab, onTabChange, onMicPress, isRecording }: Props) {
  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-zinc-100 shadow-[0_-1px_12px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex items-center h-[60px] px-1">
        {TABS.slice(0, 2).map(tab => (
          <TabBtn key={tab.id} tab={tab} active={activeTab === tab.id} onClick={() => onTabChange(tab.id)} />
        ))}

        {/* Central FAB */}
        <div className="flex-1 flex justify-center">
          <button
            onClick={onMicPress}
            aria-label="Записати голос"
            className={`w-14 h-14 -mt-6 rounded-full flex items-center justify-center shadow-xl transition-all duration-200 active:scale-95 ${
              isRecording ? "bg-red-500" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            <Mic className="w-6 h-6 text-white" />
          </button>
        </div>

        {TABS.slice(2).map(tab => (
          <TabBtn key={tab.id} tab={tab} active={activeTab === tab.id} onClick={() => onTabChange(tab.id)} />
        ))}
      </div>
    </div>
  );
}

function TabBtn({ tab, active, onClick }: { tab: typeof TABS[0]; active: boolean; onClick: () => void }) {
  const { Icon, label } = tab;
  return (
    <button
      onClick={onClick}
      className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2 cursor-pointer min-h-[60px]"
    >
      <Icon className={`w-5 h-5 transition-colors ${active ? "text-indigo-600" : "text-zinc-400"}`} />
      <span className={`text-[10px] font-medium transition-colors leading-none ${active ? "text-indigo-600" : "text-zinc-400"}`}>
        {label}
      </span>
    </button>
  );
}
