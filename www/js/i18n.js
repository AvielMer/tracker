// UI language: English, Hebrew (right-to-left), Russian.
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
// Layout direction: 'auto' (mirror for Hebrew), or fixed 'ltr' / 'rtl' so
// the tabs and buttons stay in the same place whatever the language.
let dirPref = 'auto';

export function getLang() { return lang; }
export function getDirPref() { return dirPref; }

// Phone language on first run; afterwards whatever was picked in Settings.
export async function initLang() {
  let saved = null;
  try {
    saved = await storage.getValue('ui_lang');
    dirPref = (await storage.getValue('ui_dir')) || 'auto';
  } catch { /* use defaults */ }
  const phone = (navigator.language || 'en').slice(0, 2).toLowerCase();
  const guess = phone === 'iw' ? 'he' : phone;
  apply(saved || (LANGS.some(([c]) => c === guess) ? guess : 'en'));
}

export async function setLang(code) {
  apply(code);
  await storage.setValue('ui_lang', code);
}

export async function setDirPref(pref) {
  dirPref = ['ltr', 'rtl'].includes(pref) ? pref : 'auto';
  apply(lang);
  await storage.setValue('ui_dir', dirPref);
}

function apply(code) {
  lang = LANGS.some(([c]) => c === code) ? code : 'en';
  const natural = RTL.has(lang) ? 'rtl' : 'ltr';
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

export function t(key, vars = {}) {
  const entry = DICT[key];
  let s = (lang !== 'en' && entry && entry[lang]) || (entry && entry.en) || key;
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
};
