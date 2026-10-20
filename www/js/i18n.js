// UI language: English, Hebrew (right-to-left), Russian — plus one more
// language that anyone can add without touching the code: an AI translates
// the app's texts (Settings → Language → Add a language with AI, see ai.js)
// and the translation is kept in the config as "language" (config.js).
//
// t('English text {var}', { var }) returns the text in the current
// language. The English text itself is the key, so code stays readable and
// a missing translation simply shows English instead of breaking.
// Only the app's own words are translated. Names you type (buttons,
// exercises, routines) stay exactly as you wrote them.

import * as storage from './storage.js';

export const LANGS = [['en', 'English'], ['he', 'עברית'], ['ru', 'Русский']];
const RTL = new Set(['he']);

let lang = 'en';
// The language that was picked (or the phone's language on first run).
// Kept even when it's an added language whose texts aren't loaded yet:
// the config (which holds them) loads after this module starts.
let wanted = 'en';
// Layout direction: 'auto' (mirror for Hebrew), or fixed 'ltr' / 'rtl' so
// the tabs and buttons stay in the same place whatever the language.
let dirPref = 'auto';
// The added language: { code, name, dir, texts, skipped } or null.
let pack = null;

export function getLang() { return lang; }
export function getDirPref() { return dirPref; }
export const isBuiltInLang = (code) => LANGS.some(([c]) => c === code);

// The languages to pick from: the built-in ones plus the added one.
export function languages() {
  return pack && !isBuiltInLang(pack.code) ? [...LANGS, [pack.code, pack.name]] : LANGS;
}

// Phone language on first run; afterwards whatever was picked in Settings.
export async function initLang() {
  let saved = null;
  try {
    saved = await storage.getValue('ui_lang');
    dirPref = (await storage.getValue('ui_dir')) || 'auto';
  } catch { /* use defaults */ }
  const phone = (navigator.language || 'en').slice(0, 2).toLowerCase();
  wanted = saved || (phone === 'iw' ? 'he' : phone);
  apply(wanted);
}

export async function setLang(code) {
  wanted = code;
  apply(code);
  await storage.setValue('ui_lang', code);
}

export async function setDirPref(pref) {
  dirPref = ['ltr', 'rtl'].includes(pref) ? pref : 'auto';
  apply(lang);
  await storage.setValue('ui_dir', dirPref);
}

function apply(code) {
  lang = languages().some(([c]) => c === code) ? code : 'en';
  const rtl = pack && lang === pack.code ? pack.dir === 'rtl' : RTL.has(lang);
  const natural = rtl ? 'rtl' : 'ltr';
  const dir = dirPref === 'auto' ? natural : dirPref;
  const root = document.documentElement;
  root.lang = lang;
  root.dir = dir;
  // Layout direction differs from the language's own direction (e.g.
  // Hebrew in a fixed left-to-right layout): let each piece of text pick
  // its own direction from its content, so Hebrew still reads and aligns
  // right-to-left while the layout stays put.
  root.classList.toggle('bidi-plain', dir !== natural);
}

// Called whenever the config (re)loads, with its "language" (or null).
export function setLanguagePack(p) {
  pack = p ? cleanPack(p) : null;
  apply(wanted);
}

export function getPack() { return pack; }

// The English of a text key ('' for exercise names "lib:…"/"cat:…"), or
// null for a key this version of the app doesn't have.
function englishOf(key) {
  if (/^(lib|cat):/.test(key)) return '';
  const e = DICT[key];
  if (!e) return null;
  return typeof e.en === 'string' ? e.en : key;
}
const placeholders = (s) => [...new Set(String(s).match(/\{\w+\}/g) || [])].sort().join();

// An added language comes from outside (an AI, or a file someone shared),
// so its texts are checked before use:
// - a text that lost or changed a {placeholder} stays English (otherwise a
//   number or a name would silently disappear from the screen);
// - < > are dropped and " become “ ” — many texts go into the page as
//   HTML, so a shared language file must never be able to add markup or
//   scripts to the app.
function cleanPack(p) {
  const texts = {};
  let skipped = 0;
  for (const [k, v] of Object.entries(p.texts || {})) {
    const en = englishOf(k);
    if (en == null) continue; // a text from another version of the app
    if (typeof v !== 'string' || !v.trim() || placeholders(en) !== placeholders(v)) { skipped++; continue; }
    texts[k] = v.replace(/[<>]/g, '').replace(/"/g, (q, i, str) => (i === 0 || /[\s(«[{]/.test(str[i - 1]) ? '“' : '”'));
  }
  const name = String(p.name || p.code).replace(/[<>"]/g, '');
  return { code: p.code, name, dir: p.dir === 'rtl' ? 'rtl' : 'ltr', texts, skipped };
}

// An added language as the app will use it (checked as above), e.g. to
// show how complete it is before saving it.
export const checkPack = (p) => cleanPack(p);

// Every app text in English, as { key: English } for an AI to translate.
export function textsToTranslate() {
  const out = {};
  for (const k of Object.keys(DICT)) out[k] = englishOf(k);
  return out;
}

// A text of the added language, e.g. packText('lib:pullups', 'fr').
export function packText(key, code = lang) {
  return pack && code === pack.code ? pack.texts[key] || null : null;
}

export function t(key, vars = {}) {
  const entry = DICT[key];
  let s = (pack && lang === pack.code && pack.texts[key])
    || (lang !== 'en' && entry && entry[lang]) || (entry && entry.en) || key;
  if (typeof s === 'function') s = s(vars);
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

// Dates in the current language ("Fri 16 Oct", "пт, 16 окт.", "יום ו׳, 16 באוק׳").
export function fmtDay(date, withYear) {
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (withYear) opts.year = 'numeric';
  try {
    return new Intl.DateTimeFormat(lang, opts).format(date);
  } catch {
    return date.toDateString();
  }
}

// en only where the English needs a plural; he/ru use "word: n" forms so no
// plural rules are needed.
const DICT = {
  // --- navigation / shell ---
  'Events': { he: 'אירועים', ru: 'События' },
  'Training': { he: 'אימון', ru: 'Тренировка' },
  'Log': { he: 'יומן', ru: 'Журнал' },
  'Settings': { he: 'הגדרות', ru: 'Настройки' },
  'Stats': { he: 'סטטיסטיקה', ru: 'Статистика' },
  '⚠ Config problem — using last good version.': { he: '⚠ בעיה בהגדרות — משתמש בגרסה התקינה האחרונה.', ru: '⚠ Ошибка в конфигурации — используется последняя рабочая версия.' },
  'Details': { he: 'פרטים', ru: 'Подробнее' },
  '▶ {name} in progress — continue': { he: '▶ {name} בתהליך — להמשיך', ru: '▶ {name} идёт — продолжить' },
  'Something went wrong on this screen:': { he: 'משהו השתבש במסך הזה:', ru: 'На этом экране произошла ошибка:' },
  'Shortcut: no event "{id}" in your config': { he: 'קיצור דרך: אין אירוע "{id}" בהגדרות', ru: 'Ярлык: события "{id}" нет в конфигурации' },
  'App updated': { he: 'האפליקציה עודכנה', ru: 'Приложение обновлено' },
  'Reload': { he: 'טען מחדש', ru: 'Перезагрузить' },
  'Could not open storage: {msg}': { he: 'לא ניתן לפתוח את האחסון: {msg}', ru: 'Не удалось открыть хранилище: {msg}' },
  'Try closing and reopening the app.': { he: 'נסה לסגור ולפתוח מחדש את האפליקציה.', ru: 'Попробуйте закрыть и снова открыть приложение.' },
  'Today': { he: 'היום', ru: 'Сегодня' },
  'Yesterday': { he: 'אתמול', ru: 'Вчера' },
  'Language': { he: 'שפה', ru: 'Язык' },
  'Layout': { he: 'פריסה', ru: 'Расположение' },
  'Automatic': { he: 'אוטומטי', ru: 'Авто' },
  'Left → right': { he: 'שמאל ← ימין', ru: 'Слева → направо' },
  'Right → left': { he: 'ימין ← שמאל', ru: 'Справа → налево' },
  'LAYOUT_HINT': { en: 'Automatic mirrors the screen for Hebrew. Pick a fixed direction to keep tabs and buttons in the same place in every language.', he: 'אוטומטי הופך את המסך בעברית. בחר כיוון קבוע כדי שהלשוניות והכפתורים יישארו באותו מקום בכל שפה.', ru: 'Авто отражает экран для иврита. Выберите фиксированное направление, чтобы вкладки и кнопки не меняли место при смене языка.' },

  // --- common buttons ---
  'Undo': { he: 'ביטול', ru: 'Отменить' },
  'Undo all': { he: 'בטל הכל', ru: 'Отменить всё' },
  'Undone': { he: 'בוטל', ru: 'Отменено' },
  'Undo failed: {msg}': { he: 'הביטול נכשל: {msg}', ru: 'Не удалось отменить: {msg}' },
  'Skip': { he: 'דלג', ru: 'Пропустить' },
  'Save': { he: 'שמור', ru: 'Сохранить' },
  'Add': { he: 'הוסף', ru: 'Добавить' },
  'Cancel': { he: 'ביטול', ru: 'Отмена' },
  'Close': { he: 'סגור', ru: 'Закрыть' },
  'Delete': { he: 'מחק', ru: 'Удалить' },
  'Done': { he: 'סיום', ru: 'Готово' },
  'Back': { he: 'חזרה', ru: 'Назад' },
  'Edit': { he: 'עריכה', ru: 'Изменить' },
  'Show': { he: 'הצג', ru: 'Показать' },
  'Hide': { he: 'הסתר', ru: 'Скрыть' },
  'Move up': { he: 'הזז למעלה', ru: 'Вверх' },
  'Move down': { he: 'הזז למטה', ru: 'Вниз' },
  'Remove': { he: 'הסר', ru: 'Убрать' },
  'Other…': { he: 'אחר…', ru: 'Другое…' },
  'optional': { he: 'אופציונלי', ru: 'необязательно' },
  'Failed: {msg}': { he: 'נכשל: {msg}', ru: 'Ошибка: {msg}' },
  'NOT saved: {msg}': { he: 'לא נשמר: {msg}', ru: 'НЕ сохранено: {msg}' },
  'Please type a number': { he: 'נא להקליד מספר', ru: 'Введите число' },
  'Type a name first': { he: 'קודם הקלד שם', ru: 'Сначала введите название' },
  'Name': { he: 'שם', ru: 'Название' },
  'Added "{name}"': { he: '"{name}" נוסף', ru: 'Добавлено: "{name}"' },
  'Saved "{name}"': { he: '"{name}" נשמר', ru: 'Сохранено: "{name}"' },
  'CONFIG_ERRORS_CONFIRM': {
    en: 'Your saved config has errors. Saving here will replace it with the last good version plus this change. Continue?',
    he: 'בהגדרות השמורות יש שגיאות. שמירה כאן תחליף אותן בגרסה התקינה האחרונה בתוספת השינוי הזה. להמשיך?',
    ru: 'В сохранённой конфигурации есть ошибки. Сохранение заменит её последней рабочей версией с этим изменением. Продолжить?',
  },

  // --- events screen ---
  'No events yet. Add some in Settings.': { he: 'אין עדיין אירועים. הוסף בהגדרות.', ru: 'Событий пока нет. Добавьте их в Настройках.' },
  'last {time}': { he: 'אחרון {time}', ru: 'последнее {time}' },
  'Recent': { he: 'אחרונים', ru: 'Недавние' },
  'all →': { he: 'הכל ←', ru: 'все →' },
  'Delete this entry': { he: 'מחק רשומה זו', ru: 'Удалить запись' },
  'Double tap ignored — {label} was logged {secs}s ago': { he: 'לחיצה כפולה נחסמה — {label} נרשם לפני {secs} שנ׳', ru: 'Двойное нажатие проигнорировано — {label} записано {secs} с назад' },
  'Double tap ignored': { he: 'לחיצה כפולה נחסמה', ru: 'Двойное нажатие проигнорировано' },
  '{label} #{n} logged {time}': { he: '{label} #{n} נרשם {time}', ru: '{label} #{n} записано {time}' },
  '{label} #{n} saved': { he: '{label} #{n} נשמר', ru: '{label} #{n} сохранено' },
  'logged {time}': { he: 'נרשם {time}', ru: 'записано {time}' },
  'Details NOT saved: {msg}': { he: 'הפרטים לא נשמרו: {msg}', ru: 'Детали НЕ сохранены: {msg}' },
  'Intensity': { he: 'עוצמה', ru: 'Интенсивность' },
  'Duration (minutes)': { he: 'משך (דקות)', ru: 'Длительность (мин)' },
  'Type': { he: 'סוג', ru: 'Тип' },
  'Amount ({unit})': { he: 'כמות ({unit})', ru: 'Количество ({unit})' },
  'Amount': { he: 'כמות', ru: 'Количество' },
  'How many': { he: 'כמה', ru: 'Сколько' },
  'Note': { he: 'הערה', ru: 'Заметка' },
  'Note (optional)': { he: 'הערה (אופציונלי)', ru: 'Заметка (необязательно)' },
  'Type name:': { he: 'הקלד שם:', ru: 'Введите название:' },
  'Number:': { he: 'מספר:', ru: 'Число:' },
  'reading {n}': { he: 'מדידה {n}', ru: 'измерение {n}' },
  'Resting:': { he: 'מנוחה:', ru: 'Отдых:' },
  'since last reading': { he: 'מאז המדידה האחרונה', ru: 'с последнего измерения' },
  'Upper': { he: 'עליון', ru: 'Верхнее' },
  'Lower': { he: 'תחתון', ru: 'Нижнее' },
  'Pulse': { he: 'דופק', ru: 'Пульс' },
  'Save reading {n}': { he: 'שמור מדידה {n}', ru: 'Сохранить измерение {n}' },
  '{label}: readings saved: {n}': { en: (v) => `${v.label}: ${v.n} reading${v.n > 1 ? 's' : ''} saved`, he: '{label}: נשמרו מדידות: {n}', ru: '{label}: сохранено измерений: {n}' },
  'Type the upper and lower number': { he: 'הקלד את המספר העליון והתחתון', ru: 'Введите верхнее и нижнее значение' },
  '{values} looks unusual. Save anyway?': { he: '{values} נראה חריג. לשמור בכל זאת?', ru: '{values} выглядит необычно. Всё равно сохранить?' },
  'Upper is not bigger than lower — swapped? Save anyway?': { he: 'העליון לא גדול מהתחתון — אולי הפוך? לשמור בכל זאת?', ru: 'Верхнее не больше нижнего — перепутаны? Всё равно сохранить?' },
  'Reading NOT saved: {msg}': { he: 'המדידה לא נשמרה: {msg}', ru: 'Измерение НЕ сохранено: {msg}' },

  // --- log ---
  '▶ {name} — started': { he: '▶ {name} — התחיל', ru: '▶ {name} — начало' },
  '■ {name} — finished': { he: '■ {name} — הסתיים', ru: '■ {name} — конец' },
  'set {n}': { he: 'סט {n}', ru: 'подход {n}' },
  '{n} min': { he: '{n} דק׳', ru: '{n} мин' },
  '{n} reps': { he: '{n} חזרות', ru: '{n} повт.' },
  'intensity {n}': { he: 'עוצמה {n}', ru: 'интенсивность {n}' },
  'Nothing logged yet. Tap a button on the Events screen.': { he: 'עוד לא נרשם כלום. לחץ על כפתור במסך האירועים.', ru: 'Пока ничего не записано. Нажмите кнопку на экране событий.' },
  '{n} events': { en: (v) => `${v.n} event${v.n === 1 ? '' : 's'}`, he: 'אירועים: {n}', ru: 'событий: {n}' },
  'Show older ({n} more)': { he: 'הצג ישנים יותר (עוד {n})', ru: 'Показать старые (ещё {n})' },
  'Blood pressure — upper': { he: 'לחץ דם — עליון', ru: 'Давление — верхнее' },
  'Blood pressure — lower': { he: 'לחץ דם — תחתון', ru: 'Давление — нижнее' },
  'Intensity (1–10)': { he: 'עוצמה (1–10)', ru: 'Интенсивность (1–10)' },
  'Reps': { he: 'חזרות', ru: 'Повторения' },
  'Seconds': { he: 'שניות', ru: 'Секунды' },
  'Weight (kg)': { he: 'משקל (ק״ג)', ru: 'Вес (кг)' },
  '#{n} that day': { he: '#{n} באותו יום', ru: '#{n} за день' },
  'reading {n} of a series': { he: 'מדידה {n} בסדרה', ru: 'измерение {n} в серии' },
  'Date': { he: 'תאריך', ru: 'Дата' },
  'Time': { he: 'שעה', ru: 'Время' },
  'Save changes': { he: 'שמור שינויים', ru: 'Сохранить' },
  '{label}: please type a number': { he: '{label}: נא להקליד מספר', ru: '{label}: введите число' },
  'Intensity goes from 1 to 10': { he: 'העוצמה היא בין 1 ל-10', ru: 'Интенсивность от 1 до 10' },
  'Please fill in a valid date and time': { he: 'נא למלא תאריך ושעה תקינים', ru: 'Укажите правильные дату и время' },
  'That time is in the future': { he: 'הזמן הזה בעתיד', ru: 'Это время в будущем' },
  'Changes saved': { he: 'השינויים נשמרו', ru: 'Изменения сохранены' },
  'NOT deleted: {msg}': { he: 'לא נמחק: {msg}', ru: 'НЕ удалено: {msg}' },
  'Deleted {label} {time}': { he: 'נמחק: {label} {time}', ru: 'Удалено: {label} {time}' },
  'Restored': { he: 'שוחזר', ru: 'Восстановлено' },

  // --- settings ---
  'Your data': { he: 'הנתונים שלך', ru: 'Ваши данные' },
  'Entries saved on this phone: {n} (events: {e}).': { en: (v) => `${v.n} entries saved on this phone (${v.e} events).`, he: 'רשומות שמורות בטלפון: {n} (אירועים: {e}).', ru: 'Записей на этом телефоне: {n} (событий: {e}).' },
  'PROTECTED_YES': { en: '✓ Protected storage: the browser won\'t delete your data to free space.', he: '✓ אחסון מוגן: הדפדפן לא ימחק את הנתונים כדי לפנות מקום.', ru: '✓ Защищённое хранилище: браузер не удалит данные ради места.' },
  'PROTECTED_NO': { en: '⚠ Storage not protected yet. Install the app to the home screen, then tap "Protect".', he: '⚠ האחסון עוד לא מוגן. התקן את האפליקציה במסך הבית ואז לחץ "הגן".', ru: '⚠ Хранилище ещё не защищено. Установите приложение на главный экран и нажмите «Защитить».' },
  'Protect': { he: 'הגן', ru: 'Защитить' },
  'Export CSV': { he: 'ייצוא CSV', ru: 'Экспорт CSV' },
  'Full backup (JSON)': { he: 'גיבוי מלא (JSON)', ru: 'Полная копия (JSON)' },
  'Import / restore backup': { he: 'ייבוא / שחזור גיבוי', ru: 'Импорт / восстановление копии' },
  'Event buttons': { he: 'כפתורי אירועים', ru: 'Кнопки событий' },
  'private': { he: 'פרטי', ru: 'личное' },
  'hidden': { he: 'מוסתר', ru: 'скрыто' },
  '+ Add a button': { he: '+ הוסף כפתור', ru: '+ Добавить кнопку' },
  'EDIT_BUTTON_HINT': { en: '✎ changes a button\'s name, color and what it asks after a tap (type, amount, how many, duration…).', he: '✎ משנה את שם הכפתור, הצבע ומה הוא שואל אחרי לחיצה (סוג, כמות, כמה, משך…).', ru: '✎ меняет название кнопки, цвет и вопросы после нажатия (тип, количество, сколько, длительность…).' },
  'Exercises': { he: 'תרגילים', ru: 'Упражнения' },
  'seconds': { he: 'שניות', ru: 'секунды' },
  'reps': { he: 'חזרות', ru: 'повт.' },
  '+ Add an exercise': { he: '+ הוסף תרגיל', ru: '+ Добавить упражнение' },
  'Routines': { he: 'שגרות', ru: 'Программы' },
  'exercises: {n}': { en: (v) => `${v.n} exercises`, he: 'תרגילים: {n}', ru: 'упражнений: {n}' },
  '+ New routine': { he: '+ שגרה חדשה', ru: '+ Новая программа' },
  'Add missing preset exercises & routines': { he: 'הוסף תרגילים ושגרות מוכנים שחסרים', ru: 'Добавить недостающие готовые упражнения и программы' },
  'Config file': { he: 'קובץ הגדרות', ru: 'Файл конфигурации' },
  '⚠ Config has problems — using the last good version.': { he: '⚠ יש בעיות בהגדרות — משתמש בגרסה התקינה האחרונה.', ru: '⚠ В конфигурации ошибки — используется последняя рабочая версия.' },
  '✓ Config OK.': { he: '✓ ההגדרות תקינות.', ru: '✓ Конфигурация в порядке.' },
  'Events: {a} · Exercises: {b} · Routines: {c}': { he: 'אירועים: {a} · תרגילים: {b} · שגרות: {c}', ru: 'События: {a} · Упражнения: {b} · Программы: {c}' },
  'Export config': { he: 'ייצוא הגדרות', ru: 'Экспорт конфигурации' },
  'Import config': { he: 'ייבוא הגדרות', ru: 'Импорт конфигурации' },
  'Reset config to default': { he: 'איפוס הגדרות לברירת מחדל', ru: 'Сбросить конфигурацию' },
  'Storage protected': { he: 'האחסון מוגן', ru: 'Хранилище защищено' },
  'Browser said no — install the app to the home screen first': { he: 'הדפדפן סירב — התקן קודם את האפליקציה במסך הבית', ru: 'Браузер отказал — сначала установите приложение на главный экран' },
  'Imported new entries: {n}': { en: (v) => `Imported ${v.n} new entries`, he: 'יובאו רשומות חדשות: {n}', ru: 'Импортировано новых записей: {n}' },
  ', already here: {n}': { en: (v) => `, ${v.n} already here`, he: ', כבר קיימות: {n}', ru: ', уже были: {n}' },
  ', unreadable skipped: {n}': { en: (v) => `, ${v.n} unreadable skipped`, he: ', לא קריאות דולגו: {n}', ru: ', нечитаемых пропущено: {n}' },
  'BACKUP_HAS_CONFIG': { en: 'The backup also contains a config (your events, exercises, routines). Replace your current config with it?', he: 'הגיבוי מכיל גם הגדרות (אירועים, תרגילים, שגרות). להחליף את ההגדרות הנוכחיות?', ru: 'В копии есть и конфигурация (события, упражнения, программы). Заменить текущую?' },
  '. Config restored.': { he: '. ההגדרות שוחזרו.', ru: '. Конфигурация восстановлена.' },
  '. Config NOT restored: {msg}': { he: '. ההגדרות לא שוחזרו: {msg}', ru: '. Конфигурация НЕ восстановлена: {msg}' },
  'Import failed: {msg}': { he: 'הייבוא נכשל: {msg}', ru: 'Импорт не удался: {msg}' },
  'Added presets: {n}': { en: (v) => `Added ${v.n} presets`, he: 'נוספו פריטים מוכנים: {n}', ru: 'Добавлено готовых: {n}' },
  'You already have all presets': { he: 'כל הפריטים המוכנים כבר קיימים', ru: 'Все готовые элементы уже есть' },
  'Config imported': { he: 'ההגדרות יובאו', ru: 'Конфигурация импортирована' },
  'Config NOT imported: {msg}': { he: 'ההגדרות לא יובאו: {msg}', ru: 'Конфигурация НЕ импортирована: {msg}' },
  'RESET_CONFIRM': { en: 'Replace your config with the default one? Your log entries are NOT affected, but buttons you added will disappear (export the config first to keep them).', he: 'להחליף את ההגדרות בברירת המחדל? הרשומות ביומן לא ייפגעו, אבל כפתורים שהוספת ייעלמו (ייצא קודם את ההגדרות כדי לשמור אותם).', ru: 'Заменить конфигурацию стандартной? Записи журнала НЕ затронуты, но добавленные кнопки исчезнут (сначала экспортируйте конфигурацию).' },
  'Config reset': { he: 'ההגדרות אופסו', ru: 'Конфигурация сброшена' },
  'Reset failed: {msg}': { he: 'האיפוס נכשל: {msg}', ru: 'Сброс не удался: {msg}' },
  'None yet.': { he: 'אין עדיין.', ru: 'Пока нет.' },

  // --- event button editor ---
  'Add a button': { he: 'הוספת כפתור', ru: 'Новая кнопка' },
  'Edit button': { he: 'עריכת כפתור', ru: 'Изменить кнопку' },
  'Name (saved in the log)': { he: 'שם (נשמר ביומן)', ru: 'Название (сохраняется в журнале)' },
  'e.g. Medicine': { he: 'למשל תרופה', ru: 'например, Лекарство' },
  'Private — show only a short label on screen': { he: 'פרטי — הצג רק תווית קצרה על המסך', ru: 'Личное — показывать на экране только короткую метку' },
  'Label shown on screen (e.g. X)': { he: 'תווית שתוצג על המסך (למשל X)', ru: 'Метка на экране (например, X)' },
  'Color': { he: 'צבע', ru: 'Цвет' },
  'No color': { he: 'בלי צבע', ru: 'Без цвета' },
  'After a tap, ask:': { he: 'אחרי לחיצה, לשאול:', ru: 'После нажатия спросить:' },
  'ASK_choice': { en: 'Type — pick from a list (e.g. which medicine)', he: 'סוג — בחירה מרשימה (למשל איזו תרופה)', ru: 'Тип — выбор из списка (например, какое лекарство)' },
  'ASK_amount': { en: 'Amount — e.g. 400 mg', he: 'כמות — למשל 400 מ״ג', ru: 'Количество — например, 400 мг' },
  'ASK_count': { en: 'How many (1–10) — e.g. several at once', he: 'כמה (1–10) — למשל כמה בבת אחת', ru: 'Сколько (1–10) — например, несколько сразу' },
  'ASK_bp': { en: 'Blood pressure + pulse — a series of readings with a rest timer (combines only with your own numbers and Note)', he: 'לחץ דם + דופק — סדרת מדידות עם טיימר מנוחה (משתלב רק עם מספרים משלך והערה)', ru: 'Давление + пульс — серия измерений с таймером отдыха (сочетается только со своими числами и заметкой)' },
  'SPAN_OPTION': { en: 'Start / finish — first tap starts, next tap finishes (e.g. a water bottle, a package, a project); saves how long it lasted', he: 'התחלה / סיום — לחיצה ראשונה מתחילה, הבאה מסיימת (למשל בקבוק מים, חבילה, פרויקט); שומר כמה זמן זה נמשך', ru: 'Начало / конец — первое нажатие начинает, следующее завершает (например бутылка воды, упаковка, проект); сохраняет длительность' },
  'A start/finish button can\'t ask blood pressure': { he: 'כפתור התחלה/סיום לא יכול לשאול לחץ דם', ru: 'Кнопка начала/конца не может спрашивать давление' },
  'running {d}': { he: 'פעיל {d}', ru: 'идёт {d}' },
  'tap to start': { he: 'לחץ להתחלה', ru: 'нажмите, чтобы начать' },
  '{label} started {time}': { he: '{label} התחיל {time}', ru: '{label}: начало {time}' },
  'started {when}': { he: 'התחיל {when}', ru: 'начало {when}' },
  'Running for': { he: 'פעיל כבר', ru: 'Идёт уже' },
  'Finish now': { he: 'סיים עכשיו', ru: 'Завершить сейчас' },
  '{label} finished after {d}': { he: '{label} הסתיים אחרי {d}', ru: '{label}: завершено через {d}' },
  'lasted {d}': { he: 'נמשך {d}', ru: 'длилось {d}' },
  '{h} h {m} min': { he: '{h} ש׳ {m} דק׳', ru: '{h} ч {m} мин' },
  '{d} d {h} h': { he: '{d} ימים {h} ש׳', ru: '{d} д {h} ч' },
  'ASK_measures': { en: 'Your own numbers — e.g. weight (kg), temperature (°C)', he: 'מספרים משלך — למשל משקל (ק״ג), חום (°C)', ru: 'Свои числа — например вес (кг), температура (°C)' },
  'Name, e.g. Weight': { he: 'שם, למשל משקל', ru: 'Название, например Вес' },
  'Unit, e.g. kg': { he: 'יחידה, למשל ק״ג', ru: 'Ед., напр. кг' },
  '+ Add a number': { he: '+ הוסף מספר', ru: '+ Добавить число' },
  'Type a name for at least one number, e.g. Weight': { he: 'הקלד שם לפחות למספר אחד, למשל משקל', ru: 'Введите название хотя бы одного числа, например Вес' },
  'Blood pressure can only be combined with your own numbers and Note': { he: 'לחץ דם משתלב רק עם מספרים משלך והערה', ru: 'Давление сочетается только со своими числами и заметкой' },
  'ASK_note': { en: 'Note (free text)', he: 'הערה (טקסט חופשי)', ru: 'Заметка (свободный текст)' },
  'CHOICES_HINT': { en: 'Separate with commas. You can also add new ones later with "Other…".', he: 'הפרד בפסיקים. אפשר להוסיף חדשים גם אחר כך עם "אחר…".', ru: 'Через запятую. Новые можно добавить позже через «Другое…».' },
  'Unit, e.g. mg or pills': { he: 'יחידה, למשל מ״ג או כדורים', ru: 'Единица, например мг или таб.' },
  'Quick numbers, e.g. 200, 400, 500': { he: 'מספרים מהירים, למשל 200, 400, 500', ru: 'Быстрые значения, например 200, 400, 500' },
  'AMOUNT_HINT': { en: 'These become one-tap buttons. "Other…" lets you type any number.', he: 'אלה יהפכו לכפתורים בלחיצה אחת. "אחר…" מאפשר להקליד כל מספר.', ru: 'Это кнопки в одно касание. «Другое…» — ввести любое число.' },
  'ONE_QUESTION_HINT': { en: 'If you pick just one question, a single tap on the answer saves it.', he: 'אם בוחרים שאלה אחת בלבד, לחיצה אחת על התשובה שומרת.', ru: 'Если выбран один вопрос, одно нажатие на ответ сохраняет.' },
  'Blood pressure can only be combined with Note': { he: 'לחץ דם משתלב רק עם הערה', ru: 'Давление сочетается только с заметкой' },
  'Type at least one type, e.g. Paracetamol': { he: 'הקלד לפחות סוג אחד, למשל אקמול', ru: 'Введите хотя бы один тип, например Парацетамол' },
  'Type a unit for the amount, e.g. mg': { he: 'הקלד יחידה לכמות, למשל מ״ג', ru: 'Введите единицу, например мг' },
  'Amount numbers must look like: 200, 400': { he: 'מספרי הכמות צריכים להיראות כך: 200, 400', ru: 'Значения должны выглядеть так: 200, 400' },

  // --- training ---
  'last: {day}': { he: 'אחרון: {day}', ru: 'последний раз: {day}' },
  'Free session': { he: 'אימון חופשי', ru: 'Свободная тренировка' },
  'Pick exercises as you go': { he: 'בחר תרגילים תוך כדי', ru: 'Выбирайте упражнения по ходу' },
  'Edit exercises & routines': { he: 'עריכת תרגילים ושגרות', ru: 'Изменить упражнения и программы' },
  'Could not start: {msg}': { he: 'לא ניתן להתחיל: {msg}', ru: 'Не удалось начать: {msg}' },
  'Add an exercise to start.': { he: 'הוסף תרגיל כדי להתחיל.', ru: 'Добавьте упражнение, чтобы начать.' },
  'goal {sets} × {reps}': { he: 'יעד {sets} × {reps}', ru: 'цель {sets} × {reps}' },
  'Today:': { he: 'היום:', ru: 'Сегодня:' },
  'Last time': { he: 'בפעם הקודמת', ru: 'В прошлый раз' },
  'Less': { he: 'פחות', ru: 'Меньше' },
  'More': { he: 'יותר', ru: 'Больше' },
  'Extra weight': { he: 'משקל נוסף', ru: 'Доп. вес' },
  'kg': { he: 'ק״ג', ru: 'кг' },
  'Note for this set (optional)': { he: 'הערה לסט (אופציונלי)', ru: 'Заметка к подходу (необязательно)' },
  'Log set {n}': { he: 'רשום סט {n}', ru: 'Записать подход {n}' },
  'Repeat last': { he: 'חזור על האחרון', ru: 'Повторить' },
  'Undo last set': { he: 'בטל סט אחרון', ru: 'Отменить подход' },
  'started {time}': { he: 'התחיל {time}', ru: 'начало {time}' },
  'Finish': { he: 'סיום', ru: 'Завершить' },
  'Rest': { he: 'מנוחה', ru: 'Отдых' },
  'Since start': { he: 'מאז ההתחלה', ru: 'С начала' },
  '+ Exercise': { he: '+ תרגיל', ru: '+ Упражнение' },
  'How many?': { he: 'כמה?', ru: 'Сколько?' },
  'Set NOT saved: {msg}': { he: 'הסט לא נשמר: {msg}', ru: 'Подход НЕ сохранён: {msg}' },
  '{name} set {n}: {v}': { he: '{name} סט {n}: {v}', ru: '{name}, подход {n}: {v}' },
  '{name} done ✓  Next: {next}': { he: '{name} הושלם ✓  הבא: {next}', ru: '{name} готово ✓  Далее: {next}' },
  'Removed set {n} ({v})': { he: 'סט {n} הוסר ({v})', ru: 'Подход {n} удалён ({v})' },
  'Add an exercise': { he: 'הוספת תרגיל', ru: 'Добавить упражнение' },
  '(in session)': { he: '(באימון)', ru: '(в тренировке)' },
  'No exercises yet. Add some in Settings.': { he: 'אין עדיין תרגילים. הוסף בהגדרות.', ru: 'Упражнений пока нет. Добавьте их в Настройках.' },
  'Sets': { he: 'סטים', ru: 'Подходы' },
  'Total': { he: 'סה״כ', ru: 'Всего' },
  'sec': { he: 'שנ׳', ru: 'с' },
  'No sets logged': { he: 'לא נרשמו סטים', ru: 'Подходов нет' },
  'Discard this empty session?': { he: 'למחוק את האימון הריק?', ru: 'Удалить пустую тренировку?' },
  'Keep training': { he: 'המשך להתאמן', ru: 'Продолжить' },
  'Discard': { he: 'מחק', ru: 'Удалить' },
  'Finish {name}?': { he: 'לסיים {name}?', ru: 'Завершить «{name}»?' },
  'Well done! 💪': { he: 'כל הכבוד! 💪', ru: 'Отлично! 💪' },

  // --- training: Start/Done flow, timers, beeps ---
  'Start set {n}': { he: 'התחל סט {n}', ru: 'Начать подход {n}' },
  'Done — log set {n}': { he: 'סיימתי — רשום סט {n}', ru: 'Готово — записать подход {n}' },
  'Cancel set': { he: 'בטל את הסט', ru: 'Отменить подход' },
  'Log set {n} without timer': { he: 'רשום סט {n} בלי טיימר', ru: 'Записать подход {n} без таймера' },
  'seconds each': { he: 'שניות לכל חלק', ru: 'секунд на часть' },
  'Sound on': { he: 'צליל פועל', ru: 'Звук включён' },
  'Sound off': { he: 'צליל כבוי', ru: 'Звук выключен' },
  'Finish or cancel the current set first': { he: 'קודם סיים או בטל את הסט הנוכחי', ru: 'Сначала завершите или отмените текущий подход' },
  'Rest is over — go!': { he: 'המנוחה נגמרה — קדימה!', ru: 'Отдых окончен — вперёд!' },
  'Rest goal': { he: 'זמן מנוחה', ru: 'Время отдыха' },
  'Off': { he: 'כבוי', ru: 'Выкл.' },
  'Set in progress': { he: 'סט בביצוע', ru: 'Идёт подход' },
  'Get ready': { he: 'היכון', ru: 'Приготовьтесь' },
  'First:': { he: 'ראשון:', ru: 'Первое:' },
  'Next:': { he: 'הבא:', ru: 'Далее:' },
  'Hold': { he: 'החזק', ru: 'Держите' },
  'REST_GOAL_HINT': { en: 'After a set the rest timer runs; when it reaches this time the phone beeps and vibrates. Tap ▶ Start set to stop it.', he: 'אחרי סט רץ טיימר מנוחה; כשהוא מגיע לזמן הזה הטלפון מצפצף ורוטט. לחיצה על ▶ התחל סט עוצרת אותו.', ru: 'После подхода идёт таймер отдыха; когда он дойдёт до этого времени, телефон подаст сигнал. Нажмите ▶ Начать подход, чтобы остановить его.' },
  // --- exercise picker / library ---
  'Search or type a new name…': { he: 'חפש או הקלד שם חדש…', ru: 'Поиск или новое название…' },
  'Your exercises': { he: 'התרגילים שלך', ru: 'Ваши упражнения' },
  'Create "{name}" — counted in:': { he: 'צור "{name}" — נספר ב:', ru: 'Создать «{name}» — считать в:' },
  'Nothing found.': { he: 'לא נמצא כלום.', ru: 'Ничего не найдено.' },
  '+ Add from library': { he: '+ הוסף מהספרייה', ru: '+ Из библиотеки' },
  'Exercise library': { he: 'ספריית תרגילים', ru: 'Библиотека упражнений' },
  'Use {lang} names for built-in items': { he: 'שמות ב{lang} לפריטים המובנים', ru: 'Названия на языке «{lang}» для встроенных пунктов' },
  'TRANSLATE_HINT': { en: 'Renames the starting buttons, exercises and routines to this language. Names you typed yourself are not changed; your history stays linked.', he: 'משנה את שמות הכפתורים, התרגילים והשגרות המובנים לשפה הזו. שמות שהקלדת בעצמך לא משתנים, וההיסטוריה נשארת מקושרת.', ru: 'Переименовывает встроенные кнопки, упражнения и программы на этот язык. Ваши собственные названия не меняются, история остаётся связанной.' },
  'Renamed: {n}': { he: 'שמות ששונו: {n}', ru: 'Переименовано: {n}' },
  'Nothing to rename': { he: 'אין מה לשנות', ru: 'Нечего переименовывать' },
  // --- circuits (several exercises in a row, a beep at every switch) ---
  // Hebrew: a circuit is "סבב" (as in the library), a round is "סיבוב".
  'CIRCUIT_TIP': { en: 'Several timed exercises in a row (e.g. plank 30 s, then leg raises 30 s)? Make a circuit: it runs them without stopping and beeps at every switch.', he: 'כמה תרגילים על זמן ברצף (למשל פלאנק 30 שנ׳ ואז הרמות רגליים 30 שנ׳)? צור סבב: הוא מריץ אותם בלי לעצור ומצפצף בכל החלפה.', ru: 'Несколько упражнений на время подряд (например, планка 30 с, потом подъём ног 30 с)? Создайте круг: он идёт без остановки и подаёт сигнал при каждой смене.' },
  'CIRCUIT_HINT': { en: 'One set runs these exercises in a row without stopping. The phone beeps at every switch and logs the set by itself at the end.', he: 'סט אחד מריץ את התרגילים האלה ברצף בלי לעצור. הטלפון מצפצף בכל החלפה ורושם את הסט לבד בסוף.', ru: 'Один подход проходит эти упражнения подряд без остановки. Телефон подаёт сигнал при каждой смене и сам записывает подход в конце.' },
  '+ New circuit': { he: '+ סבב חדש', ru: '+ Новый круг' },
  '+ New circuit (several exercises in a row)': { he: '+ סבב חדש (כמה תרגילים ברצף)', ru: '+ Новый круг (несколько упражнений подряд)' },
  'New circuit': { he: 'סבב חדש', ru: 'Новый круг' },
  'Edit circuit': { he: 'עריכת סבב', ru: 'Изменить круг' },
  'circuit': { he: 'סבב', ru: 'круг' },
  'e.g. Core circuit': { he: 'למשל סבב בטן', ru: 'например, Круг на пресс' },
  'Exercises in a row — seconds each': { he: 'תרגילים ברצף — שניות לכל תרגיל', ru: 'Упражнения подряд — секунды на каждое' },
  '+ Add an exercise to the circuit': { he: '+ הוסף תרגיל לסבב', ru: '+ Добавить упражнение в круг' },
  'Rounds': { he: 'סיבובים', ru: 'Раунды' },
  'Pause between exercises': { he: 'הפסקה בין תרגילים', ru: 'Пауза между упражнениями' },
  'Total: {t}': { he: 'סה״כ: {t}', ru: 'Всего: {t}' },
  'Add at least one exercise with its seconds': { he: 'הוסף לפחות תרגיל אחד עם השניות שלו', ru: 'Добавьте хотя бы одно упражнение с секундами' },
  'Seconds must be a number from 1 to 3600': { he: 'השניות צריכות להיות מספר מ-1 עד 3600', ru: 'Секунды — число от 1 до 3600' },
  '× {n} rounds': { he: 'סיבובים: {n}', ru: 'раундов: {n}' },
  'pause {t}': { he: 'הפסקה {t}', ru: 'пауза {t}' },
  'Pause': { he: 'הפסקה', ru: 'Пауза' },
  'round {r}/{R}': { he: 'סיבוב {r}/{R}', ru: 'раунд {r}/{R}' },
  'goal {n} sets': { en: (v) => `goal ${v.n} set${v.n === 1 ? '' : 's'}`, he: 'יעד: {n} סטים', ru: 'цель: подходов {n}' },
  // --- blood pressure series ---
  'Continue the series from {time} ({n} readings)': { en: (v) => `Continue the series from ${v.time} (${v.n} reading${v.n === 1 ? '' : 's'})`, he: 'המשך את הסדרה מ-{time} (מדידות: {n})', ru: 'Продолжить серию с {time} (измерений: {n})' },
  'Gray numbers come from the first reading of this series.': { he: 'המספרים האפורים הם מהמדידה הראשונה בסדרה.', ru: 'Серые числа — из первого измерения серии.' },
  'Series': { he: 'סדרה', ru: 'Серия' },
  'Keep as its own series': { he: 'להשאיר כסדרה נפרדת', ru: 'Оставить отдельной серией' },
  'Join the series from {when} ({n} readings)': { en: (v) => `Join the series from ${v.when} (${v.n} reading${v.n === 1 ? '' : 's'})`, he: 'לצרף לסדרה מ-{when} (מדידות: {n})', ru: 'Присоединить к серии с {when} (измерений: {n})' },
  'Joined into one series': { he: 'אוחד לסדרה אחת', ru: 'Объединено в одну серию' },
  // --- log: set times ---
  'set time {t}': { he: 'זמן סט {t}', ru: 'время подхода {t}' },
  'rest {t}': { he: 'מנוחה {t}', ru: 'отдых {t}' },
  'Set time (seconds)': { he: 'זמן הסט (שניות)', ru: 'Время подхода (сек)' },
  'Rest before (seconds)': { he: 'מנוחה לפני (שניות)', ru: 'Отдых перед (сек)' },

  // --- exercise / routine editors ---
  'Edit exercise': { he: 'עריכת תרגיל', ru: 'Изменить упражнение' },
  'e.g. Muscle-ups': { he: 'למשל עליות כוח', ru: 'например, Выходы силой' },
  'Counted in': { he: 'נספר ב', ru: 'Считать в' },
  'Seconds (holds, e.g. plank)': { he: 'שניות (החזקות, למשל פלאנק)', ru: 'Секунды (удержания, например планка)' },
  'Can add extra weight (kg)': { he: 'אפשר להוסיף משקל (ק״ג)', ru: 'Можно добавить вес (кг)' },
  'Start number': { he: 'מספר התחלתי', ru: 'Начальное число' },
  'e.g. 10': { he: 'למשל 10', ru: 'например, 10' },
  'START_HINT': { en: 'Where the +/− starts the very first time. After that it starts from what you did last.', he: 'המספר שבו ה-+/− מתחיל בפעם הראשונה. אחר כך הוא מתחיל ממה שעשית בפעם הקודמת.', ru: 'С какого числа +/− начинается в первый раз. Потом — с того, что вы сделали в прошлый раз.' },
  'Start number must be a number': { he: 'המספר ההתחלתי חייב להיות מספר', ru: 'Начальное значение должно быть числом' },
  'New routine': { he: 'שגרה חדשה', ru: 'Новая программа' },
  'Edit routine': { he: 'עריכת שגרה', ru: 'Изменить программу' },
  'e.g. Monday': { he: 'למשל יום שני', ru: 'например, Понедельник' },
  'ROUTINE_STEPS_LABEL': { en: 'Exercises — goal sets × reps (or seconds), both optional', he: 'תרגילים — יעד סטים × חזרות (או שניות), שניהם אופציונליים', ru: 'Упражнения — цель подходы × повторения (или секунды), необязательно' },
  'No exercises yet — add some below.': { he: 'אין עדיין תרגילים — הוסף למטה.', ru: 'Упражнений пока нет — добавьте ниже.' },
  'sets': { he: 'סטים', ru: 'подх.' },
  '+ Add exercise…': { he: '+ הוסף תרגיל…', ru: '+ Добавить упражнение…' },
  'Add routine': { he: 'הוסף שגרה', ru: 'Добавить программу' },
  'Add at least one exercise': { he: 'הוסף לפחות תרגיל אחד', ru: 'Добавьте хотя бы одно упражнение' },
  'Delete routine "{name}"? Your logged workouts are kept.': { he: 'למחוק את השגרה "{name}"? האימונים שנרשמו יישמרו.', ru: 'Удалить программу «{name}»? Записанные тренировки останутся.' },
  'Routine deleted': { he: 'השגרה נמחקה', ru: 'Программа удалена' },

  // --- backup import errors ---
  'The file is empty': { he: 'הקובץ ריק', ru: 'Файл пустой' },
  'This does not look like a Tracker backup': { he: 'זה לא נראה כמו גיבוי של Tracker', ru: 'Это не похоже на копию Tracker' },
  'No valid entries found ({n} unreadable)': { he: 'לא נמצאו רשומות תקינות ({n} לא קריאות)', ru: 'Нет правильных записей ({n} нечитаемых)' },

  // --- circuits: choosing exercises, "max reps" parts ---
  'Add to the circuit': { he: 'הוספה לסבב', ru: 'Добавить в круг' },
  'CIRCUIT_PICK_HINT': { en: 'Tap the exercises in the order you want them — each tap adds one. Timed ones are first; with a reps exercise you do as many as you can in the time. Tap ✓ Done when finished.', he: 'הקש על התרגילים לפי הסדר שתרצה — כל הקשה מוסיפה אחד. תרגילים על זמן מופיעים ראשונים; בתרגיל חזרות עושים כמה שיותר בזמן הזה. בסוף הקש ✓ סיום.', ru: 'Нажимайте упражнения в нужном порядке — каждое нажатие добавляет одно. Сначала упражнения на время; в упражнении на повторения делайте сколько успеете за это время. В конце нажмите ✓ Готово.' },
  '⏱ Timed exercises': { he: '⏱ תרגילים על זמן', ru: '⏱ Упражнения на время' },
  'Your exercises — as many as you can in the time': { he: 'התרגילים שלך — כמה שיותר בזמן הזה', ru: 'Ваши упражнения — сколько успеете за это время' },
  '(in circuit)': { he: '(בסבב)', ru: '(в круге)' },
  'As many as you can — the app asks how many at the end': { he: 'כמה שיותר — בסוף האפליקציה שואלת כמה עשית', ru: 'Сколько успеете — в конце приложение спросит, сколько' },
  'max reps': { he: 'מקסימום', ru: 'максимум' },
  'As many as you can!': { he: 'כמה שיותר!', ru: 'Сколько успеете!' },
  'How many did you do?': { he: 'כמה עשית?', ru: 'Сколько вы сделали?' },
  'Saved: {list}': { he: 'נשמר: {list}', ru: 'Сохранено: {list}' },

  // --- about ---
  'About': { he: 'אודות', ru: 'О приложении' },
  'About this app': { he: 'אודות האפליקציה', ru: 'О приложении' },
  'Share this app': { he: 'שתף את האפליקציה', ru: 'Поделиться приложением' },
  'Your privacy': { he: 'הפרטיות שלך', ru: 'Ваша приватность' },
  'Install on your phone': { he: 'התקנה בטלפון', ru: 'Установка на телефон' },
  'How to use it': { he: 'איך משתמשים', ru: 'Как пользоваться' },
  'Your language': { he: 'השפה שלך', ru: 'Ваш язык' },
  'Important': { he: 'חשוב', ru: 'Важно' },
  'Free · public code': { he: 'חינם · קוד פומבי', ru: 'Бесплатно · код в открытом доступе' },
  'Version {v}': { he: 'גרסה {v}', ru: 'Версия {v}' },
  'Link copied': { he: 'הקישור הועתק', ru: 'Ссылка скопирована' },
  'Copy this link:': { he: 'העתק את הקישור:', ru: 'Скопируйте ссылку:' },
  'SHARE_TEXT': { en: 'Tracker — a free, private app to keep track of how you are doing (events, training). Your data stays on your phone.', he: 'Tracker — אפליקציה חינמית ופרטית למעקב אחרי איך שאתה מרגיש (אירועים, אימונים). המידע נשאר בטלפון שלך.', ru: 'Tracker — бесплатное приложение, чтобы следить за самочувствием (события, тренировки). Данные остаются на вашем телефоне.' },
  'ABOUT_WHAT': { en: 'A free app to keep track of how you are doing. One tap logs an event — a headache, a panic attack, a medicine, your blood pressure, anything you choose — with the date and time. It also logs your training, with timers. Later you can look back, see patterns, and show them to a doctor or to someone you trust.', he: 'אפליקציה חינמית למעקב אחרי איך שאתה מרגיש. הקשה אחת רושמת אירוע — כאב ראש, התקף חרדה, תרופה, לחץ דם, כל דבר שתבחר — עם התאריך והשעה. היא רושמת גם אימונים, עם טיימרים. אחר כך אפשר להסתכל אחורה, לראות דפוסים ולהראות אותם לרופא או למישהו שאתה סומך עליו.', ru: 'Бесплатное приложение, чтобы следить за своим самочувствием. Одно нажатие записывает событие — головную боль, паническую атаку, лекарство, давление, что угодно — с датой и временем. Оно записывает и тренировки, с таймерами. Потом можно посмотреть назад, увидеть закономерности и показать их врачу или человеку, которому вы доверяете.' },
  'ABOUT_PRIVACY': { en: 'Everything you log stays on this phone. There is no account, no ads, and nothing is sent anywhere. A button can be private: the screen shows only a short label (e.g. "X"), and the real name appears only in the log and in exports.', he: 'כל מה שאתה רושם נשאר בטלפון הזה. אין חשבון, אין פרסומות, ושום דבר לא נשלח לשום מקום. כפתור יכול להיות פרטי: על המסך מופיעה רק תווית קצרה (למשל "X"), והשם האמיתי מופיע רק ביומן ובקבצי הייצוא.', ru: 'Всё, что вы записываете, остаётся на этом телефоне. Нет аккаунта, нет рекламы, ничего никуда не отправляется. Кнопка может быть личной: на экране видна только короткая метка (например, «X»), а настоящее название — только в журнале и при экспорте.' },
  'ABOUT_BACKUP': { en: 'Make a backup now and then: Settings → Full backup (JSON). If the browser data is cleared or the phone is lost, the data is gone. A backup can be restored on any phone.', he: 'כדאי לגבות מדי פעם: הגדרות ← גיבוי מלא (JSON). אם נתוני הדפדפן נמחקים או שהטלפון אובד, המידע אובד. אפשר לשחזר גיבוי בכל טלפון.', ru: 'Время от времени делайте резервную копию: Настройки → Полная копия (JSON). Если данные браузера удалятся или телефон потеряется, записи пропадут. Копию можно восстановить на любом телефоне.' },
  'ABOUT_INSTALL': { en: 'Open the link in Chrome and tap ⋮ (the menu) → "Add to Home screen" or "Install app". It then opens like a normal app and works without internet. Long-press its icon for quick shortcuts.', he: 'פתח את הקישור ב-Chrome והקש ⋮ (התפריט) ← "הוספה למסך הבית" או "התקנת אפליקציה". מעכשיו היא נפתחת כמו אפליקציה רגילה ועובדת גם בלי אינטרנט. לחיצה ארוכה על הסמל פותחת קיצורי דרך.', ru: 'Откройте ссылку в Chrome и нажмите ⋮ (меню) → «Добавить на главный экран» или «Установить приложение». Тогда оно открывается как обычное приложение и работает без интернета. Долгое нажатие на значок открывает быстрые действия.' },
  'ABOUT_EVENTS': { en: 'a tap on a button logs it with the time. The questions after it (how strong, how long…) are optional, and Undo is right there.', he: 'הקשה על כפתור רושמת אותו עם השעה. השאלות שאחריה (כמה חזק, כמה זמן…) לא חובה, וכפתור ביטול זמין מיד.', ru: 'нажатие на кнопку записывает событие со временем. Вопросы после него (насколько сильно, как долго…) необязательны, а «Отменить» всегда под рукой.' },
  'ABOUT_TRAINING': { en: 'pick a routine or a free session. ▶ Start set and ✓ Done time each set and your rest; a circuit runs several exercises in a row with a beep at every switch.', he: 'בחר שגרה או אימון חופשי. ▶ התחל סט ו-✓ סיימתי מודדים כל סט ואת המנוחה; סבב מריץ כמה תרגילים ברצף עם צפצוף בכל החלפה.', ru: 'выберите программу или свободную тренировку. ▶ Начать подход и ✓ Готово засекают каждый подход и отдых; круг идёт без остановки с сигналом при каждой смене.' },
  'ABOUT_LOG': { en: 'everything you logged, newest first. Tap an entry to fix its time or numbers, or to delete it.', he: 'כל מה שרשמת, החדש ביותר למעלה. הקשה על רשומה מאפשרת לתקן שעה או מספרים, או למחוק.', ru: 'всё, что вы записали, новое сверху. Нажмите на запись, чтобы исправить время или числа или удалить её.' },
  'ABOUT_SETTINGS': { en: 'your buttons, exercises and routines, the language, and exports: CSV for a spreadsheet (or for an AI to look for patterns) and a full backup.', he: 'הכפתורים, התרגילים והשגרות שלך, השפה, וייצוא: CSV לגיליון אלקטרוני (או ל-AI שיחפש דפוסים) וגיבוי מלא.', ru: 'ваши кнопки, упражнения и программы, язык и экспорт: CSV для таблицы (или для ИИ, чтобы найти закономерности) и полная копия.' },
  'ABOUT_LANGUAGE': { en: 'The app speaks English, Hebrew and Russian. For any other language: Settings → Add a language with AI. An AI chat (Claude, ChatGPT, Gemini…) translates the whole app in a few minutes, and the translation can be shared with others as a file.', he: 'האפליקציה מדברת אנגלית, עברית ורוסית. לכל שפה אחרת: הגדרות ← הוספת שפה בעזרת AI. צ׳אט AI (\u2068Claude, ChatGPT, Gemini…\u2069) מתרגם את כל האפליקציה בכמה דקות, ואפשר לשתף את התרגום עם אחרים כקובץ.', ru: 'Приложение говорит на английском, иврите и русском. Для любого другого языка: Настройки → Добавить язык с помощью ИИ. ИИ-чат (Claude, ChatGPT, Gemini…) переведёт всё приложение за несколько минут, а перевод можно передать другим файлом.' },
  'ABOUT_MEDICAL': { en: 'This app does not give medical advice and does not replace a doctor or a mental-health professional. If you are in danger, or thinking about hurting yourself, call your local emergency number or someone you trust right now. In Israel: ERAN emotional first aid 1201 (24/7), Magen David Adom 101.', he: 'האפליקציה לא נותנת ייעוץ רפואי ולא מחליפה רופא או איש מקצוע בתחום בריאות הנפש. אם אתה בסכנה או חושב לפגוע בעצמך, התקשר עכשיו למספר החירום או למישהו שאתה סומך עליו. בישראל: ער״ן — עזרה ראשונה נפשית 1201 (24/7), מד״א 101.', ru: 'Приложение не даёт медицинских советов и не заменяет врача или специалиста по психическому здоровью. Если вы в опасности или думаете навредить себе, прямо сейчас позвоните в экстренную службу или человеку, которому доверяете. В Израиле: ЭРАН, эмоциональная первая помощь 1201 (круглосуточно), Маген Давид Адом 101.' },
  'ABOUT_SOURCE': { en: 'The app is free, and its code is public on GitHub, so anyone can check exactly what it does.', he: 'האפליקציה חינמית, והקוד שלה פומבי ב-GitHub, כך שכל אחד יכול לבדוק בדיוק מה היא עושה.', ru: 'Приложение бесплатное, а его код открыт для просмотра на GitHub, так что любой может проверить, что именно оно делает.' },

  // --- changing the setup / translating the app with an AI (ai.js) ---
  'Change with AI': { he: 'שינויים בעזרת AI', ru: 'Изменить с помощью ИИ' },
  'AI_SECTION_HINT': { en: 'Describe what you want in your own words. An AI chat (Claude, ChatGPT, Gemini…) writes it for you, and the app checks it and shows what changes before saving.', he: 'תאר במילים שלך מה אתה רוצה. צ׳אט AI (\u2068Claude, ChatGPT, Gemini…\u2069) יכתוב את זה בשבילך, והאפליקציה תבדוק ותראה מה ישתנה לפני השמירה.', ru: 'Опишите своими словами, что нужно. ИИ-чат (Claude, ChatGPT, Gemini…) напишет это за вас, а приложение проверит и покажет изменения перед сохранением.' },
  'Change buttons, exercises or routines with AI': { he: 'שינוי כפתורים, תרגילים או שגרות בעזרת AI', ru: 'Изменить кнопки, упражнения или программы с ИИ' },
  'Translate the app into another language with AI': { he: 'תרגום האפליקציה לשפה אחרת בעזרת AI', ru: 'Перевести приложение на другой язык с ИИ' },
  'Change the setup with AI': { he: 'שינוי ההגדרות בעזרת AI', ru: 'Изменить настройки с помощью ИИ' },
  'AI_SETUP_HINT': { en: 'Say in your own words what to change — e.g. "add a button for nightmares that asks how strong", "make a routine for Monday", "translate my buttons into Arabic" — and an AI writes the new setup for you.', he: 'כתוב במילים שלך מה לשנות — למשל "הוסף כפתור לסיוטים שישאל כמה חזק", "צור שגרה ליום שני", "תרגם את הכפתורים שלי לערבית" — וה-AI יכתוב בשבילך את ההגדרות החדשות.', ru: 'Напишите своими словами, что изменить — например, «добавь кнопку для кошмаров с вопросом о силе», «сделай программу на понедельник», «переведи мои кнопки на арабский» — и ИИ напишет новые настройки.' },
  'Copy the prompt (it has your current setup in it).': { he: 'העתק את הפרומפט (ההגדרות הנוכחיות שלך בתוכו).', ru: 'Скопируйте запрос (в нём ваши текущие настройки).' },
  'Paste it into an AI chat (Claude, ChatGPT, Gemini…) and write what you want, in any language.': { he: 'הדבק אותו בצ׳אט AI (\u2068Claude, ChatGPT, Gemini…\u2069) וכתוב מה אתה רוצה, בכל שפה.', ru: 'Вставьте его в чат с ИИ (Claude, ChatGPT, Gemini…) и напишите, что нужно, на любом языке.' },
  "Copy the AI's whole answer and paste it below.": { he: 'העתק את כל התשובה של ה-AI והדבק אותה למטה.', ru: 'Скопируйте весь ответ ИИ и вставьте ниже.' },
  'AI_PRIVACY': { en: 'Private buttons are not in the prompt (the AI never sees them) and stay as they are. Your log is never sent anywhere.', he: 'כפתורים פרטיים לא נכללים בפרומפט (ה-AI לא רואה אותם) ונשארים כמו שהם. היומן שלך אף פעם לא נשלח.', ru: 'Личные кнопки в запрос не попадают (ИИ их не видит) и остаются как есть. Ваш журнал никуда не отправляется.' },
  'Add a language with AI': { he: 'הוספת שפה בעזרת AI', ru: 'Добавить язык с помощью ИИ' },
  'AI_TRANSLATE_HINT': { en: 'An AI chat can translate this whole app into any language in a few minutes. You can then share the translation with others as a file.', he: 'צ׳אט AI יכול לתרגם את כל האפליקציה לכל שפה בכמה דקות. אחר כך אפשר לשתף את התרגום עם אחרים כקובץ.', ru: 'ИИ-чат может перевести всё приложение на любой язык за несколько минут. Потом перевод можно передать другим файлом.' },
  'Copy the prompt.': { he: 'העתק את הפרומפט.', ru: 'Скопируйте запрос.' },
  'Paste it into an AI chat (Claude, ChatGPT, Gemini…) and write the language at the end, e.g. French.': { he: 'הדבק אותו בצ׳אט AI (\u2068Claude, ChatGPT, Gemini…\u2069) וכתוב בסוף את השפה, למשל צרפתית.', ru: 'Вставьте его в чат с ИИ (Claude, ChatGPT, Gemini…) и в конце напишите язык, например французский.' },
  'Copy the prompt': { he: 'העתק את הפרומפט', ru: 'Скопировать запрос' },
  'Share to an AI app…': { he: 'שליחה לאפליקציית AI…', ru: 'Отправить в приложение ИИ…' },
  'Copied — now paste it into the AI': { he: 'הועתק — עכשיו הדבק ב-AI', ru: 'Скопировано — теперь вставьте в ИИ' },
  'Copy the text in the box (select all → copy)': { he: 'העתק את הטקסט שבתיבה (בחר הכל ← העתק)', ru: 'Скопируйте текст из поля (выделить всё → копировать)' },
  "The AI's answer": { he: 'התשובה של ה-AI', ru: 'Ответ ИИ' },
  "Paste the AI's whole answer here": { he: 'הדבק כאן את כל התשובה של ה-AI', ru: 'Вставьте сюда весь ответ ИИ' },
  'Check the answer': { he: 'בדוק את התשובה', ru: 'Проверить ответ' },
  'ANSWER_NOT_FOUND': { en: "No setup or language found in the answer. Copy the AI's whole answer and paste it here.", he: 'לא נמצאו בתשובה הגדרות או שפה. העתק את כל התשובה של ה-AI והדבק אותה כאן.', ru: 'В ответе не найдено ни настроек, ни языка. Скопируйте весь ответ ИИ и вставьте сюда.' },
  'The answer has problems — nothing was changed:': { he: 'יש בעיות בתשובה — שום דבר לא שונה:', ru: 'В ответе есть ошибки — ничего не изменено:' },
  'Copy the problems for the AI': { he: 'העתק את הבעיות בשביל ה-AI', ru: 'Скопировать ошибки для ИИ' },
  'The answer was cut off — the complete texts are used, the rest stays in English.': { he: 'התשובה נקטעה — הטקסטים השלמים נשמרים, והשאר נשאר באנגלית.', ru: 'Ответ оборвался — полные тексты используются, остальное останется на английском.' },
  'Saving will change:': { he: 'השמירה תשנה:', ru: 'Сохранение изменит:' },
  'new:': { he: 'חדש:', ru: 'новое:' },
  'changed:': { he: 'שונה:', ru: 'изменено:' },
  'removed:': { he: 'הוסר:', ru: 'удалено:' },
  'their history stays in the log': { he: 'ההיסטוריה שלהם נשארת ביומן', ru: 'их история останется в журнале' },
  'new order': { he: 'סדר חדש', ru: 'новый порядок' },
  '{n} texts translated': { en: (v) => `${v.n} text${v.n === 1 ? '' : 's'} translated`, he: 'טקסטים מתורגמים: {n}', ru: 'переведено текстов: {n}' },
  '{n} still in English': { he: 'עדיין באנגלית: {n}', ru: 'ещё на английском: {n}' },
  '{n} left out (a {…} part was changed)': { he: 'הושמטו: {n} (חלק {…} שונה)', ru: 'пропущено: {n} (изменена часть {…})' },
  'Nothing would change.': { he: 'שום דבר לא ישתנה.', ru: 'Ничего не изменится.' },
  'Saved': { he: 'נשמר', ru: 'Сохранено' },
  'Removed': { he: 'הוסר', ru: 'Удалено' },
  'Copy a prompt for the missing texts': { he: 'העתק פרומפט לטקסטים החסרים', ru: 'Скопировать запрос для недостающих текстов' },
  'Save as a file to share': { he: 'שמור כקובץ לשיתוף', ru: 'Сохранить файлом, чтобы поделиться' },
  'Remove {name}': { he: 'הסר את {name}', ru: 'Удалить {name}' },
  'Remove {name}? You can add it again any time.': { he: 'להסיר את {name}? אפשר להוסיף שוב בכל זמן.', ru: 'Удалить {name}? Его можно снова добавить в любой момент.' },
  'Open a language file': { he: 'פתח קובץ שפה', ru: 'Открыть файл языка' },
};
