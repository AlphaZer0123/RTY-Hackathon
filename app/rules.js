(() => {
  const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const key = value => clean(value).toLowerCase().replace(/[–—]/g, '-');
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const pad = value => String(value).padStart(2, '0');

  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value;
  }

  function dateLabel(value) {
    const label = clean(value);
    if (validDate(label)) return label;
    const dayFirst = /^(\d{1,2}) ([a-z]+) (\d{4})$/i.exec(label);
    const monthFirst = /^([a-z]+) (\d{1,2})[-, ]\s*(\d{4})$/i.exec(label);
    if (!dayFirst && !monthFirst) return '';
    const month = (dayFirst?.[2] ?? monthFirst[1]).slice(0, 3).toLowerCase();
    if (!months.includes(month)) return '';
    const date = (dayFirst ?? monthFirst)[3] + '-' + pad(months.indexOf(month) + 1) + '-' + pad(dayFirst?.[1] ?? monthFirst[2]);
    return validDate(date) ? date : '';
  }

  function minute(value) {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(clean(value));
    if (!match) return -1;
    const hour = Number(match[1]);
    const minutes = Number(match[2]);
    const meridiem = match[3]?.toUpperCase();
    if (minutes > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return -1;
    return (meridiem ? hour % 12 + (meridiem === 'PM' ? 12 : 0) : hour) * 60 + minutes;
  }

  function time(value) {
    return pad(Math.floor(value / 60)) + ':' + pad(value % 60);
  }

  function mailTooltipTimestamp(value) {
    const text = clean(value).replace(/^[a-z]+,\s*/i, '');
    const dayFirst = /^(\d{1,2}) ([a-z]+) (\d{4}),?\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)$/i.exec(text);
    const monthFirst = /^([a-z]+) (\d{1,2}),? (\d{4}),?\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)$/i.exec(text);
    if (!dayFirst && !monthFirst) return NaN;
    const [day, month] = dayFirst ? [dayFirst[1], dayFirst[2]] : [monthFirst[2], monthFirst[1]];
    const date = dateLabel([day, month, (dayFirst ?? monthFirst)[3]].join(' '));
    const slot = minute((dayFirst ?? monthFirst)[4]);
    return date && slot >= 0 ? Date.parse(date + 'T' + time(slot) + ':00') : NaN;
  }

  function startsAfter(date, start, now = Date.now()) {
    return Date.parse(date + 'T' + time(start) + ':00+05:30') > now;
  }

  function meeting({ date, start, duration, title }, now = Date.now()) {
    if (!validDate(date)) throw new Error('Choose a valid date.');
    const startMinute = minute(start);
    if (startMinute < 0 || startMinute % 15) throw new Error('Choose a start time on a quarter hour.');
    if (!Number.isInteger(duration) || duration < 30 || duration % 30) {
      throw new Error('Choose an end time at least 30 minutes after the start, in 30-minute increments.');
    }
    if (startMinute + duration >= 1440) throw new Error('Choose a time that ends before midnight.');
    if (!startsAfter(date, startMinute, now)) throw new Error('Choose a future time in IST.');
    title = clean(title);
    if (!title || title.length > 100) throw new Error('Enter a meeting title of 1 to 100 characters.');
    const parts = Array.from({ length: duration / 30 }, (_, index) => {
      const start = startMinute + index * 30;
      return { start, end: start + 30 };
    });
    return { date, title, duration, parts };
  }

  function overlap(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  function conflicts(runs, room, date, part) {
    return runs.some(run =>
      run.room.id === room.id && run.date === date &&
      run.parts.some(previous => ['pending', 'confirmed'].includes(previous.state) && overlap(previous, part))
    );
  }

  function matchingIdentity(candidate, run, part) {
    return Boolean(candidate.id && !part.baseline?.includes(candidate.id) &&
      candidate.sender === 'noreply@mastersunion.org' && candidate.kind === 'booked' &&
      candidate.date === run.date && key(candidate.room) === key(run.room.name) &&
      candidate.start === part.start && candidate.end === part.end &&
      Number.isFinite(candidate.timestamp) && candidate.timestamp <= Date.now() + 60000 &&
      candidate.timestamp >= (candidate.minutePrecision && part.baselineComplete
        ? Math.floor(part.grantedAt / 60000) * 60000
        : part.grantedAt));
  }

  function confirmation(candidate, run, part) {
    const locations = [run.room.tower, run.room.emailLocation].filter(Boolean).map(key);
    return matchingIdentity(candidate, run, part) && locations.includes(key(candidate.location));
  }

  function parseSubject(subject) {
    const match = /^(Room Booked|Booking Cancelled|Booking Canceled)\s*\((.+)\)\s*@\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*[-–]\s*(\d{1,2}:\d{2}(?:\s*[AP]M)?)\s*\(IST\)/i.exec(clean(subject));
    if (!match || !validDate(match[3])) return null;
    const start = minute(match[4]);
    const end = minute(match[5]);
    if (start < 0 || end <= start) return null;
    return { kind: /^room booked$/i.test(match[1]) ? 'booked' : 'cancelled', room: match[2], date: match[3], start, end };
  }

  function parseBooking(subject, body) {
    const booking = parseSubject(subject);
    if (!booking) return null;
    const flat = clean(body);
    const legacy = /\bLocation[.:]?\s+(Tower\s+.+?)(?=\s+Time\b|\s+Date\b|\s+Room Name\b|$)/i.exec(flat)?.[1];
    const preview = /\(IST\)\s+Tower:\s*(.+?)\s+Best regards,/i.exec(flat)?.[1];
    const towerFields = [...String(body ?? '').matchAll(/^[ \t]*Tower:[ \t]*(\S[^\r\n]*)/gim)]
      .map(field => field[1].split(/\s+Best regards,/i)[0]);
    const towers = [...towerFields, preview].filter(Boolean)
      .map(tower => 'Tower ' + clean(tower).replace(/^Tower\s+/i, ''));
    const locations = [legacy, ...towers].filter(Boolean).map(label => clean(label).replace(/\.$/, ''));
    return new Set(locations.map(key)).size === 1 ? { ...booking, location: locations[0] } : null;
  }

  const rules = { clean, key, validDate, dateLabel, minute, time, mailTooltipTimestamp, startsAfter, meeting, overlap, conflicts, matchingIdentity, confirmation, parseSubject, parseBooking };
  globalThis.RoomlineRules = rules;
  if (typeof module !== 'undefined') module.exports = rules;
})();
