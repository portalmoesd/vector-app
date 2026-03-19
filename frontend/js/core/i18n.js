/**
 * Simple i18n system — key-based translations.
 */
const I18n = {
  _locale: 'ka',
  _strings: {},

  async init() {
    const saved = localStorage.getItem('locale');
    if (saved) this._locale = saved;
    await this.load(this._locale);
  },

  async load(locale) {
    try {
      const res = await fetch(`/locales/${locale}.json`);
      this._strings = await res.json();
      this._locale = locale;
      localStorage.setItem('locale', locale);
    } catch (e) {
      console.warn(`Failed to load locale "${locale}", falling back to en`);
      if (locale !== 'en') await this.load('en');
    }
  },

  t(key, params) {
    let str = key.split('.').reduce((obj, k) => obj && obj[k], this._strings);
    if (!str) return key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
      });
    }
    return str;
  },

  getLocale() {
    return this._locale;
  },

  async setLocale(locale) {
    await this.load(locale);
    // Re-render page translations
    document.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = this.t(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = this.t(el.dataset.i18nPlaceholder);
    });
  },
};

function t(key, params) {
  return I18n.t(key, params);
}
