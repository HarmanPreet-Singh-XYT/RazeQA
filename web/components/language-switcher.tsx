"use client";

import React, { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check } from "lucide-react";
import { useTranslation, SUPPORTED_LOCALES, SupportedLocale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, localeInfo } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Change Language"
        className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-2xs"
      >
        <Globe className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-xs">{localeInfo.flag}</span>
        <span className="hidden sm:inline-block">{localeInfo.nativeName}</span>
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-1.5 w-40 origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg ring-1 ring-black/5 z-50 animate-in fade-in-50 zoom-in-95">
          {Object.values(SUPPORTED_LOCALES).map((loc) => {
            const isSelected = loc.code === locale;
            return (
              <button
                key={loc.code}
                onClick={() => {
                  setLocale(loc.code as SupportedLocale);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors ${
                  isSelected
                    ? "bg-indigo-50 font-semibold text-indigo-700"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{loc.flag}</span>
                  <span>{loc.nativeName}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-indigo-600" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
