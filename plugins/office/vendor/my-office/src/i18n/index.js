// PASEO: stand-in for my-office's i18n/index.js. English only: the office plugin has one language.
// Same calls as upstream: t(key, vars, as), num(n, digits), lang(), locale(). Upstream's lines end
// in emoji; Paseo's labels are text and the speech bubbles have line icons, so a line is given
// without them (a line that is nothing but emoji is kept as it is).
import en from './locales/en/index.js';

export const DEFAULT_LANG = 'en';
const LOCALE = 'en-US';
const plural = new Intl.PluralRules(LOCALE);
// Paseo's wording, where upstream's line needs something Paseo does not send (a file's name, a
// prompt, a repository's state) or counts a day when the office counts since it was opened.
const OURS = {
  'people.handOver': 'A new task for you',
  'events.generic.grep': 'the code',
  'events.generic.web': 'the web',
  'events.generic.fail': 'the agent stopped',
  'events.verb.prompt': '{label}',
  'events.verb.grep': 'search {label}',
  'events.verb.web': 'search {label}',
  'events.verb.plan': 'update the to-do list',
  'events.verb.test': 'run {label}',
  'events.verb.testok': 'tests pass',
  'events.verb.testfail': 'tests fail',
  'events.verb.push': 'push the code',
  'events.verb.agent': 'start a subagent',
  'events.bubble.agent': 'Handing off to a subagent',
  // (a context empties by a compaction or by a new conversation, and Paseo does not say which)
  'events.verb.compact': 'tidy the conversation',
  'events.bubble.compact': 'Tidying the conversation',
  'people.shred.go': 'Off to shred the paper',
  'world.dev.lost': { one: '{n} agent left something running', other: '{n} agents left something running' },
  'places.library.today': { one: '{n} read since the office opened', other: '{n} reads since the office opened' },
  'places.window.empty': 'Nobody has searched the web since the office opened.',
  'places.window.today': { one: '{n} web search since the office opened', other: '{n} web searches since the office opened' },
  'places.deploy.sub': 'A commit makes the printer print. A push or a deploy launches the rocket.',
  'places.deploy.today': { one: '{n} deploy since the office opened', other: '{n} deploys since the office opened' },
  'places.live.deployToday': '{n} so far',
};
const get = (key) => { if (key in OURS) return OURS[key]; let o = en; for (const k of key.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; };
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
