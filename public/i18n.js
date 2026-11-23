// Classic script (no ES modules) so the app also works when opened from file://.
// Translations live in locales/<code>.js and register themselves with GatherI18n.register().
(function () {
const LOCALE_KEY = "gather.locale";
const DEFAULT_LOCALE = "en";
const dictionaries = {};
let current = DEFAULT_LOCALE;
let plural = new Intl.PluralRules(DEFAULT_LOCALE);

function register(code, name, messages) {
  dictionaries[code] = { name, messages };
}

function available() {
  return Object.entries(dictionaries).map(([code, { name }]) => ({ code, name }));
}

function lookup(key) {
  return dictionaries[current]?.messages[key] ?? dictionaries[DEFAULT_LOCALE]?.messages[key];
}

// Looks up `key` (or `key_<plural category>` when params.count is given) and fills {placeholders}.
function t(key, params = {}) {
  let template;
  if (typeof params.count === "number") template = lookup(`${key}_${plural.select(params.count)}`) ?? lookup(`${key}_other`);
  template ??= lookup(key) ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}

// Model errors carry an i18n key and params; anything else falls back to its own message.
function errorMessage(error) {
  if (!error?.i18n) return error?.message ?? String(error);
  const params = { ...error.i18n.params };
  if (params.label) params.label = t(`label.${params.label}`);
  return t(error.i18n.key, params);
}

function apply(root = document) {
  for (const node of root.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of root.querySelectorAll("[data-i18n-attr]")) {
    for (const pair of node.dataset.i18nAttr.split(";")) {
      const [attribute, key] = pair.split(":");
      node.setAttribute(attribute, t(key));
    }
  }
}

function setLocale(code) {
  if (!dictionaries[code]) code = DEFAULT_LOCALE;
  current = code;
  plural = new Intl.PluralRules(code);
  document.documentElement.lang = code;
  try { localStorage.setItem(LOCALE_KEY, code); } catch { /* the choice just will not persist */ }
  apply();
}

function initialLocale() {
  let saved = null;
  try { saved = localStorage.getItem(LOCALE_KEY); } catch { /* ignore */ }
  if (saved && dictionaries[saved]) return saved;
  for (const language of navigator.languages ?? [navigator.language]) {
    const base = String(language).toLowerCase().split("-")[0];
    if (dictionaries[base]) return base;
  }
  return DEFAULT_LOCALE;
}

globalThis.GatherI18n = { register, available, t, errorMessage, apply, setLocale, initialLocale, get locale() { return current; } };
})();
