(() => {
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
        <p id="summary" class="summary" hidden></p>
        <form id="meeting">
          <label>Meeting title<input name="meetingTitle" type="text" placeholder="Team meeting" maxlength="100" required></label>
          <div class="fields">
            <label>Date<input name="date" type="date" required></label>
            <label>Start time <span class="zone">IST</span><input name="start" type="time" step="900" value="10:00" required></label>
          </div>
          <label>Duration<select name="duration"><option value="30">30 minutes</option><option value="60">60 minutes</option></select></label>
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
    if (data) setText('summary', data.title + ' · ' + data.date + ' · ' + interval(data.parts[0].start, data.parts.at(-1).end));
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
    for (const part of meeting.parts) details.append(make('p', 'interval', interval(part.start, part.end)));
    if (meeting.parts.length === 2) {
      details.append(make('p', 'hint', 'CoWork receives two requests. The second is sent after the first is confirmed by email.'));
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
        duration: Number(form.elements.duration.value), title: form.elements.meetingTitle.value });
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
        status('Preparing request ' + (index + 1) + ' of ' + receipt.parts.length + '…');
        const prepared = await portal.prepare(chosen, context, meeting.title, part);
        if (!prepared) {
          receipt = await request('unavailable', { id: runId, index });
          renderReceipt();
          status('The next slot is no longer available.', true);
          break;
        }
        if (stop) break;
        receipt = await request('grant', { id: runId, index });
        renderReceipt();
        if (stop) {
          receipt = await request('abort-grant', { id: runId, index });
          break;
        }
        prepared.send();
        status('Checking Masters’ Union Gmail. If the preview is incomplete, open the booking email there.');
        await prepared.settle();
        await poll(runId);
        if (receipt.parts[index].state !== 'confirmed') {
          status('The booking may have gone through. Open the booking email if needed, then check again.', true);
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

  async function verify() {
    if (operation || !receipt) return;
    operation = 'verify';
    renderReceipt();
    try {
      latest = receipt = await request('verify', { id: receipt.id });
      status(receipt.parts.some(part => part.state === 'pending')
        ? 'No exact match yet. Open the booking email in Masters’ Union Gmail, then check again.'
        : 'Email check complete. See the result for each request.');
    } catch (error) {
      status(error.message, true);
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
  get('recheck').addEventListener('click', verify);
  get('new-search').addEventListener('click', () => { status(''); show('meeting'); });
  get('history').addEventListener('click', () => { receipt = latest; status(''); show('result'); renderReceipt(); });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id === chrome.runtime.id && message?.type === 'roomline-run-alive') {
      respond({ alive: operation === 'booking' && activeId === message.id });
    }
  });
})();
