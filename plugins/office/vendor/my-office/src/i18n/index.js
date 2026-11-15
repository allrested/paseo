// PASEO: stand-in for my-office's i18n/index.js. English only: the office plugin has one language.
// Same calls as upstream: t(key, vars, as), num(n, digits), lang(), locale(). Upstream's lines end
// in emoji; Paseo's labels are text and the speech bubbles have line icons, so a line is given
// without them (a line that is nothing but emoji is kept as it is).
import en from './locales/en/index.js';

export const DEFAULT_LANG = 'en';
const LOCALE = 'en-US';
const plural = new Intl.PluralRules(LOCALE);
const get = (key) => { let o = en; for (const k of key.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; };
const EMOJI = /\s*(?![©®™])\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*/gu;
const plain = (s) => { if (typeof s !== 'string') return s; const out = s.replace(EMOJI, '').trim(); return out === '' ? s : out; };
const fill = (s, vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))) : s);

/** @type {(key: string, vars?: object|null, as?: 'list') => any} */
export const t = (key, vars, as) => {
  let v = get(key);
  if (v === undefined) return as === 'list' ? [] : key;
  if (as === 'list') return (Array.isArray(v) ? v : [v]).map(plain);
  if (typeof v === 'function') return plain(v(vars || {}, t));
  if (Array.isArray(v)) v = v[Math.floor(Math.random() * v.length)];
  else if (v && typeof v === 'object') v = v[plural.select(Number(vars?.n ?? 0))] ?? v.other;
  v = String(v);
  // upstream names the machine it runs on; Paseo's office runs on a host
  if (v.includes('{mac}') || v.includes('{Mac}')) vars = { mac: 'host', Mac: 'Host', ...vars };
  return fill(plain(v), vars);
};
t.lang = DEFAULT_LANG;
t.locale = LOCALE;
export const num = (n, digits = 0) => Number(n || 0).toLocaleString(LOCALE, { maximumFractionDigits: digits });
export const lang = () => DEFAULT_LANG;
export const locale = () => LOCALE;
export const createT = () => t;
