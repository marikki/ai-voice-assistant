import React, { useState, useEffect } from "react";
import { Settings, Sparkles, RefreshCw, Layers, CheckSquare, Calendar, FileText, ChevronDown } from "lucide-react";
import VoiceRecorder from "./components/VoiceRecorder";
import LiveTranscript from "./components/LiveTranscript";
import AIResultCard from "./components/AIResultCard";
import ItemFilters, { FilterValue } from "./components/ItemFilters";
import ItemList from "./components/ItemList";
import IntegrationSettings from "./components/IntegrationSettings";
import DetailView from "./components/DetailView";
import LoginPage from "./components/LoginPage";

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

interface SettingsState {
  google_calendar_connected: boolean;
  notion_connected: boolean;
  google_tasks_connected: boolean;
  notion_database_id: string;
  notion_token: string;
  auto_save_threshold: number;
  default_language: "ru" | "en" | "uk";
  mock_mode: boolean;
}


interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "warning" | "error" | "info";
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [currentPage, setCurrentPage] = useState<"dashboard" | "settings">("dashboard");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  
  // Core API State
  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<SettingsState>({
    google_calendar_connected: true,
    notion_connected: false,
    google_tasks_connected: true,
    notion_database_id: "",
    notion_token: "",
    auto_save_threshold: 0.85,
    default_language: "ru",
    mock_mode: true
  });

  // UI state
  const [currentFilter, setCurrentFilter] = useState<FilterValue>("all");
  const [isProcessing, setIsProcessing] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [lastProcessedItem, setLastProcessedItem] = useState<Item | null>(null);
  const [aiCardExpanded, setAiCardExpanded] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (lastProcessedItem) setAiCardExpanded(true);
  }, [lastProcessedItem?.id]);

  // -------------------------------------------------------------
  // Auth check + initial data load
  // -------------------------------------------------------------
  useEffect(() => {
    async function init() {
      try {
        const authRes = await fetch("/api/auth/check", { credentials: "include" });
        if (!authRes.ok) {
          setIsAuthenticated(false);
          setIsLoading(false);
          return;
        }
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const [itemsRes, settingsRes] = await Promise.all([
          fetch("/api/items", { credentials: "include" }),
          fetch("/api/settings", { credentials: "include" }),
        ]);

        if (itemsRes.ok && settingsRes.ok) {
          setItems(await itemsRes.json());
          setSettings(await settingsRes.json());
        }
      } catch (err) {
        console.error("Failed to load initial data from Express backend:", err);
        addToast(
          settings.default_language === "ru"
            ? "Не удалось связаться с сервером. Проверьте соединение!"
            : "Server link issue. Verify local container ingress!",
          "error"
        );
      } finally {
        setIsLoading(false);
      }
    }

    init();
  }, []);

  // -------------------------------------------------------------
  // API Fetch Utility Helpers
  // -------------------------------------------------------------
  const addToast = (text: string, type: ToastMessage["type"] = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // 1. Core voice note processor
  const handleTranscriptComplete = async (transcript: string) => {
    if (!transcript.trim()) return;
    setIsProcessing(true);
    setLiveTranscript("");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript,
          language: settings.default_language
        })
      });

      if (!response.ok) {
        throw new Error("Analysis request failed");
      }

      const newItem: Item = await response.json();
      
      // Update local item stats
      setItems((prev) => [newItem, ...prev]);
      setLastProcessedItem(newItem);
      
      // Trigger beautiful contextual alerts/toasts
      const result = newItem.ai_parsed_result;
      const isRu = settings.default_language === "ru";

      if (newItem.status === "saved") {
        let serviceStr = "Google Calendar";
        if (result.target_service === "notion") serviceStr = "Notion Workspace";
        else if (result.target_service === "reminders") serviceStr = "Google Tasks";

        addToast(
          isRu
            ? `Автоматически сохранено в ${serviceStr} ✓`
            : `Auto-saved successfully to ${serviceStr} ✓`,
          "success"
        );
      } else {
        // Needs review or is disconnected
        if (newItem.error_message && newItem.error_message.includes("disconnected")) {
          addToast(
            isRu
              ? `Сохранено во входящие: требуется подключение в настройках.`
              : `Inbox folder entry: connect integration inside settings first.`,
            "warning"
          );
        } else {
          addToast(
            isRu
              ? "Недостаточно данных. Запись сохранена во входящие для проверки."
              : "Details sparse. Mapped to Inbox review folder.",
            "info"
          );
        }
      }

    } catch (err) {
      console.error("Transcription pipeline error:", err);
      addToast(
        settings.default_language === "ru"
          ? "Ошибка обработки AI. Проверьте ключ API в панели Secrets!"
          : "AI processing failure. Validate API Key secret bounds!",
        "error"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Clear / Reset DB
  const handleResetDb = async () => {
    try {
      const response = await fetch("/api/items/reset", { method: "POST" });
      if (response.ok) {
        const itemsRes = await fetch("/api/items");
        const itemsData = await itemsRes.json();
        setItems(itemsData);
        setLastProcessedItem(null);
        setSelectedItem(null);
        
        addToast(
          settings.default_language === "ru"
            ? "База данных песочницы успешно сброшена к исходным записям!"
            : "Sandbox database restored to premium preloaded mock schedules!",
          "success"
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 3. Update Item fields
  const handleUpdateItem = async (updatedItem: Item) => {
    try {
      const response = await fetch(`/api/items/${updatedItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedItem)
      });

      if (response.ok) {
        const savedItem = await response.json();
        setItems((prev) => prev.map((item) => (item.id === savedItem.id ? savedItem : item)));
        if (selectedItem?.id === savedItem.id) setSelectedItem(savedItem);
        if (lastProcessedItem?.id === savedItem.id) setLastProcessedItem(savedItem);
        
        addToast(
          settings.default_language === "ru" ? "Изменения сохранены!" : "Parameters updated!",
          "success"
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 4. Force integration sync
  const handleSyncItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    // Optimistically set status of item in UI to saving
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "saving" as any } : item))
    );

    try {
      const response = await fetch(`/api/items/${id}/sync`, { method: "POST" });
      const apiResult = await response.json();

      if (response.ok) {
        const updatedItem = apiResult.item;
        setItems((prev) => prev.map((item) => (item.id === id ? updatedItem : item)));
        
        if (selectedItem?.id === id) setSelectedItem(updatedItem);
        if (lastProcessedItem?.id === id) setLastProcessedItem(updatedItem);
        
        const isRu = settings.default_language === "ru";
        addToast(
          isRu
            ? `Успешно отправлено и синхронизировано в ${updatedItem.target_service === "notion" ? "Notion" : "системы"}!`
            : `Sync completed successfully for target ${updatedItem.target_service}!`,
          "success"
        );
      } else {
        const errorItem = apiResult.item || items.find((item) => item.id === id);
        if (errorItem) {
          setItems((prev) => prev.map((item) => (item.id === id ? errorItem : item)));
          if (selectedItem?.id === id) setSelectedItem(errorItem);
        }
        throw new Error(apiResult.error || "Sync error");
      }
    } catch (err: any) {
      console.error(err);
      addToast(err.message || "Failed to push item", "error");
    }
  };

  // 5. Delete transaction log
  const handleDeleteItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    try {
      const response = await fetch(`/api/items/${id}`, { method: "DELETE" });
      if (response.ok) {
        setItems((prev) => prev.filter((item) => item.id !== id));
        if (selectedItem?.id === id) setSelectedItem(null);
        if (lastProcessedItem?.id === id) setLastProcessedItem(null);
        
        addToast(
          settings.default_language === "ru" ? "Элемент удален!" : "Item removed from logs!",
          "info"
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // 6. Save integrations connections settings
  const handleSaveSettings = async (updatedSettings: SettingsState) => {
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedSettings)
      });

      if (response.ok) {
        const data = await response.json();
        setSettings(data);
        addToast(
          settings.default_language === "ru" ? "Настройки обновлены!" : "Settings saved!",
          "success"
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // Data Filtering computations
  // -------------------------------------------------------------
  const filteredItems = items.filter((item) => {
    if (currentFilter === "all") return true;
    if (currentFilter === "needs_review") return item.status === "needs_review" || item.status === "error";
    // reminders go to Google Calendar — show them under calendar_event tab
    if (currentFilter === "calendar_event") return item.item_type === "calendar_event" || item.item_type === "reminder";
    return item.item_type === currentFilter;
  });

  const getCountHash = (): Record<FilterValue, number> => {
    const hash: Record<FilterValue, number> = {
      all: items.length,
      calendar_event: 0,
      notion_note: 0,
      reminder: 0,
      task: 0,
      needs_review: 0
    };

    items.forEach((item) => {
      const type = item.item_type as FilterValue;
      if (hash[type] !== undefined) {
        hash[type]++;
      }
      // reminders go to Google Calendar — count them under calendar_event
      if (type === "reminder") {
        hash.calendar_event++;
      }
      if (item.status === "needs_review" || item.status === "error") {
        hash.needs_review++;
      }
    });

    return hash;
  };

  const t = (ru: string, uk: string, en: string) => settings.default_language === "ru" ? ru : settings.default_language === "uk" ? uk : en;
  const displayedItem = lastProcessedItem ?? items[0] ?? null;

  if (isAuthenticated === null) return null;
  if (isAuthenticated === false) return <LoginPage onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="min-h-screen bg-[#FAFAFA] text-[#1A1A1A] font-sans selection:bg-indigo-100 selection:text-indigo-900 leading-normal" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      
      {/* Toast Alert System overlay */}
      <div className="fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto p-4 rounded-2xl shadow-xl border text-xs font-semibold flex items-center justify-between gap-4 animate-fade-in-up transition-opacity duration-300 ${
              t.type === "success"
                ? "bg-emerald-900 text-emerald-100 border-emerald-950/60"
                : t.type === "warning"
                ? "bg-amber-900 text-amber-100 border-amber-950/60"
                : t.type === "error"
                ? "bg-rose-900 text-rose-100 border-rose-950/60"
                : "bg-zinc-900 text-zinc-100 border-zinc-950"
            }`}
          >
            <span>{t.text}</span>
            <span className="opacity-60 cursor-pointer text-[10px]" onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}>✕</span>
          </div>
        ))}
      </div>

      {/* Elegant minimalist navigation bar */}
      <nav className="flex items-center justify-between px-6 sm:px-8 h-16 bg-white border-b border-gray-100 mb-6 shadow-xs">
        <button
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => { setCurrentPage("dashboard"); setSelectedItem(null); }}
        >
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
            </svg>
          </div>
          <span className="hidden sm:block font-bold text-base sm:text-lg tracking-tight">VoiceMind <span className="text-indigo-600">AI</span></span>
        </button>

        <div className="flex items-center space-x-3 sm:space-x-6">
          <div className="hidden md:flex space-x-2 text-[11px] font-medium">
            <span className={`flex items-center px-2 py-0.5 ${settings.google_calendar_connected ? "bg-green-50 text-green-700 border-green-100" : "bg-gray-50 text-gray-500 border-gray-100"} rounded border`}>
              <span className={`w-1.5 h-1.5 rounded-full ${settings.google_calendar_connected ? "bg-green-500" : "bg-gray-300"} mr-1.5`}></span>
              GCal {settings.google_calendar_connected ? t("Активен", "Активний", "Online") : t("Выкл", "Вимк", "Offline")}
            </span>
            <span className={`flex items-center px-2 py-0.5 ${settings.notion_connected ? "bg-green-50 text-green-700 border-green-100" : "bg-gray-50 text-gray-500 border-gray-100"} rounded border`}>
              <span className={`w-1.5 h-1.5 rounded-full ${settings.notion_connected ? "bg-green-500" : "bg-gray-300"} mr-1.5`}></span>
              Notion {settings.notion_connected ? t("Активен", "Активний", "Online") : t("Выкл", "Вимк", "Offline")}
            </span>
          </div>

          {/* Navigation Control Buttons */}
          <div className="flex items-center gap-1 bg-gray-100/80 p-0.5 rounded-lg border border-gray-200/40">
            <button
              onClick={() => {
                setSelectedItem(null);
                setCurrentPage("dashboard");
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                currentPage === "dashboard" && !selectedItem
                  ? "bg-white text-gray-900 shadow-xs"
                  : "text-gray-500 hover:text-gray-800 animate-none"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{t("Дашборд", "Дашборд", "Dashboard")}</span>
            </button>

            <button
              onClick={() => {
                setSelectedItem(null);
                setCurrentPage("settings");
              }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all cursor-pointer ${
                currentPage === "settings"
                  ? "bg-white text-gray-950 shadow-xs"
                  : "text-gray-500 hover:text-gray-800"
              }`}
            >
              <Settings className="w-3.5 h-3.5" />
              <span>{t("Настройки", "Налаштування", "Integrations")}</span>
            </button>
          </div>

          <div 
            className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700 cursor-help"
            title="marikkish@gmail.com"
          >
            MK
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

        {/* Global Loading Spinner */}
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-24 text-zinc-400">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
            <p className="text-sm font-medium">{t("Загрузка параметров...", "Завантаження...", "Connecting to full-stack container...")}</p>
          </div>
        ) : (
          <div>
            
            {/* Context A: Selected Item Details page (Route /items/[id]) */}
            {selectedItem ? (
              <DetailView
                item={selectedItem}
                onBack={() => setSelectedItem(null)}
                onUpdate={handleUpdateItem}
                onDelete={(id) => {
                  handleDeleteItem(id);
                  setSelectedItem(null);
                }}
                onSync={handleSyncItem}
                language={settings.default_language}
              />
            ) : currentPage === "settings" ? (
              
              /* Context B: Settings page (Route /settings) */
              <div className="flex justify-center">
                <IntegrationSettings
                  settings={settings}
                  onSave={handleSaveSettings}
                  onResetDb={handleResetDb}
                  language={settings.default_language}
                />
              </div>
            ) : (
              
              /* Context C: Primary Dashboard */
              <div className="flex flex-col gap-6 pb-20">

                  {/* 1. Archive — always first */}
                  <div>
                    <div className="flex flex-col gap-4">
                      <ItemFilters
                        currentFilter={currentFilter}
                        onFilterChange={(f) => setCurrentFilter(f)}
                        language={settings.default_language}
                        counts={getCountHash()}
                      />
                      {currentFilter === "all" ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-zinc-200">
                              <Calendar className="w-4 h-4 text-blue-500" />
                              <span className="text-sm font-bold text-zinc-700">{t("Календарь", "Календар", "Calendar")}</span>
                              <span className="ml-auto text-xs text-zinc-400 font-mono">{items.filter(i => i.item_type === "calendar_event" || i.item_type === "reminder").length}</span>
                            </div>
                            <ItemList
                              items={items.filter(i => i.item_type === "calendar_event" || i.item_type === "reminder")}
                              onSelectItem={(item) => setSelectedItem(item)}
                              onDeleteItem={(id, e) => handleDeleteItem(id, e)}
                              onForceSync={(id, e) => handleSyncItem(id, e)}
                              language={settings.default_language}
                            />
                          </div>
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-zinc-200">
                              <CheckSquare className="w-4 h-4 text-indigo-500" />
                              <span className="text-sm font-bold text-zinc-700">Google Tasks</span>
                              <span className="ml-auto text-xs text-zinc-400 font-mono">{items.filter(i => i.item_type === "task").length}</span>
                            </div>
                            <ItemList
                              items={items.filter(i => i.item_type === "task")}
                              onSelectItem={(item) => setSelectedItem(item)}
                              onDeleteItem={(id, e) => handleDeleteItem(id, e)}
                              onForceSync={(id, e) => handleSyncItem(id, e)}
                              language={settings.default_language}
                            />
                          </div>
                          <div className="flex flex-col gap-3">
                            <div className="flex items-center gap-2 pb-2 border-b border-zinc-200">
                              <FileText className="w-4 h-4 text-emerald-500" />
                              <span className="text-sm font-bold text-zinc-700">{t("Заметки", "Нотатки", "Notes")}</span>
                              <span className="ml-auto text-xs text-zinc-400 font-mono">{items.filter(i => i.item_type === "notion_note").length}</span>
                            </div>
                            <ItemList
                              items={items.filter(i => i.item_type === "notion_note")}
                              onSelectItem={(item) => setSelectedItem(item)}
                              onDeleteItem={(id, e) => handleDeleteItem(id, e)}
                              onForceSync={(id, e) => handleSyncItem(id, e)}
                              language={settings.default_language}
                            />
                          </div>
                        </div>
                      ) : (
                        <ItemList
                          items={filteredItems}
                          onSelectItem={(item) => setSelectedItem(item)}
                          onDeleteItem={(id, e) => handleDeleteItem(id, e)}
                          onForceSync={(id, e) => handleSyncItem(id, e)}
                          language={settings.default_language}
                        />
                      )}
                    </div>
                  </div>

                  {/* 2. AI Result Card — collapsible everywhere */}
                  {displayedItem && (
                    <div className="animate-fade-in-up">
                      <button
                        onClick={() => setAiCardExpanded(!aiCardExpanded)}
                        className="w-full flex items-center gap-2 px-4 py-3 bg-white border border-indigo-100 rounded-2xl text-xs font-bold text-indigo-700 shadow-sm"
                      >
                        <Sparkles className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span className="flex-1 text-left">
                          {t("Что ИИ зафиксировал из последней записи", "Що AI зафіксував з останнього запису", "Last AI parse result")}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-indigo-400 transition-transform ${aiCardExpanded ? "rotate-180" : ""}`} />
                      </button>
                      {aiCardExpanded && (
                        <div className="mt-2">
                          <AIResultCard
                            item={displayedItem}
                            onEdit={(item) => setSelectedItem(item)}
                            onForceSync={(id) => handleSyncItem(id)}
                            language={settings.default_language}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. Live transcript */}
                  <LiveTranscript
                    text={liveTranscript}
                    isRecording={liveTranscript.length > 0 || isProcessing}
                    language={settings.default_language}
                  />

                  {/* 4. VoiceRecorder — always fixed at bottom */}
                  <div className="fixed bottom-0 inset-x-0 z-40" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
                    <VoiceRecorder
                      onTranscriptComplete={handleTranscriptComplete}
                      onLiveUpdate={(text) => setLiveTranscript(text)}
                      isProcessing={isProcessing}
                      language={settings.default_language}
                    />
                  </div>

              </div>
            )}

          </div>
        )}

      </div>

    </div>
  );
}
