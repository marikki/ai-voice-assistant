import React, { useState, useEffect } from "react";
import { Keyboard, Settings, Calendar, CheckSquare, FileText, Mic, RefreshCw, ArrowLeft, Trash2 } from "lucide-react";
import BottomTabBar, { Tab } from "./components/BottomTabBar";
import RecorderSheet from "./components/RecorderSheet";
import ItemList, { Item, AISchema } from "./components/ItemList";
import IntegrationSettings from "./components/IntegrationSettings";
import DetailView from "./components/DetailView";
import LoginPage from "./components/LoginPage";


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

interface Toast {
  id: number;
  text: string;
  type: "success" | "warning" | "error" | "info";
}

// ── Helpers ────────────────────────────────────────────────────
function isCalendar(item: Item) {
  return item.item_type === "calendar_event" || item.item_type === "reminder";
}
function isTask(item: Item) { return item.item_type === "task"; }
function isNote(item: Item) { return item.item_type === "notion_note"; }

// ── App ────────────────────────────────────────────────────────
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [items, setItems] = useState<Item[]>([]);
  const [settings, setSettings] = useState<SettingsState>({
    google_calendar_connected: true,
    notion_connected: false,
    google_tasks_connected: true,
    notion_database_id: "",
    notion_token: "",
    auto_save_threshold: 0.85,
    default_language: "uk",
    mock_mode: true,
  });

  const [activeTab, setActiveTab] = useState<Tab>("feed");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"voice" | "text">("voice");
  const [toasts, setToasts] = useState<Toast[]>([]);

  // ── Auth + initial load ──────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/auth/check", { credentials: "include" });
        if (!r.ok) { setIsAuthenticated(false); setIsLoading(false); return; }
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false); setIsLoading(false); return;
      }
      try {
        const [ir, sr] = await Promise.all([
          fetch("/api/items", { credentials: "include" }),
          fetch("/api/settings", { credentials: "include" }),
        ]);
        if (ir.ok) setItems(await ir.json());
        if (sr.ok) setSettings(await sr.json());
      } catch { /* non-fatal */ }
      finally { setIsLoading(false); }
    })();
  }, []);

  // ── Toast ────────────────────────────────────────────────────
  const addToast = (text: string, type: Toast["type"] = "success") => {
    const id = Date.now();
    setToasts(p => [...p, { id, text, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  };

  // ── Handlers ─────────────────────────────────────────────────
  const handleItemsSaved = (newItems: Item[]) => {
    setItems(prev => [...newItems, ...prev]);
    const count = newItems.length;
    addToast(count === 1 ? "Збережено ✓" : `Збережено ${count} записів ✓`, "success");
  };

  const handleUpdateItem = async (updated: Item) => {
    try {
      const r = await fetch(`/api/items/${updated.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
        credentials: "include",
      });
      if (r.ok) {
        const saved = await r.json();
        setItems(p => p.map(i => i.id === saved.id ? saved : i));
        if (selectedItem?.id === saved.id) setSelectedItem(saved);
        addToast("Зміни збережені ✓");
      }
    } catch { /* ignore */ }
  };

  const handleSyncItem = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setItems(p => p.map(i => i.id === id ? { ...i, status: "saving" as any } : i));
    try {
      const r = await fetch(`/api/items/${id}/sync`, { method: "POST", credentials: "include" });
      const data = await r.json();
      if (r.ok) {
        setItems(p => p.map(i => i.id === id ? data.item : i));
        if (selectedItem?.id === id) setSelectedItem(data.item);
        addToast("Синхронізовано ✓");
      } else {
        addToast(data.error || "Помилка синхронізації", "error");
      }
    } catch { addToast("Помилка синхронізації", "error"); }
  };

  const handleDeleteItem = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      const r = await fetch(`/api/items/${id}`, { method: "DELETE", credentials: "include" });
      if (r.ok) {
        setItems(p => p.filter(i => i.id !== id));
        if (selectedItem?.id === id) setSelectedItem(null);
      }
    } catch { /* ignore */ }
  };

  const handleSaveSettings = async (s: SettingsState) => {
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
        credentials: "include",
      });
      if (r.ok) { setSettings(await r.json()); addToast("Налаштування збережені ✓"); }
    } catch { /* ignore */ }
  };

  const handleResetDb = async () => {
    try {
      await fetch("/api/items/reset", { method: "POST", credentials: "include" });
      const r = await fetch("/api/items", { credentials: "include" });
      if (r.ok) { setItems(await r.json()); setSelectedItem(null); }
    } catch { /* ignore */ }
  };

  const handleToggleComplete = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const wasCompleted = !!item.ai_parsed_result.completed;
    const updated = {
      ...item,
      ai_parsed_result: { ...item.ai_parsed_result, completed: !wasCompleted },
    };
    setItems(p => p.map(i => i.id === id ? updated : i));
    try {
      await fetch(`/api/items/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updated),
        credentials: "include",
      });
    } catch { /* ignore — optimistic update stays */ }
  };

  // ── Derived lists ────────────────────────────────────────────
  const calendarItems = items.filter(isCalendar);
  const taskItems = items.filter(isTask).sort((a, b) => {
    const aDone = !!a.ai_parsed_result.completed;
    const bDone = !!b.ai_parsed_result.completed;
    return aDone === bDone ? 0 : aDone ? 1 : -1;
  });
  const noteItems = items.filter(isNote);

  // ── Guards ───────────────────────────────────────────────────
  if (isAuthenticated === null) return null;
  if (isAuthenticated === false) return <LoginPage onLogin={() => setIsAuthenticated(true)} />;

  // ── Shared Detail / Settings overlay ────────────────────────
  const renderOverlay = () => {
    if (selectedItem) return (
      <DetailView
        item={selectedItem}
        onBack={() => setSelectedItem(null)}
        onUpdate={handleUpdateItem}
        onDelete={id => { handleDeleteItem(id); setSelectedItem(null); }}
        onSync={handleSyncItem}
        language={settings.default_language}
      />
    );
    if (showSettings) return (
      <div className="flex justify-center">
        <IntegrationSettings
          settings={settings}
          onSave={handleSaveSettings}
          onResetDb={handleResetDb}
          language={settings.default_language}
        />
      </div>
    );
    return null;
  };

  const overlay = renderOverlay();

  // ── Mobile tab content ───────────────────────────────────────
  const renderMobileContent = () => {
    if (isLoading) return (
      <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-400">
        <RefreshCw className="w-7 h-7 animate-spin text-indigo-500" />
        <p className="text-sm font-medium">Завантаження...</p>
      </div>
    );
    switch (activeTab) {
      case "feed":
        return (
          <ItemList
            items={items}
            variant="feed"
            onSelectItem={setSelectedItem}
            onDeleteItem={handleDeleteItem}
            onForceSync={handleSyncItem}
            language={settings.default_language}
          />
        );
      case "calendar":
        return (
          <ItemList
            items={calendarItems}
            variant="calendar"
            onSelectItem={setSelectedItem}
            onDeleteItem={handleDeleteItem}
            onForceSync={handleSyncItem}
            language={settings.default_language}
          />
        );
      case "tasks":
        return (
          <ItemList
            items={taskItems}
            variant="tasks"
            onSelectItem={setSelectedItem}
            onDeleteItem={handleDeleteItem}
            onForceSync={handleSyncItem}
            onToggleComplete={handleToggleComplete}
            language={settings.default_language}
          />
        );
      case "notes":
        return (
          <ItemList
            items={noteItems}
            variant="notes"
            onSelectItem={setSelectedItem}
            onDeleteItem={handleDeleteItem}
            onForceSync={handleSyncItem}
            language={settings.default_language}
          />
        );
    }
  };

  const tabTitles: Record<Tab, string> = {
    feed: "Стрічка",
    calendar: "Календар",
    tasks: "Задачі",
    notes: "Нотатки",
  };
  const tabSubtitles: Record<Tab, string> = {
    feed: "Усе, що ти наговорив",
    calendar: `${calendarItems.length} ${calendarItems.length === 1 ? "запис" : "записів"}`,
    tasks: `${taskItems.length} ${taskItems.length === 1 ? "запис" : "записів"}`,
    notes: `${noteItems.length} ${noteItems.length === 1 ? "запис" : "записів"}`,
  };

  // ── VM Avatar ────────────────────────────────────────────────
  const AvatarBtn = ({ onClick }: { onClick: () => void }) => (
    <button
      onClick={onClick}
      className="w-9 h-9 rounded-full bg-indigo-100 border border-indigo-200 flex items-center justify-center text-xs font-bold text-indigo-700 cursor-pointer"
    >
      VM
    </button>
  );

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-zinc-900" style={{ paddingTop: "env(safe-area-inset-top)" }}>

      {/* ── Toast system ──────────────────────────────────────── */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none max-w-xs">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto px-4 py-3 rounded-2xl shadow-xl text-xs font-semibold animate-fade-in-up ${
              t.type === "success" ? "bg-zinc-900 text-white"
              : t.type === "error"   ? "bg-rose-600 text-white"
              : t.type === "warning" ? "bg-amber-500 text-white"
              : "bg-zinc-800 text-white"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          MOBILE  (< md)
      ══════════════════════════════════════════════════════════ */}
      <div className="md:hidden">
        {overlay ? (
          /* Overlay takes full screen on mobile */
          <div className="min-h-screen bg-[#F5F5F7] pb-6">
            {/* Back header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <button
                onClick={() => { setSelectedItem(null); setShowSettings(false); }}
                className="flex items-center gap-1.5 text-indigo-600 text-sm font-semibold active:opacity-70"
              >
                <ArrowLeft className="w-4 h-4" />
                Назад
              </button>
              {selectedItem && (
                <button
                  onClick={() => { handleDeleteItem(selectedItem.id); setSelectedItem(null); }}
                  className="w-9 h-9 rounded-xl bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:border-rose-200 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="px-4">{overlay}</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <header className="px-5 pt-5 pb-3">
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => { setSelectedItem(null); setShowSettings(false); setActiveTab("feed"); }}
                  className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
                >
                  <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                    <Mic className="w-3.5 h-3.5 text-white" />
                  </div>
                  <span className="font-bold text-sm tracking-tight">
                    VoiceMind <span className="text-indigo-600">AI</span>
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setSheetMode("text"); setSheetOpen(true); }}
                    className="w-9 h-9 rounded-xl bg-white border border-zinc-200 flex items-center justify-center text-zinc-500 cursor-pointer"
                  >
                    <Keyboard className="w-4 h-4" />
                  </button>
                  <AvatarBtn onClick={() => { setSelectedItem(null); setShowSettings(true); }} />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-zinc-900 leading-tight">{tabTitles[activeTab]}</h1>
              <p className="text-sm text-zinc-400 font-medium mt-0.5">{tabSubtitles[activeTab]}</p>
            </header>

            {/* Tab content */}
            <main className="px-4 pb-[88px]">
              {renderMobileContent()}
            </main>

            {/* Bottom tab bar */}
            <BottomTabBar
              activeTab={activeTab}
              onTabChange={tab => { setActiveTab(tab); setSelectedItem(null); setShowSettings(false); }}
              onMicPress={() => { setSheetMode("voice"); setSheetOpen(true); }}
              isRecording={sheetOpen && sheetMode === "voice"}
            />
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════
          DESKTOP  (≥ md)
      ══════════════════════════════════════════════════════════ */}
      <div className="hidden md:block">
        {/* Top navbar */}
        <nav className="flex items-center justify-between px-8 h-16 bg-white border-b border-zinc-100 shadow-xs">
          <button
            onClick={() => { setSelectedItem(null); setShowSettings(false); }}
            className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 bg-indigo-600 rounded-xl flex items-center justify-center">
              <Mic className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight">
              VoiceMind <span className="text-indigo-600">AI</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setSheetMode("text"); setSheetOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 text-zinc-600 text-sm font-medium hover:bg-zinc-200 transition-colors cursor-pointer"
            >
              <Keyboard className="w-4 h-4" /> Текст
            </button>
            <button
              onClick={() => { setSelectedItem(null); setShowSettings(!showSettings); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                showSettings ? "bg-indigo-600 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              <Settings className="w-4 h-4" />
              Налаштування
            </button>
            <AvatarBtn onClick={() => { setSelectedItem(null); setShowSettings(true); }} />
          </div>
        </nav>

        {/* Content */}
        <div className="max-w-7xl mx-auto px-6 pt-6 pb-28">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-3 text-zinc-400">
              <RefreshCw className="w-7 h-7 animate-spin text-indigo-500" />
              <p className="text-sm font-medium">Завантаження...</p>
            </div>
          ) : selectedItem ? (
            <div className="flex flex-col gap-0">
              {/* Desktop detail header */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={() => setSelectedItem(null)}
                  className="flex items-center gap-1.5 text-indigo-600 text-sm font-semibold hover:opacity-70 transition-opacity"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Назад
                </button>
                <button
                  onClick={() => { handleDeleteItem(selectedItem.id); setSelectedItem(null); }}
                  className="w-9 h-9 rounded-xl bg-white border border-zinc-200 flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:border-rose-200 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <DetailView
                item={selectedItem}
                onBack={() => setSelectedItem(null)}
                onUpdate={handleUpdateItem}
                onDelete={id => { handleDeleteItem(id); setSelectedItem(null); }}
                onSync={handleSyncItem}
                language={settings.default_language}
              />
            </div>
          ) : showSettings ? (
            <div className="flex justify-center">
              <IntegrationSettings
                settings={settings}
                onSave={handleSaveSettings}
                onResetDb={handleResetDb}
                language={settings.default_language}
              />
            </div>
          ) : (
            /* 3-column layout — always visible on desktop */
            <div className="grid grid-cols-3 gap-5">

              {/* Column 1 — Календар */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-indigo-600" />
                  </div>
                  <span className="font-bold text-zinc-800">Календар</span>
                  <span className="ml-auto text-xs text-zinc-400 font-mono">{calendarItems.length}</span>
                </div>
                <ItemList
                  items={calendarItems}
                  variant="calendar"
                  onSelectItem={setSelectedItem}
                  onDeleteItem={handleDeleteItem}
                  onForceSync={handleSyncItem}
                  language={settings.default_language}
                />
              </div>

              {/* Column 2 — Задачі */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <CheckSquare className="w-4 h-4 text-indigo-600" />
                  </div>
                  <span className="font-bold text-zinc-800">Задачі</span>
                  <span className="ml-auto text-xs text-zinc-400 font-mono">{taskItems.length}</span>
                </div>
                <ItemList
                  items={taskItems}
                  variant="tasks"
                  onSelectItem={setSelectedItem}
                  onDeleteItem={handleDeleteItem}
                  onForceSync={handleSyncItem}
                  onToggleComplete={handleToggleComplete}
                  language={settings.default_language}
                />
              </div>

              {/* Column 3 — Нотатки */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                    <FileText className="w-4 h-4 text-indigo-600" />
                  </div>
                  <span className="font-bold text-zinc-800">Нотатки</span>
                  <span className="ml-auto text-xs text-zinc-400 font-mono">{noteItems.length}</span>
                </div>
                <ItemList
                  items={noteItems}
                  variant="notes"
                  onSelectItem={setSelectedItem}
                  onDeleteItem={handleDeleteItem}
                  onForceSync={handleSyncItem}
                  language={settings.default_language}
                  singleColumn
                />
              </div>

            </div>
          )}
        </div>

        {/* Desktop FAB */}
        <button
          onClick={() => { setSheetMode("voice"); setSheetOpen(true); }}
          className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-40 w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-all duration-200 active:scale-95 ${
            sheetOpen && sheetMode === "voice" ? "bg-red-500" : "bg-indigo-600 hover:bg-indigo-700"
          }`}
        >
          <Mic className="w-6 h-6 text-white" />
        </button>
      </div>

      {/* ── Recorder Sheet (shared mobile + desktop) ───────────── */}
      <RecorderSheet
        isOpen={sheetOpen}
        initialMode={sheetMode}
        onClose={() => setSheetOpen(false)}
        onItemsSaved={handleItemsSaved}
        language={settings.default_language}
      />

    </div>
  );
}
