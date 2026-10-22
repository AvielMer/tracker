# Tracker

A free, private app to keep track of how you are doing. One tap logs an
event (a headache, a panic attack, a medicine, your blood pressure,
anything you choose) with the date and time. It also logs your training,
with timers. Later you can look back, see patterns, and show them to a
doctor or to someone you trust.

**Open the app: https://avielmer.github.io/tracker/**

It's made to share: with soldiers, and with anyone who wants to keep track
of their wellbeing. There's no account and no ads, and it costs nothing.

[בעברית](#בעברית) · [По-русски](#по-русски)

## Your privacy

- **Everything you log stays on your phone**, in the app's own storage.
  There is no account and no server, and nothing is sent anywhere.
- **Private buttons:** the screen shows only a short label (for example
  "X"). The real name appears only in the log and in exports.
- **Make a backup now and then:** Settings → Backup & export → Full
  backup (JSON). If the
  browser's data is cleared or the phone is lost, the data is gone. A
  backup can be restored on any phone.
- The AI helper (below) never sends anything by itself. You copy a prompt
  and paste it where you choose. Private buttons and your log are never in
  the prompt.

## Install it on your phone

1. Open https://avielmer.github.io/tracker/ in **Chrome** (Android).
2. Tap **⋮** (the menu), then **Add to Home screen** or **Install app**.
3. It now opens like a normal app and **works without internet**.
   Long-press its icon for shortcuts ("Log headache", "Start training").

On an iPhone: open the link in Safari → Share → **Add to Home Screen**.

## First time

The first time you open the app, it asks what you want to keep track of.
Pick a few (how you feel, headaches, medicine, blood pressure…). Each one
becomes a big button. You can add your own buttons any time with **+ Add a
button** at the end of the Events screen, and change anything in Settings.

## What it does

- **How I feel:** one tap on a face (😫 😟 😐 🙂 😄), any time, plus a
  "How was my day" check-in with an evening reminder.
- **Events:** big one-tap buttons showing today's count and the time of
  the last one. Short optional questions after a tap: how strong (1–10),
  how long, which medicine and how much, how many at once, blood pressure
  and pulse (several readings in a row), your own number fields (for
  example weight), and a note. Start/finish buttons cover things that last
  (a bottle of water, a project). There's Undo, and accidental double taps
  are ignored.
- **Your own lists to tap:** a button can ask its own lists of answers,
  each with a small emoji if you like (for example "🩸 Light, 🩸🩸 Heavy"),
  one answer or several at once.
- **Period and cycle:** a Period button (tap when it starts, tap again when
  it ends) and a **Period diary** in the style of period apps: tap what
  fits today (flow, symptoms, feelings, energy, cervical mucus, ovulation
  and pregnancy tests, breast self-exam, intercourse) and add weight,
  temperature and a note. A strip of the last 7 days lets you fill in a
  day you missed.
- **Daily goals:** for example 8 glasses of water: the button shows 3/8
  and a bar that fills up.
- **Training:** pick a routine or a free session.
  - ▶ Start set and ✓ Done time each set and your rest, with a beep when
    the rest is over.
  - Timed holds count down by themselves.
  - **Circuits** run several exercises in a row without stopping, with a
    beep at every switch, rounds and pauses. In a circuit, a reps exercise
    means "as many as you can in the time", and the app asks how many at
    the end.
  - A library of about 100 street-workout exercises comes built in.
- **Reminders:** any button or routine can remind you at set times and
  days (for example every evening at 21:00). In this web version a
  reminder shows as a card at the top of the Events screen when you open
  the app. Phone notifications that pop up while the app is closed will
  come with the Android app version.
- **Log:** everything you logged, newest first. Tap an entry to fix its
  time or numbers, or to delete it.
- **Stats:** charts of what you logged, for 7 days up to a year: blood
  pressure (upper/lower and pulse), weight and your own numbers, mood, how
  often each button was used, which answers you picked most, and your
  training. Each button gets the
  charts that fit what it records; tap a chart to read its numbers, or
  switch a card to a table.
- **Export:** CSV for a spreadsheet (or for an AI to look for patterns),
  plus a full backup that you can restore.
- **Languages:** English, Hebrew (right-to-left) and Russian, plus any
  other language with the help of an AI (below).
- **Themes:** Dark, or **Girl**: light and pink, with soft watercolours and
  flowers. Settings → Theme.

## Change it with AI, no coding needed

In the app, go to **Settings → Change with AI**.

- **Change buttons, exercises or routines:**
  1. Tap "Copy the prompt".
  2. Paste it into an AI chat (Claude, ChatGPT, Gemini…).
  3. Write what you want in your own words, in any language. For example:
     "add a button for nightmares that asks how strong" or "make a routine
     for Monday".
  4. Copy the AI's whole answer, paste it back into the app and tap "Check
     the answer". The app checks it and shows what will change before
     saving, and you can Undo.
- **Translate the app into another language:**
  1. Tap "Copy the prompt".
  2. Paste it into an AI chat and write the language.
  3. Paste the answer back into the app.

  If the answer was too long and got cut off, "Copy a prompt for the
  missing texts" gets the rest. To share a translation, tap "Save as a
  file to share". Others then use "Open a language file".

## The setup file (for advanced users)

All buttons, exercises and routines come from one JSON file. Find it under
Settings → Setup file → Export / Import. A broken file never breaks the
app: it keeps the last good setup and shows what's wrong. The starting
setup is [`www/default_config.json`](www/default_config.json), and the
full format is described in [`CLAUDE.md`](CLAUDE.md).

```json
{
  "events": [
    { "id": "headache", "name": "Headache", "ask": ["intensity"] },
    { "id": "medicine", "name": "Medicine", "ask": ["choice", "amount"],
      "choices": ["Paracetamol", "Ibuprofen"],
      "amount": { "unit": "mg", "values": [200, 400] } },
    { "id": "x1", "name": "My private item", "displayLabel": "X", "private": true }
  ],
  "exercises": [
    { "id": "pullups", "name": "Pull-ups", "type": "reps" },
    { "id": "plank", "name": "Plank", "type": "seconds" }
  ],
  "routines": [
    { "id": "upper", "name": "Upper body", "exercises": ["pullups", "plank"] }
  ]
}
```

## Important

This app does not give medical advice. It does not replace a doctor or a
mental-health professional. If you are in danger, or thinking about
hurting yourself, call your local emergency number or someone you trust
right now. **In Israel:** ERAN emotional first aid **1201** (24/7), Magen
David Adom **101**.

## For developers

- The app is plain HTML, CSS and JavaScript (ES modules), with no build
  step. The `www/` folder is the whole app. To run it locally:
  `cd www && python3 -m http.server`.
- All storage goes through `www/js/storage.js`. The web version uses
  IndexedDB. A Capacitor Android build (planned) will keep the files in
  Documents/Tracker/.
- GitHub Pages publishes `www/` from `main` (`.github/workflows/pages.yml`).
- When you change files in `www/`, bump `VERSION` in `www/sw.js`, or
  phones keep the old cached copy.
- The full spec and project notes are in [`CLAUDE.md`](CLAUDE.md).

---

## בעברית

**Tracker** היא אפליקציה חינמית ופרטית למעקב אחרי איך שאתה מרגיש. הקשה אחת
רושמת אירוע (כאב ראש, התקף חרדה, תרופה, לחץ דם, כל מה שתבחר) עם התאריך
והשעה. היא רושמת גם אימונים, עם טיימרים.

- **פתיחה:** https://avielmer.github.io/tracker/
- **התקנה (אנדרואיד):** פתח את הקישור ב-Chrome ← ⋮ ← "הוספה למסך הבית" או
  "התקנת אפליקציה". האפליקציה עובדת גם בלי אינטרנט.
- **בפעם הראשונה:** האפליקציה שואלת אחרי מה תרצה לעקוב. כל מה שתבחר יהפוך
  לכפתור. אפשר להוסיף כפתורים משלך בכל זמן עם "הוספת כפתור".
- **פרטיות:** כל המידע נשאר בטלפון שלך. אין חשבון, ושום דבר לא נשלח לשום
  מקום. כדאי לגבות מדי פעם: הגדרות ← גיבוי וייצוא ← גיבוי מלא (JSON).
- **שפה:** עברית, אנגלית ורוסית. לכל שפה אחרת: הגדרות ← שינויים בעזרת AI.
- **ערכת נושא:** כהה, או "בנות" — בהירה וורודה עם צבעי מים ופרחים: הגדרות ← ערכת נושא.
- **מחזור ומים:** כפתור "מחזור" (התחלה וסיום), "יומן מחזור" בסגנון אפליקציות
  המחזור (דימום, תסמינים, רגשות, אנרגיה, הפרשות, בדיקות ביוץ והיריון ועוד,
  בהקשה) ו"שתיית מים" עם יעד יומי (3/8). מוסיפים אותם ב"הוספת כפתור" ← מוכנים.
  לכל כפתור אפשר גם להוסיף רשימות תשובות משלך.
- **שינוי כפתורים בעזרת AI:** הגדרות ← שינויים בעזרת AI ← העתק את הפרומפט,
  הדבק אותו ב-Claude או ב-ChatGPT וכתוב מה אתה רוצה. אחר כך הדבק את התשובה
  בחזרה באפליקציה.
- **חשוב:** האפליקציה לא נותנת ייעוץ רפואי. אם אתה בסכנה או חושב לפגוע
  בעצמך, התקשר עכשיו: ער״ן, עזרה ראשונה נפשית, 1201 (24/7), מד״א 101.

## По-русски

**Tracker** — бесплатное приложение, чтобы следить за своим самочувствием.
Одно нажатие записывает событие (головная боль, паническая атака,
лекарство, давление — что угодно) с датой и временем. Записывает и
тренировки, с таймерами.

- **Открыть:** https://avielmer.github.io/tracker/
- **Установка (Android):** откройте ссылку в Chrome → ⋮ → «Добавить на
  главный экран» или «Установить приложение». Работает без интернета.
- **В первый раз:** приложение спросит, что вы хотите отслеживать. Каждый
  выбранный пункт станет кнопкой. Свои кнопки можно добавить в любой момент
  через «Новая кнопка».
- **Приватность:** все данные остаются на вашем телефоне. Нет аккаунта,
  ничего никуда не отправляется. Время от времени делайте копию: Настройки
  → Копия и экспорт → Полная копия (JSON).
- **Язык:** русский, иврит, английский. Любой другой язык: Настройки →
  Изменить с помощью ИИ.
- **Тема:** тёмная или «Девичья» — светлая и розовая, с акварелью и
  цветами: Настройки → Тема.
- **Цикл и вода:** кнопка «Месячные» (начало и конец), «Дневник цикла» как
  в приложениях для цикла (обильность, симптомы, чувства, энергия, слизь,
  тесты на овуляцию и беременность и другое — одним нажатием) и «Стаканы
  воды» с целью на день (3/8). Добавить: «Новая кнопка» → «Готовые». В любую
  кнопку можно добавить свои списки ответов.
- **Важно:** приложение не даёт медицинских советов. Если вы в опасности
  или думаете навредить себе, позвоните прямо сейчас. В Израиле: ЭРАН,
  эмоциональная первая помощь, 1201 (круглосуточно), Маген Давид Адом 101.
