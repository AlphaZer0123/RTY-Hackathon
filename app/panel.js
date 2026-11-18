function mountRoomline() {
  const rules = globalThis.RoomlineRules;
  const portal = globalThis.RoomlinePortal;
  const host = document.createElement('div');
  host.setAttribute('data-roomline', '');
  document.body.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <link rel="stylesheet" href="${chrome.runtime.getURL('panel.css')}">
    <button class="launcher" id="launcher" aria-controls="drawer" aria-expanded="false">
      <span class="brand-icon" aria-hidden="true"></span> Roomline
    </button>
    <aside id="drawer" class="drawer" aria-labelledby="title" hidden>
      <header class="top">
        <div class="wordmark"><span class="brand-icon" aria-hidden="true"></span> Roomline</div>
        <button class="icon-button" id="close" type="button" aria-label="Close Roomline">×</button>
      </header>
      <div class="body">
        <h1 id="title" tabindex="-1">Find a room</h1>
        <p id="scope" class="scope"></p>
        <div id="summary" class="summary" hidden></div>
        <form id="meeting">
          <label>Meeting title<input name="meetingTitle" type="text" placeholder="Team meeting" maxlength="100" required></label>
          <label>Date<input name="date" type="date" required></label>
          <div class="fields">
            <label>Start time <span class="zone">IST</span><input name="start" type="time" step="900" value="10:00" required></label>
            <label>End time <span class="zone">IST</span><input name="end" type="time" step="900" value="10:30" required></label>
          </div>
          <button class="primary" id="search" type="submit">Search rooms <span aria-hidden="true">→</span></button>
        </form>
        <p id="status" class="status" role="status" aria-live="polite" hidden></p>
        <button class="secondary" id="stop" type="button" hidden>Stop search</button>
        <div id="results" hidden></div>
        <section id="review" hidden>
          <div id="review-details"></div>
          <button class="primary" id="book">Book this room <span aria-hidden="true">→</span></button>
          <button class="secondary" id="back">Back to results</button>
        </section>
        <section id="result" hidden>
          <div id="receipt"></div>
          <button class="primary" id="recheck" hidden>Check email again</button>
          <button class="secondary" id="new-search">New search</button>
        </section>
        <button class="text-button" id="history" hidden>Check saved booking</button>
      </div>
    </aside>`;
  const get = id => shadow.getElementById(id);
  const form = get('meeting');
  let page = 'meeting';
  let operation = '';
  let stop = false;
  let meeting = null;
  let context = null;
  let entries = [];
  let chosen = null;
  let activeId = null;
  let receipt = null;
  let latest = null;
  let restoreRequested = false;

  const setText = (id, text) => { get(id).textContent = text; };
  function status(message, error = false) {
    const node = get('status');
    node.textContent = message;
    node.hidden = !message;
    node.classList.toggle('warning', error);
  }

  function make(tag, className, value) {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  }

  function show(next, focus = true) {
    page = next;
    for (const id of ['meeting', 'results', 'review', 'result']) get(id).hidden = id !== next;
    get('summary').hidden = next === 'meeting';
    const data = next === 'result' ? receipt : meeting;
    if (data) get('summary').replaceChildren(
      make('strong', '', data.title),
      make('span', '', data.date + ' · ' + interval(data.parts[0].start, data.parts.at(-1).end))
    );
    const titles = { meeting: 'Find a room', results: 'Room availability', review: 'Review booking', result: 'Booking result' };
    setText('title', titles[next]);
    get('history').hidden = !latest || next !== 'meeting';
    if (focus) get('title').focus();
  }

  function interval(start, end) {
    return rules.time(start) + '–' + rules.time(end) + ' IST';
  }

  function roomLabel(room) {
    return [room.site, room.tower, room.capacity && room.capacity + ' seats'].filter(Boolean).join(' · ');
  }

  function renderResults() {
    const container = get('results');
    container.replaceChildren();
    const groups = [['available', 'Available'], ['unavailable', 'Unavailable'], ['unchecked', 'Not checked']];
    for (const [state, label] of groups) {
      const group = entries.filter(entry => entry.state === state);
      if (!group.length) continue;
      container.append(make('h2', 'group-title', label + ' · ' + group.length));
      for (const entry of group) {
        const canChoose = state === 'available' && !operation;
        const row = make(canChoose ? 'button' : 'div', 'room ' + state, '');
        if (canChoose) row.type = 'button';
        const meta = make('span', 'room-meta', '');
        meta.append(make('strong', '', entry.room.name), make('small', '', roomLabel(entry.room)));
        if (entry.reason) meta.append(make('small', '', entry.reason));
        row.append(meta, make('span', 'room-tag', canChoose ? 'Select →' : label));
        if (canChoose) row.addEventListener('click', () => select(entry.room));
        container.append(row);
      }
    }
  }

  function select(room) {
    try {
      portal.assertContext(context);
    } catch (error) {
      status(error.message, true);
      return;
    }
    chosen = room;
    const details = get('review-details');
    details.replaceChildren(make('h2', 'room-name', room.name), make('p', 'scope', roomLabel(room)));
    const intervals = meeting.parts.map(part => make('p', 'interval', interval(part.start, part.end)));
    if (intervals.length > 2) {
      const breakdown = make('details', 'intervals', '');
      breakdown.append(make('summary', '', 'View all ' + intervals.length + ' slots'), ...intervals);
      details.append(breakdown);
    } else {
      details.append(...intervals);
    }
    if (intervals.length > 1) {
      details.append(make('p', 'hint', intervals.length + ' requests. Roomline confirms each by email before it sends the next one.'));
    }
    status('');
    show('review');
    get('book').focus();
  }

  async function search(event) {
    event.preventDefault();
    if (operation) return;
    try {
      meeting = rules.meeting({ date: form.elements.date.value, start: form.elements.start.value,
        duration: rules.minute(form.elements.end.value) - rules.minute(form.elements.start.value), title: form.elements.meetingTitle.value });
    } catch (error) {
      status(error.message, true);
      return;
    }
    entries = [];
    chosen = null;
    stop = false;
    operation = 'search';
    show('results');
    renderResults();
    status('Opening the selected date in CoWork…');
    get('stop').hidden = false;
    get('stop').textContent = 'Stop search';
    let checked = 0;
    try {
      context = await portal.setDate(meeting.date);
      setText('scope', 'Current CoWork view · ' + context.label);
      entries = (await portal.loadedRooms(context)).map(({ room }) => ({ room, state: 'unchecked' }));
      const identities = new Map();
      for (const { room } of entries) identities.set(room.id, (identities.get(room.id) || 0) + 1);
      renderResults();
      for (const entry of entries) {
        if (stop) break;
        portal.assertContext(context);
        if (!entry.room.identified || identities.get(entry.room.id) !== 1) {
          entry.reason = 'Room identity could not be verified';
        } else {
          const matches = await portal.check(entry.room, context, meeting.parts);
          entry.state = matches.every(Boolean) ? 'available' : 'unavailable';
          checked++;
        }
        status('Checked ' + checked + ' of ' + entries.length + ' rooms.');
        renderResults();
      }
      const available = entries.filter(entry => entry.state === 'available').length;
      status((stop ? 'Search stopped. ' : '') + available + ' available · ' + checked + ' of ' + entries.length + ' checked.');
      setText('scope', 'Loaded rooms in ' + context.label);
    } catch (error) {
      status(error.message + ' Checked ' + checked + ' of ' + entries.length + ' rooms.', true);
    } finally {
      operation = '';
      get('stop').hidden = true;
      renderResults();
      const edit = make('button', 'secondary', 'Edit meeting details');
      edit.type = 'button';
      edit.addEventListener('click', () => {
        entries = [];
        chosen = null;
        status('');
        show('meeting');
      });
      get('results').append(edit);
    }
  }

  async function request(action, fields = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'roomline-run', action, ...fields });
    if (!response || response.error) throw new Error(response?.error || 'Roomline could not read the saved booking.');
    return response.value;
  }

  function renderReceipt() {
    if (!receipt) return;
    const container = get('receipt');
    container.replaceChildren(make('h2', 'room-name', receipt.room.name), make('p', 'scope', roomLabel(receipt.room)));
    if (receipt.parts.length > 1) {
      const confirmed = receipt.parts.filter(part => part.state === 'confirmed').length;
      const label = confirmed + ' of ' + receipt.parts.length + ' confirmed';
      const progress = make('progress', '', label);
      progress.max = receipt.parts.length;
      progress.value = confirmed;
      progress.setAttribute('aria-label', label);
      const progressCard = make('div', 'booking-progress', '');
      progressCard.append(make('strong', '', label), progress);
      container.append(progressCard);
    }
    const labels = { 'not-sent': 'Not sent', unavailable: 'Unavailable', pending: 'Pending confirmation', confirmed: 'Confirmed by email' };
    for (const part of receipt.parts) {
      const row = make('div', 'receipt-line ' + part.state, '');
      row.append(make('span', '', interval(part.start, part.end)), make('strong', '', labels[part.state]));
      container.append(row);
    }
    const pending = receipt.parts.some(part => part.state === 'pending');
    get('recheck').hidden = !pending;
    get('recheck').disabled = Boolean(operation);
    get('new-search').disabled = Boolean(operation);
  }

  async function poll(id) {
    const expiresAt = Date.now() + 118000;
    while (Date.now() < expiresAt && !stop) {
      receipt = await request('verify', { id });
      renderReceipt();
      if (!receipt.parts.some(part => part.state === 'pending')) break;
      await new Promise(resolve => setTimeout(resolve, 2200));
    }
  }

  async function waitForGrant(id, index) {
    const expiresAt = Date.now() + 118000;
    while (Date.now() < expiresAt && !stop) {
      const granted = await request('grant', { id, index });
      if (granted) return granted;
      status('Return to your Gmail inbox. Roomline will then send the next reviewed request.');
      await new Promise(resolve => setTimeout(resolve, 1200));
    }
    if (stop) return null;
    throw new Error('The Gmail inbox did not reopen. The remaining requests were not sent.');
  }

  async function book() {
    if (operation || !chosen || page !== 'review') return;
    operation = 'booking';
    stop = false;
    let runId;
    get('book').disabled = true;
    get('back').disabled = true;
    get('stop').hidden = false;
    get('stop').textContent = 'Stop remaining';
    status('Checking the selected room again…');
    try {
      portal.assertContext(context);
      const ready = await portal.check(chosen, context, meeting.parts);
      if (stop) return status('Booking stopped before sending.');
      if (!ready.every(Boolean)) return status('This room no longer fits the full meeting. Search again.', true);
      activeId = crypto.randomUUID();
      receipt = await request('begin', { room: chosen, review: meeting, id: activeId });
      runId = receipt.id;
      latest = receipt;
      show('result');
      renderReceipt();
      for (let index = 0; index < receipt.parts.length && !stop; index++) {
        const part = receipt.parts[index];
        if (index > 0) await portal.restoreRoomView(context);
        if (stop) break;
        status('Preparing request ' + (index + 1) + ' of ' + receipt.parts.length + '…');
        const prepared = await portal.prepare(chosen, context, meeting.title, part);
        if (!prepared) {
          receipt = await request('unavailable', { id: runId, index });
          renderReceipt();
          status('The next slot is no longer available.', true);
          break;
        }
        if (stop) break;
        const granted = await waitForGrant(runId, index);
        if (!granted) break;
        receipt = granted;
        renderReceipt();
        if (stop) {
          receipt = await request('abort-grant', { id: runId, index });
          break;
        }
        prepared.send();
        status('Request ' + (index + 1) + ' of ' + receipt.parts.length + ' sent. Checking Gmail…');
        await prepared.settle();
        await poll(runId);
        if (receipt.parts[index].state !== 'confirmed') {
          status('Confirmation is still pending. Roomline will keep checking this receipt. Remaining requests were not sent.', true);
          break;
        }
      }
      if (receipt.parts.every(part => part.state === 'confirmed')) status('All requests confirmed.');
      else if (stop) status('Stopped. The receipt shows which requests were confirmed or may have been sent.');
    } catch (error) {
      status(error.message, true);
    } finally {
      try { await portal.close(); } catch (error) { status(error.message, true); }
      if (runId) {
        try { latest = receipt = await request('release', { id: runId }); }
        catch (error) { status(error.message, true); }
      }
      activeId = null;
      operation = '';
      get('stop').hidden = true;
      get('book').disabled = false;
      get('back').disabled = false;
      renderReceipt();
    }
  }

  async function verify(quiet = false) {
    if (operation || !receipt) return;
    operation = 'verify';
    if (!quiet) renderReceipt();
    try {
      latest = receipt = await request('verify', { id: receipt.id });
      if (!quiet || !receipt.parts.some(part => part.state === 'pending')) status(receipt.parts.some(part => part.state === 'pending')
        ? 'No exact match yet. Open the booking email in Masters’ Union Gmail, then check again.'
        : 'Email check complete. See the result for each request.');
    } catch (error) {
      if (!quiet) status(error.message, true);
    } finally {
      operation = '';
      renderReceipt();
    }
  }

  async function openDrawer() {
    get('drawer').hidden = false;
    get('launcher').hidden = true;
    get('launcher').setAttribute('aria-expanded', 'true');
    try {
      const current = portal.context();
      if (!form.elements.date.value) form.elements.date.value = current.date;
      setText('scope', 'Current CoWork view · ' + current.label);
    } catch (error) {
      status(error.message, true);
    }
    show(page);
    if (restoreRequested) return;
    restoreRequested = true;
    try {
      const history = await request('history');
      latest = history.find(run => run.parts.some(part => part.state === 'pending')) ||
        history.find(run => run.parts.some(part => part.state === 'confirmed'));
      if (latest && page === 'meeting' && !operation) get('history').hidden = false;
    } catch (error) {
      if (page === 'meeting' && !operation) status(error.message, true);
    }
  }

  function closeDrawer() {
    if (operation) return;
    get('drawer').hidden = true;
    get('launcher').hidden = false;
    get('launcher').setAttribute('aria-expanded', 'false');
    get('launcher').focus();
  }

  get('launcher').addEventListener('click', openDrawer);
  get('close').addEventListener('click', closeDrawer);
  get('drawer').addEventListener('keydown', event => { if (event.key === 'Escape') closeDrawer(); });
  form.addEventListener('submit', search);
  get('stop').addEventListener('click', () => { stop = true; });
  get('back').addEventListener('click', () => { status(''); show('results'); });
  get('book').addEventListener('click', book);
  get('recheck').addEventListener('click', () => verify());
  get('new-search').addEventListener('click', () => { status(''); show('meeting'); });
  get('history').addEventListener('click', () => { receipt = latest; status(''); show('result'); renderReceipt(); if (receipt.parts.some(part => part.state === 'pending')) verify(true); });
  setInterval(() => {
    if (page === 'result' && !get('drawer').hidden && receipt?.parts.some(part => part.state === 'pending')) verify(true);
  }, 6000);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id === chrome.runtime.id && message?.type === 'roomline-run-alive') {
      respond({ alive: operation === 'booking' && activeId === message.id });
    }
  });
}

(() => {
  // Marketplace can enter CoWork on a different URL and change routes without reloading.
  const navigation = window.navigation;
  const observer = new MutationObserver(mountDashboard);

  function mountDashboard() {
    if (!/^\/user-dashboard(?:\/|$)/.test(location.pathname) || !document.body) return false;
    observer.disconnect();
    navigation?.removeEventListener('currententrychange', mountDashboard);
    window.removeEventListener('popstate', mountDashboard);
    if (!document.querySelector('[data-roomline]')) mountRoomline();
    return true;
  }

  if (!mountDashboard()) {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    navigation?.addEventListener('currententrychange', mountDashboard);
    window.addEventListener('popstate', mountDashboard);
  }
})();
