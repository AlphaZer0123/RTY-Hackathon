importScripts('rules.js');
const rules = globalThis.RoomlineRules;
const storageKey = 'roomline-bookings-v1';
let operations = Promise.resolve();

function serialized(task) {
  const next = operations.then(task);
  operations = next.catch(() => {});
  return next;
}

async function ledger() {
  return (await chrome.storage.local.get(storageKey))[storageKey] || { active: null, runs: [] };
}

function save(state) {
  return chrome.storage.local.set({ [storageKey]: state });
}

function recipient(sender) {
  return { tab: sender.tab.id, document: sender.documentId };
}

function owns(active, sender, id) {
  return active?.id === id && active.tab === sender.tab.id && active.document === sender.documentId;
}

async function mail(previous) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/mail/*' });
  const matches = await Promise.all(tabs.map(async tab => {
    try {
      const snapshot = await chrome.tabs.sendMessage(tab.id, { type: 'roomline-mail' }, { frameId: 0 });
      if (snapshot?.ready && (!previous || previous.mailboxId === snapshot.mailboxId)) {
        return { ...snapshot, tab: tab.id };
      }
    } catch {
      // Tabs without an active Roomline Gmail script cannot verify a booking.
    }
    return null;
  }));
  const ready = matches.filter(Boolean);
  return ready.find(snapshot => snapshot.tab === previous?.tab) || (ready.length === 1 ? ready[0] : null);
}

function publicRun(run) {
  return run && { id: run.id, room: run.room, date: run.date, title: run.title, duration: run.duration,
    parts: run.parts.map(({ start, end, state }) => ({ start, end, state })) };
}

async function begin(state, message, sender) {
  if (state.active) {
    const { tab, document, id } = state.active;
    let alive = false;
    try {
      alive = (await chrome.tabs.sendMessage(tab, { type: 'roomline-run-alive', id }, { documentId: document }))?.alive === true;
    } catch {
      // A reloaded or closed document cannot continue an earlier run.
    }
    if (alive) throw new Error('A booking is running in another Roomline tab.');
    state.active = null;
  }
  const { room, review, id } = message;
  if (!/^[0-9a-f-]{36}$/.test(id) || state.runs.some(run => run.id === id)) throw new Error('Invalid booking run identity.');
  if (!room?.identified || !room.id || !room.name || !room.tower) throw new Error('Choose an identified room.');
  const checked = rules.meeting({ date: review.date, start: rules.time(review.parts[0].start),
    duration: review.duration, title: review.title });
  if (checked.parts.some(part => rules.conflicts(state.runs, room, checked.date, part))) {
    throw new Error('A pending or confirmed Roomline request overlaps this room and time.');
  }
  const gmail = await mail();
  if (!gmail) throw new Error('Open one signed-in Masters’ Union Gmail tab in this Chrome profile.');
  const run = {
    ...checked, room, id,
    gmail: { mailboxId: gmail.mailboxId, tab: gmail.tab },
    parts: checked.parts.map(part => ({ ...part, state: 'not-sent' }))
  };
  state.runs.push(run);
  state.active = { id: run.id, ...recipient(sender) };
  await save(state);
  return publicRun(run);
}

async function grant(state, run, part, index) {
  if (part.state !== 'not-sent' || (index > 0 && run.parts[index - 1].state !== 'confirmed')) {
    throw new Error('The previous request must be confirmed before the next one can be sent.');
  }
  if (rules.conflicts(state.runs, run.room, run.date, part)) {
    throw new Error('A pending or confirmed request already overlaps this slot.');
  }
  if (!rules.startsAfter(run.date, part.start)) throw new Error('This slot has already started. Search again.');
  const gmail = await mail(run.gmail);
  if (!gmail) throw new Error('Open the original Masters’ Union Gmail account to continue.');
  // The next email may arrive in the same minute. Capture the list before the click.
  if (index > 0 && !gmail.complete) return null;
  part.state = 'pending';
  part.grantedAt = Date.now();
  part.baseline = gmail.ids;
  part.mailScope = gmail.scope;
  part.baselineComplete = gmail.complete;
  await save(state);
  return publicRun(run);
}

async function verify(state, run) {
  const pending = run.parts.filter(part => part.state === 'pending');
  const gmail = pending.length && await mail(run.gmail);
  let changed = false;
  for (const part of gmail ? pending : []) {
    const originalView = part.baselineComplete && gmail.scope === part.mailScope;
    if (originalView) {
      const observed = [...new Set([...(part.observed || []), ...gmail.ids.filter(id => !part.baseline.includes(id))])];
      if (observed.length !== (part.observed?.length || 0)) {
        part.observed = observed;
        changed = true;
      }
    }
    const matching = candidate => rules.confirmation({ ...candidate, kind: 'booked' }, run, {
      ...part, baselineComplete: originalView || part.observed?.includes(candidate.id)
    });
    const verified = new Set(gmail.messages.filter(candidate => candidate.kind === 'booked' && matching(candidate))
      .map(candidate => candidate.id));
    const cancelled = gmail.messages.some(candidate => candidate.kind === 'cancelled' && matching(candidate));
    if (verified.size === 1 && !cancelled) {
      part.state = 'confirmed';
      delete part.baseline;
      delete part.baselineComplete;
      delete part.mailScope;
      delete part.observed;
      changed = true;
    }
  }
  if (changed) await save(state);
  return publicRun(run);
}

async function handle(message, sender) {
  const state = await ledger();
  if (message.action === 'history') return state.runs.slice(-10).reverse().map(publicRun);
  if (message.action === 'begin') return begin(state, message, sender);
  const run = state.runs.find(candidate => candidate.id === message.id);
  if (!run) throw new Error('Roomline could not read that saved booking.');
  if (message.action === 'verify') return verify(state, run);
  if (!owns(state.active, sender, run.id)) throw new Error('This tab no longer owns the booking run.');
  if (message.action === 'release') {
    state.active = null;
    await save(state);
    return publicRun(run);
  }
  const part = run.parts[message.index];
  if (!part) throw new Error('Unknown booking interval.');
  if (message.action === 'grant') return grant(state, run, part, message.index);
  if (message.action === 'abort-grant' && part.state === 'pending') {
    // Only the owning document can report that it stopped before invoking the portal click.
    run.parts[message.index] = { start: part.start, end: part.end, state: 'not-sent' };
    await save(state);
    return publicRun(run);
  }
  if (message.action === 'unavailable' && part.state === 'not-sent') {
    part.state = 'unavailable';
    await save(state);
    return publicRun(run);
  }
  throw new Error('Invalid booking action.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'roomline-run' || sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab ||
      !/^https:\/\/(?:www\.)?cowork\.mastersunion\.org\/user-dashboard(?:[/?#]|$)/.test(sender.url || '')) return;
  serialized(() => handle(message, sender)).then(
    value => respond({ value }),
    error => respond({ error: error.message })
  );
  return true;
});
