(() => {
  const rules = globalThis.RoomlineRules;
  const raw = element => rules.clean(element?.innerText || element?.textContent);
  const visible = element => element?.isConnected && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' && !element.closest('[aria-hidden="true"],[hidden]');
  const elements = (selector, root = document) => [...root.querySelectorAll(selector)].filter(visible);
  const exact = (root, label) => elements('button', root).filter(button => raw(button) === label);
  const enabled = element => visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
    getComputedStyle(element).pointerEvents !== 'none';
  const pause = () => new Promise(resolve => setTimeout(resolve, 90));
  let ownedForm = null;

  async function waitFor(read, message) {
    for (let index = 0; index < 52; index++) {
      const value = read();
      if (value) return value;
      await pause();
    }
    throw new Error(message);
  }

  function header() {
    const allRooms = exact(document, 'All Rooms');
    if (allRooms.length !== 1) throw new Error('Open the signed-in CoWork dashboard.');
    const toolbar = allRooms[0].closest('.respToolbar,[data-room-toolbar]');
    if (!toolbar) throw new Error('Roomline could not identify the CoWork toolbar.');
    return toolbar;
  }

  function dateControl() {
    const matches = elements('p,span,button', header()).filter(element => /^\d{1,2} [a-z]+ \d{4}$/i.test(raw(element)));
    if (matches.length !== 1) throw new Error('Roomline could not verify the CoWork date.');
    return matches[0];
  }

  function context() {
    const toolbar = header();
    const displayedDate = dateControl();
    const text = raw(toolbar);
    const labels = text.replace(/All Rooms|My Bookings/g, '').replace(raw(displayedDate), '').trim();
    if (!labels) throw new Error('Roomline could not verify the CoWork location and filters.');
    const selection = [...toolbar.querySelectorAll('input:checked,select')].map(input => input.value).join('|');
    const snapshot = toolbar.innerText.replace(/All Rooms|My Bookings/g, '').split('\n').map(rules.clean)
      .filter(label => label && label !== raw(displayedDate));
    const site = snapshot.at(-1);
    const filterLabels = snapshot.slice(0, -1).filter(label => !['Capacity', 'Tower'].includes(label));
    return { date: rules.dateLabel(raw(displayedDate)), site,
      label: [site, ...filterLabels].filter(Boolean).join(' · '), scope: rules.key(labels + '|' + selection) };
  }

  function rooms(expected) {
    return exact(document, 'View & Book Slots').map((button, index) => {
      const card = button.closest('.respCardPad,[data-room-card]') || button.parentElement;
      const lines = card.innerText.split('\n').map(rules.clean).filter(Boolean);
      const towerIndex = lines.findIndex(line => /^Tower\s+\S/i.test(line));
      const tower = lines[towerIndex] || '';
      const name = lines[towerIndex - 1] || '';
      const portalId = card.getAttribute('data-room-id') || button.getAttribute('data-room-id');
      const capacity = /\b(\d+) Seats?\b/i.exec(raw(card))?.[1];
      // Filters are excluded from identity so changing a capacity filter cannot evade duplicate protection.
      const site = expected.site;
      const id = JSON.stringify(portalId ? ['id', portalId] : [rules.key(site), rules.key(name), rules.key(tower)]);
      return { button, room: { id, name: name || 'Room ' + (index + 1), tower, capacity, site, identified: Boolean(name && tower) } };
    });
  }

  async function loadedRooms(expected) {
    let previous = '';
    let stable = 0;
    return waitFor(() => {
      const current = context();
      if (current.date !== expected.date || current.scope !== expected.scope) {
        throw new Error('The CoWork date or filters changed while rooms loaded.');
      }
      const cards = rooms(expected);
      if (!cards.length || elements('[aria-busy="true"],[role="progressbar"]').length) {
        stable = 0;
        return null;
      }
      const signature = JSON.stringify(cards.map(({ room, button }) => [room.id, raw(button.parentElement)]));
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      return stable >= 2 && cards;
    }, 'No room cards loaded for this CoWork view. Check the date or filters and try again.');
  }

  function assertContext(expected) {
    const actual = context();
    if (actual.date !== expected.date || actual.scope !== expected.scope || !exact(document, 'View & Book Slots').length) {
      throw new Error('The CoWork date, filters, or room view changed. Search again.');
    }
  }

  async function restoreRoomView(expected) {
    if (exact(document, 'View & Book Slots').length) {
      assertContext(expected);
      return;
    }
    const actual = context();
    const roomsTab = exact(document, 'All Rooms');
    if (actual.date !== expected.date || actual.scope !== expected.scope ||
        roomsTab.length !== 1 || !enabled(roomsTab[0]) ||
        !exact(document, 'Upcoming Bookings').length || !exact(document, 'Past Bookings').length ||
        !elements('input[placeholder*="Search bookings" i]').length) {
      throw new Error('The CoWork date, filters, or room view changed. Search again.');
    }
    roomsTab[0].click();
    await loadedRooms(expected);
  }

  function calendar(base) {
    const root = base.parentElement.parentElement;
    const labels = elements('p,span', root).filter(element => /^[a-z]+ \d{4}$/i.test(raw(element)) &&
      rules.dateLabel('1 ' + raw(element)));
    return labels.length === 1 ? labels[0] : null;
  }

  async function setDate(target) {
    const base = dateControl();
    const initial = context();
    if (initial.date === target) return initial;
    if (findForm()) throw new Error('Close the current room form first.');
    base.parentElement.click();
    try {
      let label = await waitFor(() => calendar(base), 'The CoWork calendar did not open.');
      for (let page = 0; page < 13; page++) {
        const displayed = rules.dateLabel('1 ' + raw(label));
        if (displayed.slice(0, 7) === target.slice(0, 7)) {
          const lastDay = new Date(Date.UTC(+target.slice(0, 4), +target.slice(5, 7), 0)).getUTCDate();
          const cells = elements('button,div', label.parentElement.parentElement).filter(element =>
            !element.children.length && /^\d{1,2}$/.test(raw(element)));
          const firsts = cells.map((cell, index) => raw(cell) === '1' ? index : -1)
            .filter(index => index >= 0 && Array.from({ length: lastDay }, (_, offset) =>
              raw(cells[index + offset]) === String(offset + 1)).every(Boolean));
          if (firsts.length !== 1) throw new Error('The calendar day is ambiguous.');
          const cell = cells[firsts[0] + Number(target.slice(8)) - 1];
          if (!enabled(cell)) throw new Error('CoWork does not offer that date.');
          cell.click();
          return await waitFor(() => {
            const current = context();
            if (!calendar(dateControl()) && current.date === target && current.scope !== initial.scope) {
              throw new Error('CoWork changed the room filters for that date. Review the filters and search again.');
            }
            return current.date === target && !calendar(dateControl()) &&
              !elements('[aria-busy="true"],[role="progressbar"]').length && current;
          }, 'CoWork did not switch to the requested date.');
        }
        const arrow = displayed < target ? label.nextElementSibling : label.previousElementSibling;
        if (!enabled(arrow) || !arrow.querySelector('svg')) throw new Error('The calendar month control could not be verified.');
        arrow.click();
        label = await waitFor(() => {
          const next = calendar(base);
          return next && rules.dateLabel('1 ' + raw(next)) !== displayed && next;
        }, 'CoWork did not change calendar month.');
      }
      throw new Error('Choose a date within the next twelve months.');
    } finally {
      if (base.isConnected && calendar(base)) base.parentElement.click();
    }
  }

  function findForm() {
    const actions = exact(document, 'Request Slot');
    if (actions.length > 1) throw new Error('More than one room form is open.');
    for (let form = actions[0]; form && form !== document.body; form = form.parentElement) {
      if (form.querySelector('input[placeholder*="meeting title" i]') && /AVAILABLE SLOTS/i.test(raw(form))) return form;
    }
    return null;
  }

  function checkForm(form, room, expected) {
    assertContext(expected);
    const headings = elements('p,h2,h3', form).map(raw);
    const dates = elements('button', form).map(button => rules.dateLabel(raw(button))).filter(Boolean);
    if (findForm() !== form || rules.key(headings[0]) !== rules.key(room.name) ||
        !headings.some(label => rules.key(label) === rules.key(room.tower)) ||
        dates.length !== 1 || dates[0] !== expected.date) {
      throw new Error('The open form does not match the selected room or date.');
    }
  }

  function selectedDuration(form) {
    const buttons = exact(form, '30 Mins.');
    return buttons.length === 1 && enabled(buttons[0]) &&
      (buttons[0].getAttribute('aria-pressed') === 'true' || buttons[0].classList.contains('fxhqIv'));
  }

  async function open(room, expected) {
    assertContext(expected);
    if (findForm()) throw new Error('Close the current room form first.');
    const candidates = rooms(expected).filter(candidate => candidate.room.identified && candidate.room.id === room.id);
    if (candidates.length !== 1) throw new Error('The exact room could not be identified.');
    candidates[0].button.click();
    const form = await waitFor(findForm, 'CoWork did not open the room form.');
    ownedForm = form;
    checkForm(form, room, expected);
    if (!selectedDuration(form)) {
      const buttons = exact(form, '30 Mins.');
      if (buttons.length !== 1 || !enabled(buttons[0])) throw new Error('The 30-minute duration control is unavailable.');
      buttons[0].click();
      await waitFor(() => selectedDuration(form), 'CoWork did not confirm the 30-minute duration.');
    }
    const stableForm = await waitFor(() => {
      if (!/AVAILABLE SLOTS/i.test(raw(form)) || elements('[aria-busy="true"],[role="progressbar"]', form).length) return null;
      return elements('button,div,span,p', form).some(element => !element.children.length && rules.minute(raw(element)) >= 0) && form;
    }, 'CoWork did not load the room’s time slots.');
    checkForm(stableForm, room, expected);
    return stableForm;
  }

  function slot(form, part) {
    const slots = elements('button', form).filter(button => rules.minute(raw(button)) === part.start);
    if (slots.length > 1) throw new Error('The selected time is ambiguous.');
    return enabled(slots[0]) ? slots[0] : null;
  }

  async function close() {
    const form = ownedForm;
    ownedForm = null;
    if (!visible(form)) return;
    if (findForm() !== form) throw new Error('The room form changed. Close it in CoWork before continuing.');
    const cancel = exact(form, 'Cancel');
    if (cancel.length !== 1 || !enabled(cancel[0])) throw new Error('Close the room form in CoWork before continuing.');
    cancel[0].click();
    await waitFor(() => !form.isConnected || !visible(form), 'CoWork did not close the room form.');
  }

  async function check(room, expected, parts) {
    try {
      const form = await open(room, expected);
      return parts.map(part => Boolean(slot(form, part)));
    } finally {
      await close();
    }
  }

  async function prepare(room, expected, title, part) {
    const form = await open(room, expected);
    const option = slot(form, part);
    if (!option) return null;
    const field = form.querySelector('input[placeholder*="meeting title" i]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, title);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    const currentOption = slot(form, part);
    if (!currentOption) throw new Error('The selected time changed while entering the title.');
    const before = currentOption.className;
    currentOption.click();
    const selection = () => {
      const selected = slot(form, part);
      return selected && (selected.getAttribute('aria-pressed') === 'true' ||
        (before !== selected.className && selected.classList.contains('dydyaH')));
    };
    await waitFor(selection, 'CoWork did not verify the selected time.');
    return {
      send() {
        checkForm(form, room, expected);
        const request = exact(form, 'Request Slot');
        if (!rules.startsAfter(expected.date, part.start) || !selection() || !selectedDuration(form) ||
            form.querySelector('input[placeholder*="meeting title" i]')?.value !== title ||
            request.length !== 1 || !enabled(request[0])) {
          throw new Error('The booking form changed before submission.');
        }
        request[0].click();
      },
      async settle() {
        try {
          await waitFor(() => !visible(form), 'CoWork did not close the submitted form.');
        } catch {
          await close();
        }
      }
    };
  }

  globalThis.RoomlinePortal = { context, loadedRooms, setDate, assertContext, restoreRoomView, check, prepare, close };
})();
