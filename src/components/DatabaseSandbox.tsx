import React, { useState } from "react";
import { Calendar, FileText, CheckSquare, ListTodo, RefreshCw, CheckCircle2 } from "lucide-react";

interface DatabaseSandboxProps {
  datastores: {
    calendar: any[];
    notion: any[];
    tasks: any[];
  };
  onFetchLatest: () => void;
  language: "ru" | "en";
}

export default function DatabaseSandbox({ datastores, onFetchLatest, language }: DatabaseSandboxProps) {
  const isRu = language === "ru";
  const [activeTab, setActiveTab] = useState<"calendar" | "notion" | "tasks">("calendar");

  return (
    <div className="w-full bg-zinc-900 border border-zinc-800 text-zinc-100 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col gap-4">
      
      {/* Header Info */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <h4 className="text-sm font-bold text-white flex items-center gap-1.5 leading-none">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            {isRu ? "Монитор Внутренних Баз (Sandbox)" : "Integrations Live Sandboxes Monitor"}
          </h4>
          <p className="text-[10px] text-zinc-400 mt-1 font-medium">
            {isRu
              ? "Что фактически синхронизировано во внешние API"
              : "Live visual status of simulated external databases mappings"}
          </p>
        </div>
        <button
          onClick={onFetchLatest}
          className="p-1 px-2.5 bg-zinc-800 hover:bg-zinc-700 text-[10px] font-bold rounded-lg cursor-pointer transition-colors text-zinc-300 flex items-center gap-1.5"
          title={isRu ? "Перезагрузить хранилища" : "Reload Datastores State"}
        >
          <RefreshCw className="w-3 h-3 text-zinc-400" />
          <span>Sync</span>
        </button>
      </div>

      {/* Datastore Tabs */}
      <div className="grid grid-cols-3 gap-1 bg-zinc-950 p-1 rounded-xl">
        <button
          onClick={() => setActiveTab("calendar")}
          className={`flex items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer ${
            activeTab === "calendar"
              ? "bg-blue-600 text-white shadow-md font-extrabold"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <Calendar className="w-3.5 h-3.5" />
          <span>{isRu ? "Календарь" : "Calendar"}</span>
          <span className="text-[9px] bg-zinc-800 px-1 py-0.2 rounded opacity-85">{datastores.calendar.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("notion")}
          className={`flex items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer ${
            activeTab === "notion"
              ? "bg-zinc-700 text-white shadow-md font-extrabold"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Notion</span>
          <span className="text-[9px] bg-zinc-800 px-1 py-0.2 rounded opacity-85">{datastores.notion.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("tasks")}
          className={`flex items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer ${
            activeTab === "tasks"
              ? "bg-violet-600 text-white shadow-md font-extrabold"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span>{isRu ? "Задачи" : "Tasks"}</span>
          <span className="text-[9px] bg-zinc-800 px-1 py-0.2 rounded opacity-85">{datastores.tasks.length}</span>
        </button>
      </div>

      {/* Active Tab Screen */}
      <div className="bg-zinc-950/60 border border-zinc-800/40 rounded-2xl p-4 min-h-[220px] max-h-[350px] overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800">
        
        {/* Sim 1: Google Calendar Agenda */}
        {activeTab === "calendar" && (
          <div className="flex flex-col gap-3">
            {datastores.calendar.length === 0 ? (
              <div className="text-center py-10">
                <Calendar className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
                <p className="text-[11px] text-zinc-500">{isRu ? "Календарь пуст" : "Google Calendar is empty"}</p>
              </div>
            ) : (
              datastores.calendar.map((event, idx) => (
                <div key={idx} className="bg-zinc-900 border-l-4 border-blue-500 rounded-xl p-3.5 border border-zinc-800">
                  <div className="flex items-center justify-between gap-2.5 mb-1">
                    <span className="text-xs font-bold text-white tracking-tight capitalize-first">
                      {event.title}
                    </span>
                    <span className="text-[9px] text-blue-400 font-mono font-bold shrink-0 bg-blue-950 px-1.5 py-0.5 rounded border border-blue-900">
                      GCal Server
                    </span>
                  </div>
                  {event.start && (
                    <p className="text-[10px] text-zinc-400 font-mono mb-1.5 flex items-center gap-1">
                      {new Date(event.start).toLocaleString(isRu ? "ru-RU" : "en-US", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit"
                      })}
                    </p>
                  )}
                  {event.description && (
                    <p className="text-[10px] text-zinc-400 leading-normal mb-1">
                      {event.description}
                    </p>
                  )}
                  {event.tags && event.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {event.tags.map((tag: string, i: number) => (
                        <span key={i} className="text-[8px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.2 rounded border border-zinc-700">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Sim 2: Notion Documents */}
        {activeTab === "notion" && (
          <div className="flex flex-col gap-3">
            {datastores.notion.length === 0 ? (
              <div className="text-center py-10">
                <FileText className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
                <p className="text-[11px] text-zinc-500">{isRu ? "Заметки Notion не синхронизированы" : "Notion space is empty"}</p>
              </div>
            ) : (
              datastores.notion.map((note, idx) => (
                <div key={idx} className="bg-zinc-900 border-l-4 border-zinc-300 rounded-xl p-3.5 border border-zinc-800">
                  <div className="flex items-center justify-between gap-2.5 mb-1">
                    <span className="text-xs font-bold text-white tracking-tight capitalize-first">
                      {note.title}
                    </span>
                    <span className="text-[9px] text-zinc-300 font-mono font-bold shrink-0 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                      Notion DB
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-normal mb-1.5">
                    {note.content}
                  </p>
                  <p className="text-[8px] text-zinc-500 font-mono">
                    {isRu ? "Создано" : "Created"}: {new Date(note.created_at).toLocaleString(isRu ? "ru-RU" : "en-US")}
                  </p>
                  {note.tags && note.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {note.tags.map((tag: string, i: number) => (
                        <span key={i} className="text-[8px] font-mono text-zinc-400 bg-zinc-800 px-1.5 py-0.2 rounded">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* Sim 3: Google Tasks / Reminders Tracker */}
        {activeTab === "tasks" && (
          <div className="flex flex-col gap-3">
            {datastores.tasks.length === 0 ? (
              <div className="text-center py-10">
                <ListTodo className="w-8 h-8 text-zinc-600 mx-auto mb-2 opacity-50" />
                <p className="text-[11px] text-zinc-500">{isRu ? "Задач нет" : "Google Tasks is empty"}</p>
              </div>
            ) : (
              datastores.tasks.map((task, idx) => (
                <div key={idx} className="bg-zinc-900 border-l-4 border-violet-500 rounded-xl p-3.5 border border-zinc-800 flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-white capitalize-first">
                        {task.title}
                      </span>
                      {task.priority && (
                        <span className={`text-[8px] px-1 py-0.1 border rounded font-mono font-bold ${
                          task.priority === "high"
                            ? "bg-rose-950 border-rose-900 text-rose-400"
                            : "bg-amber-950 border-amber-900 text-amber-400"
                        }`}>
                          {task.priority.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {task.due && (
                      <p className="text-[9px] text-zinc-400 font-mono flex items-center gap-1">
                        DueDate: {task.due}
                      </p>
                    )}
                    {task.tags && task.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {task.tags.map((tag: string, i: number) => (
                          <span key={i} className="text-[8px] font-mono text-zinc-500 bg-zinc-800 px-1 py-0.2 rounded">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] text-violet-400 font-mono font-bold bg-violet-950 px-1.5 py-0.5 rounded border border-violet-900 shrink-0">
                    GTasks
                  </span>
                </div>
              ))
            )}
          </div>
        )}

      </div>
    </div>
  );
}
