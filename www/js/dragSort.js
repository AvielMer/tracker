// Drag to reorder: asked for as "a grip thing so I can grip and drag it".
// With ↑ ↓, moving a button to the top took one tap per row, and each step
// was hard to see. In "Reorder" mode every row has a grip (⠿). Hold it and
// drag the row to its new place:
// - the rows in between slide aside;
// - the page scrolls by itself near the top or bottom edge;
// - the row flashes where it lands.
// The grip works with a keyboard too: ↑ ↓ move the row by one, Home / End
// to the top / bottom.
// WHY only the grip and not the whole row: a finger anywhere else still
// scrolls the page, and a tap on the row still opens it.
//
// list: the element whose children are the rows (data-drag-list = a name
// for it). A row that can move has data-drag-key (stable, e.g. the item's
// id) and a .grip button.
// onMove(from, to, key): the row went from place `from` to place `to` among
// those rows (0 = first). It saves, and the page draws itself again; it
// may be async, and returns false if nothing was saved.

// The row just moved: it flashes (and gets the focus back after a keyboard
// move) once the page has drawn the list again.
let landed = null;

const EDGE = 72; // px from the header / tab bar where the page scrolls
const SPEED = 14; // px per frame at the very edge

export function dragSort(list, onMove) {
  if (!list) return;
  const name = list.dataset.dragList || '';
  const rows = () => [...list.children].filter((r) => r.dataset.dragKey != null);

  if (landed && landed.list === name && Date.now() - landed.at < 4000) {
    const r = rows().find((x) => x.dataset.dragKey === landed.key);
    if (r) {
      r.classList.add('just-moved');
      if (landed.focus) r.querySelector('.grip')?.focus();
      landed = null;
    }
  }

  // Puts the row in its new place now (the save then draws the same).
  async function commit(row, from, to, focus) {
    const all = rows();
    const next = row.nextSibling;
    list.insertBefore(row, to > from ? all[to].nextSibling : all[to]);
    const key = row.dataset.dragKey;
    landed = { list: name, key, focus, at: Date.now() };
    const ok = await onMove(from, to, key);
    if (ok === false) {
      landed = null;
      if (row.isConnected && next?.parentNode === list) list.insertBefore(row, next);
    }
  }

  let drag = null;

  // Where everything goes for the finger's position: the held row follows
  // it (kept within the list), and once it covers half of a row, that row
  // makes room (the edges, not the middle: a tall row must still reach the
  // first and last place).
  function layout() {
    const { all, from, tops, hs } = drag;
    const n = all.length;
    let dy = drag.y - drag.y0 + (window.scrollY - drag.sy0);
    dy = Math.max(tops[0] - tops[from], Math.min(tops[n - 1] + hs[n - 1] - tops[from] - hs[from], dy));
    const top = tops[from] + dy;
    const bottom = top + hs[from];
    let to = from;
    while (to > 0 && top < tops[to - 1] + hs[to - 1] / 2) to--;
    while (to < n - 1 && bottom > tops[to + 1] + hs[to + 1] / 2) to++;
    const h = hs[from];
    all.forEach((r, i) => {
      let y = 0;
      if (i === from) y = dy;
      else if (from < to && i > from && i <= to) y = -h;
      else if (to < from && i >= to && i < from) y = h;
      r.style.transform = y ? `translateY(${y}px)` : '';
    });
    drag.to = to;
  }

  // Near the header or the tab bar the page scrolls, so a row can go
  // anywhere in a long list.
  function tick() {
    if (!drag) return;
    if (drag.moved) {
      const top = document.querySelector('.top')?.getBoundingClientRect().bottom || 0;
      const bottom = document.querySelector('.nav')?.getBoundingClientRect().top || window.innerHeight;
      let v = 0;
      if (drag.y < top + EDGE) v = -Math.min(1, (top + EDGE - drag.y) / EDGE) * SPEED;
      else if (drag.y > bottom - EDGE) v = Math.min(1, (drag.y - bottom + EDGE) / EDGE) * SPEED;
      if (v) {
        const before = window.scrollY;
        window.scrollBy(0, v);
        if (window.scrollY !== before) layout();
      }
    }
    drag.raf = requestAnimationFrame(tick);
  }

  function move(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    if (Math.abs(drag.y - drag.y0) > 6) drag.moved = true;
    layout();
  }

  function end(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { row, grip, from, to, all } = drag;
    cancelAnimationFrame(drag.raf);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    drag = null;
    list.classList.remove('sorting'); // first, so nothing slides back
    all.forEach((r) => { r.style.transform = ''; });
    row.classList.remove('dragging');
    // pointercancel = the phone took the touch over: nothing moves.
    if (e.type === 'pointerup' && to !== from) commit(row, from, to, false);
  }

  for (const row of rows()) {
    const grip = row.querySelector('.grip');
    if (!grip) continue;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || drag) return;
      e.preventDefault();
      const all = rows();
      const sy = window.scrollY;
      drag = {
        row,
        grip,
        all,
        from: all.indexOf(row),
        to: all.indexOf(row),
        tops: all.map((r) => r.getBoundingClientRect().top + sy),
        hs: all.map((r) => r.offsetHeight),
        y0: e.clientY,
        y: e.clientY,
        sy0: sy,
        id: e.pointerId,
        moved: false,
        raf: 0,
      };
      try { grip.setPointerCapture(e.pointerId); } catch { /* still works while over the grip */ }
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
      grip.addEventListener('pointercancel', end);
      row.classList.add('dragging');
      list.classList.add('sorting');
      try { navigator.vibrate?.(8); } catch { /* no vibration */ }
      drag.raf = requestAnimationFrame(tick);
    });
    grip.addEventListener('keydown', (e) => {
      const all = rows();
      const from = all.indexOf(row);
      const to = { ArrowUp: from - 1, ArrowDown: from + 1, Home: 0, End: all.length - 1 }[e.key];
      if (to == null) return;
      e.preventDefault();
      if (drag || to < 0 || to >= all.length || to === from) return;
      commit(row, from, to, true);
    });
  }
}
