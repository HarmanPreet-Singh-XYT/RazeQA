"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export type SupportedLocale = "en" | "es" | "de" | "ja" | "ar";

export interface LocaleInfo {
  code: SupportedLocale;
  name: string;
  nativeName: string;
  direction: "ltr" | "rtl";
  flag: string;
}

export const SUPPORTED_LOCALES: Record<SupportedLocale, LocaleInfo> = {
  en: { code: "en", name: "English", nativeName: "English", direction: "ltr", flag: "🇺🇸" },
  es: { code: "es", name: "Spanish", nativeName: "Español", direction: "ltr", flag: "🇪🇸" },
  de: { code: "de", name: "German", nativeName: "Deutsch", direction: "ltr", flag: "🇩🇪" },
  ja: { code: "ja", name: "Japanese", nativeName: "日本語", direction: "ltr", flag: "🇯🇵" },
  ar: { code: "ar", name: "Arabic", nativeName: "العربية", direction: "rtl", flag: "🇸🇦" },
};

const TRANSLATIONS: Record<SupportedLocale, Record<string, string>> = {
  en: {
    "nav.overview": "Overview",
    "nav.forensics": "PR Forensics",
    "nav.projects": "Projects & Settings",
    "nav.analytics": "Analytics & AI Insights",
    "nav.signout": "Sign out",
    "badge.full_code": "GitHub PR (Full Code Access)",
    "badge.external": "External Site (Zero Code Access)",
    "analytics.title": "Fleet Quality Dimensions & AI Intelligence",
    "analytics.subtitle": "Autonomous calculation of Non-Functional Quality Attributes, regression forecasting, and per-path performance.",
    "analytics.health_index": "Fleet Quality Health Index",
    "analytics.pass_rate": "Pass Rate",
    "analytics.mttd": "Mean Time to Detect (MTTD)",
    "analytics.flakiness": "Flakiness Index",
    "analytics.p95_latency": "p95 Execution Latency",
    "analytics.ask_analyst": "Ask AI QA Analyst",
    "analytics.ask_placeholder": "Ask about checkout regressions, CSP compliance, flaky test timing, or i18n...",
    "analytics.per_path_title": "Per-Path Analysis & Quality Scorecard",
    "analytics.select_path": "Select Path / Route",
    "analytics.dimension.perf": "Performance & Speed",
    "analytics.dimension.usability": "Usability & Learnability",
    "analytics.dimension.i18n": "Internationalization (i18n)",
    "analytics.dimension.security": "Security & Privacy",
    "analytics.dimension.reliability": "Reliability & Uptime",
    "analytics.dimension.seo": "Search Engine Optimization (SEO)",
    "analytics.dimension.maintainability": "Maintainability & Scalability",
    "analytics.dimension.observability": "Observability & Telemetry",
    "job.view_analytics": "View Quality & Path Analytics",
    "remediation.apply": "Apply Synthesized Patch to PR",
    "remediation.advisory": "Server / Edge Advisory",
    "offline.title": "You are currently offline",
    "offline.subtitle": "Connecting to AutoQA network when connection restores.",
    "cookie.title": "Privacy & Data Preferences",
    "cookie.description": "We use essential session tokens and performance telemetry to detect test regressions and ensure security compliance.",
    "cookie.accept": "Accept Essential & Telemetry",
  },
  es: {
    "nav.overview": "Visión General",
    "nav.forensics": "Forense de PR",
    "nav.projects": "Proyectos y Ajustes",
    "nav.analytics": "Analítica e IA",
    "nav.signout": "Cerrar sesión",
    "badge.full_code": "PR GitHub (Acceso Total al Código)",
    "badge.external": "Sitio Externo (Caja Negra)",
    "analytics.title": "Dimensiones de Calidad e Inteligencia IA",
    "analytics.subtitle": "Cálculo autónomo de atributos no funcionales, predicción de regresiones y análisis por ruta.",
    "analytics.health_index": "Índice de Salud de Calidad",
    "analytics.pass_rate": "Tasa de Aprobación",
    "analytics.mttd": "Tiempo Medio de Detección (MTTD)",
    "analytics.flakiness": "Índice de Inestabilidad",
    "analytics.p95_latency": "Latencia p95 de Ejecución",
    "analytics.ask_analyst": "Consultar al Analista de Calidad IA",
    "analytics.ask_placeholder": "Pregunta sobre regresiones de pago, CSP, pruebas inestables o i18n...",
    "analytics.per_path_title": "Análisis por Ruta y Tarjeta de Calidad",
    "analytics.select_path": "Seleccionar Ruta",
    "analytics.dimension.perf": "Rendimiento y Velocidad",
    "analytics.dimension.usability": "Usabilidad y Aprendizaje",
    "analytics.dimension.i18n": "Internacionalización (i18n)",
    "analytics.dimension.security": "Seguridad y Privacidad",
    "analytics.dimension.reliability": "Fiabilidad y Disponibilidad",
    "analytics.dimension.seo": "Optimización SEO",
    "analytics.dimension.maintainability": "Mantenibilidad y Escalabilidad",
    "analytics.dimension.observability": "Observabilidad y Telemetría",
    "job.view_analytics": "Ver Analítica de Calidad y Rutas",
    "remediation.apply": "Aplicar Parche Sintetizado al PR",
    "remediation.advisory": "Aviso para Servidor / Borde",
    "offline.title": "Actualmente estás desconectado",
    "offline.subtitle": "Reconectando con AutoQA cuando se restablezca la red.",
    "cookie.title": "Preferencias de Privacidad y Datos",
    "cookie.description": "Utilizamos cookies de sesión esenciales y telemetría de rendimiento para detectar regresiones.",
    "cookie.accept": "Aceptar Esenciales y Telemetría",
  },
  de: {
    "nav.overview": "Übersicht",
    "nav.forensics": "PR-Forensik",
    "nav.projects": "Projekte & Einstellungen",
    "nav.analytics": "Analytik & KI-Einblicke",
    "nav.signout": "Abmelden",
    "badge.full_code": "GitHub PR (Voller Code-Zugriff)",
    "badge.external": "Externe Website (Black-Box)",
    "analytics.title": "Flottenqualitäts-Dimensionen & KI-Intelligenz",
    "analytics.subtitle": "Autonome Berechnung nicht-funktionaler Qualitätsattribute und Pfad-Analysen.",
    "analytics.health_index": "Qualitäts-Gesundheitsindex",
    "analytics.pass_rate": "Bestehensquote",
    "analytics.mttd": "Mittlere Erkennungszeit (MTTD)",
    "analytics.flakiness": "Flakiness-Index",
    "analytics.p95_latency": "p95 Ausführungslatenz",
    "analytics.ask_analyst": "KI-QA-Analysten befragen",
    "analytics.ask_placeholder": "Fragen Sie zu Checkout-Regressionen, CSP, Flakiness oder i18n...",
    "analytics.per_path_title": "Pfad-Analyse & Qualitäts-Scorecard",
    "analytics.select_path": "Pfad / Route auswählen",
    "analytics.dimension.perf": "Leistung & Geschwindigkeit",
    "analytics.dimension.usability": "Benutzerfreundlichkeit",
    "analytics.dimension.i18n": "Internationalisierung (i18n)",
    "analytics.dimension.security": "Sicherheit & Datenschutz",
    "analytics.dimension.reliability": "Zuverlässigkeit & Betriebszeit",
    "analytics.dimension.seo": "Suchmaschinenoptimierung (SEO)",
    "analytics.dimension.maintainability": "Wartbarkeit & Skalierbarkeit",
    "analytics.dimension.observability": "Beobachtbarkeit & Telemetrie",
    "job.view_analytics": "Qualitäts- & Pfadanalytik anzeigen",
    "remediation.apply": "Synthetisierten Patch auf PR anwenden",
    "remediation.advisory": "Server / Edge Empfehlung",
    "offline.title": "Sie sind derzeit offline",
    "offline.subtitle": "Verbindung zu AutoQA wird bei Wiederherstellung aufgebaut.",
    "cookie.title": "Datenschutz-Präferenzen",
    "cookie.description": "Wir verwenden essentielle Sitzungstoken und Leistungstelemetrie.",
    "cookie.accept": "Akzeptieren",
  },
  ja: {
    "nav.overview": "概要",
    "nav.forensics": "PRフォレンジック",
    "nav.projects": "プロジェクトと設定",
    "nav.analytics": "アナリティクスとAIインサイト",
    "nav.signout": "サインアウト",
    "badge.full_code": "GitHub PR（全コードアクセス）",
    "badge.external": "外部サイト（ブラックボックス）",
    "analytics.title": "品質次元とAIインテリジェンス",
    "analytics.subtitle": "非機能要件、回帰リスク予測、パス単位の自律的評価。",
    "analytics.health_index": "総合品質健全性指数",
    "analytics.pass_rate": "合格率",
    "analytics.mttd": "平均検知時間 (MTTD)",
    "analytics.flakiness": "フレイキー指標",
    "analytics.p95_latency": "p95 実行遅延",
    "analytics.ask_analyst": "AI QAアナリストに質問",
    "analytics.ask_placeholder": "決済フローの回帰、CSP準拠、テストのゆらぎについて質問...",
    "analytics.per_path_title": "パス単位分析と品質スコアカード",
    "analytics.select_path": "ルートを選択",
    "analytics.dimension.perf": "パフォーマンスと速度",
    "analytics.dimension.usability": "ユーザビリティと学習性",
    "analytics.dimension.i18n": "国際化・ローカリゼーション (i18n)",
    "analytics.dimension.security": "セキュリティとプライバシー",
    "analytics.dimension.reliability": "信頼性と可用性",
    "analytics.dimension.seo": "SEO検索最適化",
    "analytics.dimension.maintainability": "保守性とスケーラビリティ",
    "analytics.dimension.observability": "可観測性とテレメトリ",
    "job.view_analytics": "品質とパスの詳細分析を見る",
    "remediation.apply": "生成された修正パッチをPRに適用",
    "remediation.advisory": "サーバー・CDN推奨設定",
    "offline.title": "現在オフラインです",
    "offline.subtitle": "ネットワーク復旧時にAutoQAに再接続します。",
    "cookie.title": "プライバシーとデータ設定",
    "cookie.description": "回帰テストの検出とセキュリティ監査のために必要なトークンを使用します。",
    "cookie.accept": "同意して続行",
  },
  ar: {
    "nav.overview": "نظرة عامة",
    "nav.forensics": "التحقيق الجنائي في PR",
    "nav.projects": "المشاريع والإعدادات",
    "nav.analytics": "التحليلات ورؤى الذكاء الاصطناعي",
    "nav.signout": "تسجيل الخروج",
    "badge.full_code": "طلب سحب GitHub (وصول كامل للشيفرة)",
    "badge.external": "موقع خارجي (فحص الصندوق الأسود)",
    "analytics.title": "أبعاد جودة المنصة وذكاء التحليل",
    "analytics.subtitle": "حساب ذاتي للأبعاد غير الوظيفية، والتنبؤ بالتراجعات البرمجية، وتحليل كل مسار.",
    "analytics.health_index": "مؤشر صحة الجودة العام",
    "analytics.pass_rate": "نسبة النجاح",
    "analytics.mttd": "متوسط وقت الاكتشاف (MTTD)",
    "analytics.flakiness": "مؤشر عدم الاستقرار",
    "analytics.p95_latency": "زمن تأخير p95 للتشغيل",
    "analytics.ask_analyst": "اسأل محلل الجودة بالذكاء الاصطناعي",
    "analytics.ask_placeholder": "اسأل عن تراجعات الدفع، حماية CSP، أو اختبارات RTL...",
    "analytics.per_path_title": "تحليل كل مسار وبطاقة تقييم الجودة",
    "analytics.select_path": "اختر المسار / الصفحة",
    "analytics.dimension.perf": "الأداء والسرعة",
    "analytics.dimension.usability": "سهولة الاستخدام والتعلم",
    "analytics.dimension.i18n": "التدويل والمواءمة المحلية (i18n)",
    "analytics.dimension.security": "الأمان والخصوصية",
    "analytics.dimension.reliability": "الموثوقية وتوافر الخدمة",
    "analytics.dimension.seo": "تحسين محركات البحث (SEO)",
    "analytics.dimension.maintainability": "قابلية الصيانة والتوسع",
    "analytics.dimension.observability": "المراقبة والقياس عن بعد",
    "job.view_analytics": "عرض تحليلات الجودة والمسار",
    "remediation.apply": "تطبيق التصحيح المولد على طلب السحب",
    "remediation.advisory": "توصية الخادم وتوزيع المحتوى",
    "offline.title": "أنت غير متصل بالإنترنت حالياً",
    "offline.subtitle": "سيتم إعادة الاتصال بمنصة AutoQA فور عودة الشبكة.",
    "cookie.title": "تفضيلات الخصوصية والبيانات",
    "cookie.description": "نستخدم ملفات تعريف الارتباط الأساسية لضمان الأمان واكتشاف الأخطاء البرمجية.",
    "cookie.accept": "الموافقة والمتابعة",
  },
};

interface I18nContextType {
  locale: SupportedLocale;
  localeInfo: LocaleInfo;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, fallback?: string) => string;
  formatCurrency: (amount: number, currency?: string) => string;
  formatNumber: (value: number) => string;
  formatRelativeDate: (timestamp: string | number | Date) => string;
}

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  localeInfo: SUPPORTED_LOCALES.en,
  setLocale: () => {},
  t: (key, fallback) => fallback || key,
  formatCurrency: (amt) => `$${amt}`,
  formatNumber: (val) => `${val}`,
  formatRelativeDate: () => "just now",
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>("en");

  useEffect(() => {
    const saved = localStorage.getItem("autoqa_locale") as SupportedLocale | null;
    if (saved && SUPPORTED_LOCALES[saved]) {
      setLocaleState(saved);
      document.documentElement.lang = saved;
      document.documentElement.dir = SUPPORTED_LOCALES[saved].direction;
    }
  }, []);

  const setLocale = (newLocale: SupportedLocale) => {
    setLocaleState(newLocale);
    localStorage.setItem("autoqa_locale", newLocale);
    document.documentElement.lang = newLocale;
    document.documentElement.dir = SUPPORTED_LOCALES[newLocale].direction;
  };

  const t = (key: string, fallback?: string): string => {
    const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
    return dict[key] || TRANSLATIONS.en[key] || fallback || key;
  };

  const formatCurrency = (amount: number, currency: string = "USD"): string => {
    try {
      return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : locale, {
        style: "currency",
        currency,
      }).format(amount);
    } catch {
      return `$${amount.toFixed(2)}`;
    }
  };

  const formatNumber = (value: number): string => {
    try {
      return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : locale).format(value);
    } catch {
      return `${value}`;
    }
  };

  const formatRelativeDate = (timestamp: string | number | Date): string => {
    try {
      const d = new Date(timestamp);
      return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : locale, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(d);
    } catch {
      return String(timestamp);
    }
  };

  return (
    <I18nContext.Provider
      value={{
        locale,
        localeInfo: SUPPORTED_LOCALES[locale],
        setLocale,
        t,
        formatCurrency,
        formatNumber,
        formatRelativeDate,
      }}
    >
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
