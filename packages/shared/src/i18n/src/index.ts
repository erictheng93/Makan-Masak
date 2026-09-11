/**
 * MakanMasak Shared i18n System
 * Type-safe, multi-app internationalization
 */

import { computed, ref, type ComputedRef, type Ref } from "vue";
import {
  createI18n as createVueI18n,
  type I18n,
  type I18nOptions,
} from "vue-i18n";
import type { LocaleInfo, SupportedLocale } from "./types";
import { LocaleManager } from "./locale-manager";

// Import locale configurations
export * from "./types";
export { LocaleManager } from "./locale-manager";

type LocaleMessages = Record<string, unknown>;
type MessageParams = Record<string, string | number>;
type RuntimeMessages = Record<string, unknown>;

export interface AppLocaleConfig<Locale extends string = string> {
  code: Locale;
  name: string;
  nativeName: string;
  flag: string;
  dateFormat?: string;
  timeFormat?: string;
  dateTimeFormat?: string;
}

export interface AppI18nOptions<
  Locale extends string,
  Messages extends RuntimeMessages,
> {
  defaultLocale: Locale;
  fallbackLocale?: Locale;
  supportedLocales: AppLocaleConfig<Locale>[];
  initialMessages: Partial<Record<Locale, Messages>>;
  loadMessages: (locale: Locale) => Promise<Messages>;
  storageKey?: string;
  legacyStorageKeys?: string[];
  storage?: Pick<Storage, "getItem" | "setItem">;
  getBrowserLocale?: () => string | undefined;
  setDocumentLocale?: (locale: Locale) => void;
}

export interface AppI18nRuntime<
  Locale extends string,
  Messages extends RuntimeMessages,
> {
  SUPPORTED_LOCALES: AppLocaleConfig<Locale>[];
  currentLocale: Ref<Locale>;
  messages: Ref<Record<Locale, Messages>>;
  getCurrentLocaleConfig(): AppLocaleConfig<Locale>;
  isLocaleLoaded(locale: Locale): boolean;
  setLocaleMessages(locale: Locale, newMessages: Messages): void;
  t(key: string, params?: MessageParams, locale?: Locale): string;
  setLocale(locale: Locale): void;
  loadLocaleMessages(locale: Locale): Promise<void>;
  initI18n(): Promise<void>;
  useI18n(): {
    locale: ComputedRef<Locale>;
    localeConfig: ComputedRef<AppLocaleConfig<Locale>>;
    t: AppI18nRuntime<Locale, Messages>["t"];
    setLocale: AppI18nRuntime<Locale, Messages>["setLocale"];
    switchLocale: (newLocale: Locale) => Promise<void>;
    supportedLocales: AppLocaleConfig<Locale>[];
  };
}

/**
 * Dynamic message loader for lazy loading
 */
export class MessageLoader {
  private static cache = new Map<string, LocaleMessages>();

  /**
   * Load messages for specific app and locale
   */
  static async loadMessages(
    app: "admin" | "customer" | "kitchen",
    locale: SupportedLocale,
  ): Promise<LocaleMessages> {
    const cacheKey = `${app}-${locale}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const [common, specific] = await Promise.all([
        import(`./locales/${locale}/common.json`),
        import(`./locales/${locale}/${app}.json`),
      ]);

      const messages = {
        ...common.default,
        ...specific.default,
      };

      this.cache.set(cacheKey, messages);
      return messages;
    } catch (error) {
      console.error(`Failed to load messages for ${app}-${locale}:`, error);

      // Fallback to English
      if (locale !== "en-US") {
        return this.loadMessages(app, "en-US");
      }

      throw error;
    }
  }

  /**
   * Preload messages for better UX
   */
  static async preloadMessages(
    app: "admin" | "customer" | "kitchen",
    locales: SupportedLocale[] = ["en-US", "zh-TW"],
  ): Promise<void> {
    const promises = locales.map((locale) => this.loadMessages(app, locale));
    await Promise.allSettled(promises);
  }
}

export function createI18n<
  Locale extends string,
  Messages extends RuntimeMessages = RuntimeMessages,
>(options: AppI18nOptions<Locale, Messages>): AppI18nRuntime<Locale, Messages> {
  const fallbackLocale = options.fallbackLocale ?? options.defaultLocale;
  const storageKey = options.storageKey ?? "makanmakan_locale";
  const legacyStorageKeys = options.legacyStorageKeys ?? ["locale"];
  const supportedLocales = options.supportedLocales;
  const currentLocale = ref(options.defaultLocale) as Ref<Locale>;
  const messages = ref<Record<Locale, Messages>>(
    buildInitialMessages(options),
  ) as Ref<Record<Locale, Messages>>;
  const loadedLocales = new Set<Locale>(
    Object.entries(options.initialMessages)
      .filter(([, value]) => value && Object.keys(value).length > 0)
      .map(([locale]) => locale as Locale),
  );

  const isSupportedLocale = (locale: string): locale is Locale =>
    supportedLocales.some((candidate) => candidate.code === locale);

  const runtime: AppI18nRuntime<Locale, Messages> = {
    SUPPORTED_LOCALES: supportedLocales,
    currentLocale,
    messages,

    getCurrentLocaleConfig() {
      return (
        supportedLocales.find(
          (locale) => locale.code === currentLocale.value,
        ) || supportedLocales[0]
      );
    },

    isLocaleLoaded(locale: Locale) {
      return loadedLocales.has(locale);
    },

    setLocaleMessages(locale: Locale, newMessages: Messages) {
      messages.value[locale] = deepMergeMessages(
        messages.value[locale],
        newMessages,
      ) as Messages;
      loadedLocales.add(locale);
    },

    t(key: string, params?: MessageParams, locale?: Locale): string {
      const targetLocale = locale ?? currentLocale.value;
      let value = getNestedValue(messages.value[targetLocale], key);

      if (typeof value !== "string" && targetLocale !== fallbackLocale) {
        value = getNestedValue(messages.value[fallbackLocale], key);
      }

      if (typeof value !== "string") {
        console.warn(`Translation key not found: ${key}`);
        return key;
      }

      if (!params) return value;

      return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
        return params[paramKey]?.toString() || match;
      });
    },

    setLocale(locale: Locale) {
      if (!isSupportedLocale(locale)) {
        console.error(`Unsupported locale: ${locale}`);
        return;
      }

      currentLocale.value = locale;
      safeSetStorageValue(getStorage(options.storage), storageKey, locale);
      options.setDocumentLocale?.(locale);
    },

    async loadLocaleMessages(locale: Locale) {
      if (loadedLocales.has(locale)) return;

      const loadedMessages = await options.loadMessages(locale);
      runtime.setLocaleMessages(locale, loadedMessages);
    },

    async initI18n() {
      const targetLocale = resolveInitialLocale({
        defaultLocale: options.defaultLocale,
        storageKey,
        legacyStorageKeys,
        storage: options.storage,
        getBrowserLocale: options.getBrowserLocale,
        isSupportedLocale,
      });

      if (!loadedLocales.has(targetLocale)) {
        await runtime.loadLocaleMessages(targetLocale);
      }

      runtime.setLocale(targetLocale);
    },

    useI18n() {
      const locale = computed(() => currentLocale.value);
      const localeConfig = computed(() => runtime.getCurrentLocaleConfig());

      const switchLocale = async (newLocale: Locale) => {
        if (!runtime.isLocaleLoaded(newLocale)) {
          await runtime.loadLocaleMessages(newLocale);
        }
        runtime.setLocale(newLocale);
      };

      return {
        locale,
        localeConfig,
        t: runtime.t,
        setLocale: runtime.setLocale,
        switchLocale,
        supportedLocales,
      };
    },
  };

  return runtime;
}

/**
 * Create type-safe i18n instance for specific app
 */
export function createAppI18n<
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  // Kept for call-site compatibility (see this package's README) but not read:
  // messages are loaded per app afterwards, not chosen here. Underscored so the
  // apps that now typecheck this source under noUnusedParameters stay green.
  _app: "admin" | "customer" | "kitchen",
  options: Partial<I18nOptions> = {},
): I18n<T, {}, {}, string, boolean> {
  const locale = LocaleManager.getStoredLocale();

  return createVueI18n({
    legacy: false,
    locale,
    fallbackLocale: "en-US",
    messages: {} as NonNullable<I18nOptions["messages"]>, // Will be loaded dynamically
    silentTranslationWarn: false,
    silentFallbackWarn: false,
    ...options,
  }) as I18n<T, {}, {}, string, boolean>;
}

/**
 * Vue composable for i18n with app-specific types
 */
export function createI18nComposable(i18nInstance: I18n) {
  return {
    /**
     * Switch locale with persistence
     */
    async switchLocale(
      locale: SupportedLocale,
      app: "admin" | "customer" | "kitchen",
    ) {
      try {
        // Load messages if not already loaded
        const messages = await MessageLoader.loadMessages(app, locale);

        // Update i18n instance
        i18nInstance.global.setLocaleMessage(locale, messages);
        if (typeof i18nInstance.global.locale === "string") {
          // For legacy mode
          (i18nInstance.global as { locale: SupportedLocale }).locale = locale;
        } else {
          // For composition mode
          i18nInstance.global.locale.value = locale;
        }

        // Persist the change
        LocaleManager.setLocale(locale);

        return true;
      } catch (error) {
        console.error("Failed to switch locale:", error);
        return false;
      }
    },

    /**
     * Get current locale info
     */
    getCurrentLocaleInfo(): LocaleInfo {
      const currentLocale = (
        typeof i18nInstance.global.locale === "string"
          ? i18nInstance.global.locale
          : i18nInstance.global.locale.value
      ) as SupportedLocale;
      return LocaleManager.getLocaleInfo(currentLocale);
    },

    /**
     * Get available locales for UI
     */
    getAvailableLocales: LocaleManager.getAvailableLocales,
  };
}

/**
 * Anti-pattern prevention: Enforce i18n usage
 * This utility helps catch hardcoded strings in development
 */
export function createTranslationValidator() {
  if (process.env.NODE_ENV === "development") {
    // In development, we can add debugging helpers
    const originalConsoleWarn = console.warn;
    console.warn = (...args) => {
      const message = args.join(" ");
      if (message.includes("translation") && message.includes("not found")) {
        console.trace("Missing translation detected:", message);
      }
      originalConsoleWarn.apply(console, args);
    };
  }
}

const UNSAFE_MESSAGE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function buildInitialMessages<
  Locale extends string,
  Messages extends RuntimeMessages,
>(options: AppI18nOptions<Locale, Messages>): Record<Locale, Messages> {
  return options.supportedLocales.reduce(
    (acc, locale) => {
      acc[locale.code] =
        options.initialMessages[locale.code] ?? ({} as Messages);
      return acc;
    },
    {} as Record<Locale, Messages>,
  );
}

function getStorage(storage?: Pick<Storage, "getItem" | "setItem">) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch (error) {
    console.error("Failed to access locale storage:", error);
    return null;
  }
}

function getBrowserLocale(
  getBrowserLocale?: () => string | undefined,
): string | undefined {
  if (getBrowserLocale) return getBrowserLocale();
  if (typeof navigator === "undefined") return undefined;
  return navigator.language || navigator.languages?.[0];
}

function resolveInitialLocale<Locale extends string>(input: {
  defaultLocale: Locale;
  storageKey: string;
  legacyStorageKeys: string[];
  storage?: Pick<Storage, "getItem" | "setItem">;
  getBrowserLocale?: () => string | undefined;
  isSupportedLocale: (locale: string) => locale is Locale;
}): Locale {
  const storage = getStorage(input.storage);
  const stored =
    safeGetStorageValue(storage, input.storageKey) ??
    input.legacyStorageKeys
      .map((key) => safeGetStorageValue(storage, key))
      .find((value): value is string => Boolean(value));

  if (stored && input.isSupportedLocale(stored)) return stored;

  const browserLocale = getBrowserLocale(input.getBrowserLocale);
  if (!browserLocale) return input.defaultLocale;
  if (input.isSupportedLocale(browserLocale)) return browserLocale;

  const language = browserLocale.split("-")[0];
  const locale = {
    zh: browserLocale.includes("CN") ? "zh-CN" : "zh-TW",
    en: "en-US",
    ja: "ja-JP",
    vi: "vi-VN",
    ms: "ms-MY",
    id: "id-ID",
  }[language];

  return locale && input.isSupportedLocale(locale)
    ? locale
    : input.defaultLocale;
}

function safeGetStorageValue(
  storage: Pick<Storage, "getItem"> | null,
  key: string,
): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch (error) {
    console.error("Failed to read locale from storage:", error);
    return null;
  }
}

function safeSetStorageValue(
  storage: Pick<Storage, "setItem"> | null,
  key: string,
  value: string,
): void {
  try {
    storage?.setItem(key, value);
  } catch (error) {
    console.error("Failed to save locale to storage:", error);
  }
}

function isPlainMessageObject(value: unknown): value is RuntimeMessages {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function deepMergeMessages(
  target: RuntimeMessages = {},
  source: RuntimeMessages = {},
): RuntimeMessages {
  const result = { ...target };

  Object.keys(source).forEach((key) => {
    if (UNSAFE_MESSAGE_KEYS.has(key)) return;

    if (
      isPlainMessageObject(source[key]) &&
      Object.prototype.hasOwnProperty.call(target, key) &&
      isPlainMessageObject(target[key])
    ) {
      result[key] = deepMergeMessages(
        target[key] as RuntimeMessages,
        source[key] as RuntimeMessages,
      );
    } else {
      result[key] = source[key];
    }
  });

  return result;
}

function getNestedValue(source: RuntimeMessages, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") {
      return (value as RuntimeMessages)[part];
    }
    return undefined;
  }, source);
}

// Default export for convenience
export default {
  LocaleManager,
  MessageLoader,
  createI18n,
  createAppI18n,
  createI18nComposable,
  createTranslationValidator,
};
