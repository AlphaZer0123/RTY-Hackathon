(() => {
  const rules = globalThis.RoomlineRules;
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
    for (const root of roots) {
      const text = rules.clean(root.innerText);
      const subject = subjects.exec(text)?.[0] || thread;
      if (!subject) continue;
      const body = root.querySelector('.a3s')?.innerText || root.innerText;
      const booking = rules.parseBooking(subject, body);
      if (booking) messages.push({ ...booking, id: stableId(root), sender: sender(root), ...stamp(root) });
    }
    return { ids, messages, scope: location.pathname + location.hash, complete: !thread && ids.length === roots.length };
  }

  chrome.runtime.onMessage.addListener((message, senderInfo, respond) => {
    if (senderInfo.id !== chrome.runtime.id || message?.type !== 'roomline-mail') return;
    const account = mailbox();
    if (!account) {
      respond({ ready: false });
      return;
    }
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(account)).then(bytes => {
      const mailboxId = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
      respond({ ready: true, mailboxId, ...scan() });
    }).catch(() => respond({ ready: false }));
    return true;
  });
})();
