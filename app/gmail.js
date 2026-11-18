(() => {
  const rules = globalThis.RoomlineRules;
  let inspection = null;
  const referenceAttributes = [
    'data-legacy-message-id', 'data-message-id',
    'data-legacy-last-non-draft-message-id', 'data-legacy-last-message-id'
  ];

  function mailbox() {
    const domains = [...document.querySelectorAll('[aria-label*="Google Account" i]')]
      .map(element => /[\w.+-]+@mastersunion\.org\b/i.exec(element.getAttribute('aria-label'))?.[0].toLowerCase())
      .filter(Boolean);
    const accounts = [...new Set(domains)];
    return accounts.length === 1 && document.querySelector('[role="main"]') ? accounts[0] : '';
  }

  function stableId(root) {
    for (const attribute of referenceAttributes) {
      const value = root.getAttribute(attribute) || root.querySelector('[' + attribute + ']')?.getAttribute(attribute);
      if (value) return value;
    }
    return '';
  }

  function stamp(root) {
    const time = root.querySelector('time[datetime]')?.getAttribute('datetime');
    if (time && /(?:Z|[+-]\d\d:\d\d)$/i.test(time) && Number.isFinite(Date.parse(time))) {
      return { timestamp: Date.parse(time), minutePrecision: false };
    }
    for (const element of root.querySelectorAll('[title]')) {
      const timestamp = rules.mailTooltipTimestamp(element.title);
      if (Number.isFinite(timestamp)) return { timestamp, minutePrecision: true };
    }
    return {};
  }

  function sender(root) {
    const openedFrom = root.querySelector('.gD[email],.gD[data-hovercard-id]');
    const candidates = openedFrom ? [openedFrom] : [...root.querySelectorAll('[email],[data-hovercard-id]')];
    const addresses = candidates
      .filter(element => !element.closest('[dir="ltr"].a3s'))
      .map(element => (element.getAttribute('email') || element.getAttribute('data-hovercard-id') || '').toLowerCase())
      .filter(address => /^[\w.+-]+@[\w.-]+\.[a-z]+$/i.test(address));
    const distinct = [...new Set(addresses)];
    return distinct.length === 1 ? distinct[0] : '';
  }

  function scan() {
    const main = document.querySelector('[role="main"]');
    const subjects = /(?:Room Booked|Booking Cancelled|Booking Canceled)\s*\(.+?\)\s*@\s*\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[-–]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?\s*\(IST\)/i;
    const thread = [...main.querySelectorAll('h1,h2,[role="heading"]')].map(element => rules.clean(element.innerText))
      .find(label => subjects.test(label));
    const rows = [...main.querySelectorAll('tr,[role="row"]')].filter(element =>
      subjects.test(rules.clean(element.innerText)) && !element.querySelector('tr,[role="row"]'));
    const opened = [...main.querySelectorAll('.adn,[data-roomline-open-message]')].filter(element => element.getClientRects().length > 0);
    const roots = rows.length ? rows : opened;
    const ids = roots.map(stableId).filter(Boolean);
    const messages = [];
    const previews = [];
    for (const root of roots) {
      const text = rules.clean(root.innerText);
      const subject = subjects.exec(text)?.[0] || thread;
      if (!subject) continue;
      const body = root.querySelector('.a3s')?.innerText || root.innerText;
      const metadata = { id: stableId(root), sender: sender(root), ...stamp(root) };
      const booking = rules.parseBooking(subject, body);
      if (booking) messages.push({ ...booking, ...metadata });
      else if (rows.length) {
        const links = [...root.querySelectorAll('[role="link"],a[href]')]
          .filter(link => rules.clean(link.innerText).includes(subject));
        const parsed = rules.parseSubject(subject);
        if (parsed && links.length === 1) previews.push({ ...parsed, ...metadata, link: links[0] });
      }
    }
    const scope = location.pathname + location.hash;
    const complete = !thread && ids.length === roots.length && Boolean(main.querySelector('table,[role="grid"]'));
    const inspected = inspection && scope !== inspection.scope && !rows.length &&
      opened.find(message => stableId(message) === inspection.id && rules.clean(message.querySelector('.a3s')?.innerText));
    return { ids, messages, previews, scope, complete, inspecting: inspected ? inspection.id : null };
  }

  chrome.runtime.onMessage.addListener((message, senderInfo, respond) => {
    if (senderInfo.id !== chrome.runtime.id || !['roomline-mail', 'roomline-inspect-mail', 'roomline-return-mail'].includes(message?.type)) return;
    const account = mailbox();
    if (!account) {
      respond({ ready: false });
      return;
    }
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(account)).then(bytes => {
      const mailboxId = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      if (message.mailboxId && message.mailboxId !== mailboxId) return respond({ ready: false });
      const { previews, ...snapshot } = scan();
      if (message.type === 'roomline-inspect-mail') {
        const candidates = previews.filter(candidate => candidate.id === message.id);
        if (!snapshot.complete || snapshot.scope !== message.scope || candidates.length !== 1) return respond({ ok: false });
        inspection = { id: message.id, scope: snapshot.scope, hash: location.hash };
        candidates[0].link.click();
        return respond({ ok: true });
      }
      if (message.type === 'roomline-return-mail') {
        if (!snapshot.inspecting || snapshot.inspecting !== message.id || inspection?.id !== message.id ||
            inspection.scope !== message.scope) return respond({ ok: false });
        location.hash = inspection.hash;
        inspection = null;
        return respond({ ok: true });
      }
      respond({ ready: true, mailboxId, ...snapshot, previews: previews.map(({ link, ...candidate }) => candidate) });
    }).catch(() => respond({ ready: false }));
    return true;
  });
})();
