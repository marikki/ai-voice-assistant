import React, { useState, useEffect } from "react";
import { Sliders, Calendar, FileText, CheckSquare, ShieldCheck, Globe, Save, ExternalLink, LogOut, AlertCircle, CheckCircle } from "lucide-react";

interface Settings {
  google_calendar_connected: boolean;
  notion_connected: boolean;
  google_tasks_connected: boolean;
  notion_database_id: string;
  notion_token: string;
  auto_save_threshold: number;
  default_language: "ru" | "en" | "uk";
  mock_mode: boolean;
}

interface GoogleStatus {
  connected: boolean;
  calendar: boolean;
  tasks: boolean;
  email?: string;
}

interface IntegrationSettingsProps {
  settings: Settings;
  onSave: (updated: Settings) => void;
  onResetDb: () => void;
  language: "ru" | "en" | "uk";
}

export default function IntegrationSettings({ settings, onSave, onResetDb, language }: IntegrationSettingsProps) {
  const isRu = language === "ru";
  const isUk = language === "uk";
  const t = (ru: string, uk: string, en: string) => isRu ? ru : isUk ? uk : en;

  const [notionDbId, setNotionDbId] = useState(settings.notion_database_id);
  const [notionToken, setNotionToken] = useState(settings.notion_token);
  const [threshold, setThreshold] = useState(settings.auto_save_threshold);
  const [lang, setLang] = useState(settings.default_language);
  const [isSavedNotify, setIsSavedNotify] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const [googleStatus, setGoogleStatus] = useState<GoogleStatus>({ connected: false, calendar: false, tasks: false });
  const [oauthBanner, setOauthBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Check URL params for OAuth redirect result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gAuth = params.get("googleAuth");
    if (gAuth === "connected") {
      setOauthBanner({ type: "success", message: t("Google успешно подключён", "Google успішно підключено", "Google connected successfully") });
      window.history.replaceState({}, "", window.location.pathname);
    } else if (gAuth && gAuth.startsWith("error:")) {
      const msg = decodeURIComponent(gAuth.slice(6));
      setOauthBanner({ type: "error", message: msg });
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Fetch real Google connection status
  useEffect(() => {
    fetch("/api/auth/google/status")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setGoogleStatus(data); })
      .catch(() => {});
  }, []);

  const handleDisconnectGoogle = async () => {
    setIsDisconnecting(true);
    try {
      const res = await fetch("/api/auth/google/disconnect", { method: "POST" });
      if (res.ok) {
        setGoogleStatus({ connected: false, calendar: false, tasks: false });
        setOauthBanner({ type: "success", message: t("Google отключён", "Google відключено", "Google disconnected") });
      }
    } catch {
      setOauthBanner({ type: "error", message: t("Ошибка при отключении", "Помилка при відключенні", "Disconnect failed") });
    }
    setIsDisconnecting(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const notionConnected = !!(notionToken && notionDbId);
    onSave({
      google_calendar_connected: googleStatus.calendar,
      notion_connected: notionConnected,
      google_tasks_connected: googleStatus.tasks,
      notion_database_id: notionDbId,
      notion_token: notionToken,
      auto_save_threshold: threshold,
      default_language: lang,
      mock_mode: settings.mock_mode,
    });
    setIsSavedNotify(true);
    setTimeout(() => setIsSavedNotify(false), 3000);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-3xl bg-white rounded-3xl border border-zinc-100 p-6 sm:p-8 shadow-sm flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-100 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-zinc-50 border border-zinc-100 rounded-xl flex items-center justify-center">
            <Sliders className="w-4.5 h-4.5 text-zinc-700" />
          </div>
          <div>
            <h3 className="text-base font-bold text-zinc-900">
              {t("Настройки интеграций и AI", "Налаштування інтеграцій та AI", "Integrations & AI Settings")}
            </h3>
            <p className="text-xs text-zinc-400">
              {t("Управление подключением сервисов и параметрами классификации", "Управління підключенням сервісів та параметрами класифікації", "Manage active service accounts and classification metadata")}
            </p>
          </div>
        </div>
      </div>

      {/* OAuth banner */}
      {oauthBanner && (
        <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium ${
          oauthBanner.type === "success"
            ? "bg-emerald-50 border border-emerald-200 text-emerald-800"
            : "bg-rose-50 border border-rose-200 text-rose-800"
        }`}>
          {oauthBanner.type === "success"
            ? <CheckCircle className="w-4 h-4 shrink-0" />
            : <AlertCircle className="w-4 h-4 shrink-0" />}
          {oauthBanner.message}
          <button type="button" onClick={() => setOauthBanner(null)} className="ml-auto text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      <div className="flex flex-col gap-6">

        {/* 1. Google integration */}
        <div>
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">
            {t("1. Google — Календарь и задачи", "1. Google — Календар і задачі", "1. Google — Calendar & Tasks")}
          </h4>

          <div className={`p-5 border rounded-2xl transition-all flex flex-col gap-4 ${
            googleStatus.connected ? "border-blue-100 bg-blue-50/20" : "border-zinc-200 bg-white"
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-white border border-zinc-100 shadow-sm flex items-center justify-center">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                </div>
                <div>
                  <h5 className="text-sm font-bold text-zinc-800">Google</h5>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {googleStatus.connected
                      ? (googleStatus.email || "marikkish@gmail.com")
                      : t("Не подключён", "Не підключено", "Not connected")}
                  </p>
                </div>
              </div>

              {googleStatus.connected ? (
                <button
                  type="button"
                  onClick={handleDisconnectGoogle}
                  disabled={isDisconnecting}
                  className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 uppercase tracking-wider cursor-pointer transition-colors disabled:opacity-50"
                >
                  <LogOut className="w-3 h-3" />
                  {isDisconnecting ? "..." : t("Отключить", "Відключити", "Disconnect")}
                </button>
              ) : (
                <a
                  href="/api/auth/google/connect"
                  className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white uppercase tracking-wider transition-colors"
                >
                  <ExternalLink className="w-3 h-3" />
                  {t("Подключить", "Підключити", "Connect")}
                </a>
              )}
            </div>

            {/* Scope indicators */}
            <div className="flex gap-3">
              <div className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg ${
                googleStatus.calendar ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-500"
              }`}>
                <Calendar className="w-3 h-3" />
                {t("Календарь", "Календар", "Calendar")}
                {googleStatus.calendar && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 ml-1"></span>}
              </div>
              <div className={`flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-lg ${
                googleStatus.tasks ? "bg-indigo-100 text-indigo-700" : "bg-zinc-100 text-zinc-500"
              }`}>
                <CheckSquare className="w-3 h-3" />
                {t("Задачи", "Завдання", "Tasks")}
                {googleStatus.tasks && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 ml-1"></span>}
              </div>
            </div>

            {!googleStatus.connected && (
              <p className="text-[10px] text-zinc-400 leading-snug">
                {t("Авторизация через Google OAuth. Запрашиваем доступ к Google Calendar и Google Tasks.", "Авторизація через Google OAuth. Запитуємо доступ до Google Calendar та Google Tasks.", "Authorize via Google OAuth to grant access to Google Calendar and Google Tasks.")}
              </p>
            )}
          </div>
        </div>

        {/* 2. Notion integration */}
        <div>
          <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-3">
            {t("2. Notion — Заметки и база знаний", "2. Notion — Нотатки і база знань", "2. Notion — Notes & Knowledge Base")}
          </h4>

          <div className={`p-5 border rounded-2xl flex flex-col gap-4 ${
            settings.notion_connected ? "border-zinc-300 bg-zinc-50/40" : "border-zinc-200 bg-white"
          }`}>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-zinc-100 border border-zinc-200 flex items-center justify-center">
                <FileText className="w-4 h-4 text-zinc-700" />
              </div>
              <div>
                <h5 className="text-sm font-bold text-zinc-800">Notion Workspace</h5>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  {settings.notion_connected
                    ? t("Интеграция активна", "Інтеграція активна", "Integration active")
                    : t("Нужен API-токен", "Потрібен API-токен", "API token required")}
                </p>
              </div>
              {settings.notion_connected && (
                <span className="ml-auto text-[10px] font-bold px-2 py-1 rounded-lg bg-zinc-800 text-white uppercase tracking-wider">
                  {t("Активен", "Активний", "Active")}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  Notion API Token
                </label>
                <input
                  type="password"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 font-mono"
                  placeholder="secret_notion_..."
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1.5">
                  Database ID / URL
                </label>
                <input
                  type="text"
                  value={notionDbId}
                  onChange={(e) => setNotionDbId(e.target.value)}
                  className="w-full bg-white border border-zinc-200 rounded-xl px-3.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-500 font-mono"
                  placeholder="notion_notes_db_..."
                />
              </div>
            </div>
            <p className="text-[10px] text-zinc-400 leading-snug">
              {t("Создай интеграцию на notion.so/my-integrations, скопируй токен и открой доступ к нужным страницам через «Share».", "Створи інтеграцію на notion.so/my-integrations, скопіюй токен та відкрий доступ до потрібних сторінок через «Share».", "Create an integration at notion.so/my-integrations, copy the token, and share your target pages/databases with the integration.")}
            </p>
          </div>
        </div>

        {/* 3. AI Threshold & Language */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          <div className="border border-zinc-200 rounded-2xl p-4 sm:p-5 flex flex-col gap-3">
            <div className="flex justify-between items-center bg-zinc-50/65 border-b border-zinc-100 pb-2 mb-1">
              <h5 className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                {t("Порог автосохранения AI", "Поріг автозбереження AI", "AI Confidence Threshold")}
              </h5>
              <span className="text-xs font-mono font-bold text-indigo-700">
                {(threshold * 100).toFixed(0)}%
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-normal">
              {t("Если уровень уверенности AI равен или выше порога, задача автосохраняется без ручного клика.", "Якщо рівень впевненості AI дорівнює або перевищує поріг, завдання зберігається автоматично.", "Tasks with model confidence at or above this threshold sync automatically without manual review.")}
            </p>
            <input
              type="range"
              min="0.50"
              max="0.95"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-full h-1.5 bg-zinc-150 rounded-lg appearance-none cursor-pointer accent-indigo-600 mt-2"
            />
            <div className="flex justify-between text-[9px] text-zinc-400 font-bold font-mono">
              <span>50% ({t("Широкий", "Широкий", "Permissive")})</span>
              <span>85% ({t("Оптимум", "Оптимум", "Default")})</span>
              <span>95% ({t("Строгий", "Суворий", "Strict")})</span>
            </div>
          </div>

          <div className="border border-zinc-200 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 justify-between">
            <div>
              <h5 className="text-xs font-bold text-zinc-700 flex items-center gap-1.5 bg-zinc-50/65 border-b border-zinc-100 pb-2 mb-2">
                <Globe className="w-4 h-4 text-blue-600" />
                {t("Основной язык распознавания", "Основна мова розпізнавання", "Core Recognizer Locale")}
              </h5>
              <p className="text-[11px] text-zinc-500 leading-normal mb-4">
                {t("Язык по умолчанию для транскрибирования речи и структурирования вывода AI.", "Мова за замовчуванням для транскрибування мови та структурування виводу AI.", "Language for speech transcription and AI output structuring.")}
              </p>
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                  <input type="radio" name="default_language" value="ru" checked={lang === "ru"} onChange={() => setLang("ru")} className="w-3.5 h-3.5 accent-indigo-600" />
                  🇷🇺 Русский
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                  <input type="radio" name="default_language" value="uk" checked={lang === "uk"} onChange={() => setLang("uk")} className="w-3.5 h-3.5 accent-indigo-600" />
                  🇺🇦 Українська
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 cursor-pointer">
                  <input type="radio" name="default_language" value="en" checked={lang === "en"} onChange={() => setLang("en")} className="w-3.5 h-3.5 accent-indigo-600" />
                  🇺🇸 English
                </label>
              </div>
            </div>
          </div>

        </div>

        {/* 4. Reset */}
        <div className="border border-rose-100 bg-rose-50/10 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="max-w-md">
            <h5 className="text-xs font-bold text-rose-800 mb-1">
              {t("Сброс баз данных", "Скидання бази даних", "Database Reset")}
            </h5>
            <p className="text-[11px] text-rose-700/75 leading-relaxed">
              {t("Удалить все созданные voice-элементы и восстановить дефолтные записи.", "Видалити всі створені voice-елементи та відновити початкові записи.", "Clear all saved voice records and re-seed with default demo entries.")}
            </p>
          </div>
          <button
            type="button"
            onClick={onResetDb}
            className="px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 rounded-xl text-xs font-bold shrink-0 cursor-pointer transition-colors"
          >
            {t("Сбросить данные", "Скинути дані", "Purge Data")}
          </button>
        </div>

      </div>

      {/* Save button */}
      <div className="flex items-center justify-end gap-3 border-t border-zinc-150 pt-5 mt-3">
        {isSavedNotify && (
          <span className="text-xs font-medium text-emerald-600 animate-pulse">
            {t("✓ Настройки сохранены!", "✓ Налаштування збережено!", "✓ Settings saved!")}
          </span>
        )}
        <button
          type="submit"
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs px-6 py-2.5 rounded-xl cursor-pointer shadow-sm hover:shadow-indigo-100 transition-all flex items-center gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          {t("Сохранить настройки", "Зберегти налаштування", "Save Settings")}
        </button>
      </div>

    </form>
  );
}
