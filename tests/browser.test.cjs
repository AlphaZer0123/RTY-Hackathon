const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { mkdtemp, rm } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const portalUrl = 'https://www.cowork.mastersunion.org/user-dashboard';
const gmailUrl = 'https://mail.google.com/mail/u/0/#inbox';
const date = '2035-11-19';
const next = '2035-11-20';
const app = resolve(__dirname, '../app');
let browser, profile, inbox, worker;
let rehearsals = 0;

const portal = `<!DOCTYPE html><html><head><title>CoWork fixture</title><style>
body{font-family:sans-serif} button{padding:6px} .room{margin:10px;padding:10px;border:1px solid #ccc}
form{position:absolute;top:110px;left:10px;background:#fff;border:2px solid #000;padding:14px}
.day{display:inline-block;padding:5px}
</style></head><body>
<div data-room-toolbar><button>All Rooms</button><button>My Bookings</button>
<div><div id="date-trigger"><p id="date">19 Nov 2035</p></div></div><p>Capacity</p><p>Tower</p><p>CoWork</p></div>
<div id="cards"></div><div id="modal"></div><section id="history-view" hidden><input placeholder="Search bookings..."><button>Upcoming Bookings</button><button>Past Bookings</button></section>
<script>
let day = '2035-11-19';
const rooms = [{id:'A',name:'Sync Room',tower:'Tower A'},{id:'B',name:'Sync Room',tower:'Tower B'}];
window.sends = []; window.opens = []; window.blockSecond = false; window.blockFirst = false; window.styledControls = false; window.openDelay = 0; window.roomLoadDelay = 0; window.redirectAfterSend = false; window.extendedHours = false;
document.querySelector('[data-room-toolbar] button').onclick = () => {
 document.querySelector('#history-view').hidden=true;
 document.querySelector('#cards').hidden=false;
};
const label = () => day.slice(8) + ' Nov 2035';
const dateField = document.querySelector('#date');
document.querySelector('#date-trigger').onclick = () => {
  const parent = dateField.parentNode.parentNode;
  const old=parent.querySelector('#calendar');
  if (old) {old.remove();return}
  const cal=document.createElement('div');
  cal.id='calendar';
  cal.innerHTML='<div><svg width="8" height="8"></svg><p>November 2035</p><svg width="8" height="8"></svg></div><div id="days"></div>';
  for(let n=1;n<=30;n++){
    const cell=document.createElement('button');cell.className='day';cell.textContent=n;
    cell.onclick=()=>{day='2035-11-'+String(n).padStart(2,'0'); dateField.textContent=label(); cal.remove();
      if(window.roomLoadDelay){
        const cards=document.querySelector('#cards');
        cards.hidden=true;
        setTimeout(()=>{cards.hidden=false},window.roomLoadDelay);
      }
    };
    cal.querySelector('#days').append(cell);
  }
  parent.append(cal);
};
for(const room of rooms){
 const card=document.createElement('div');
 card.className='room';card.setAttribute('data-room-card','');card.dataset.roomId=room.id;
 card.innerHTML='<p>'+room.name+'</p><p>'+room.tower+'</p><p>4 Seats</p><button>View &amp; Book Slots</button>';
 card.querySelector('button').onclick=()=>setTimeout(()=>open(room),window.openDelay);
 document.querySelector('#cards').append(card);
}
function open(room){
 window.opens.push(room.id);
 const form=document.createElement('form');
 form.innerHTML='<p>'+room.name+'</p><p>'+room.tower+'</p><p>4 Seats</p><button type="button" aria-pressed="true">30 Mins.</button><button type="button">Nov '+day.slice(8)+'-2035</button><input placeholder="Enter meeting title"><p>AVAILABLE SLOTS</p><div id="times"></div><button type="button" id="cancel">Cancel</button><button type="button" id="send">Request Slot</button>';
 const duration = form.querySelector('[aria-pressed]');
 if(window.styledControls){
  duration.removeAttribute('aria-pressed');
  duration.className='fxhqIv';
 }
 let selected='';
 const times = window.extendedHours ? Array.from({length:14}, (_,index) => {
  const hour=10+Math.floor(index/2);
  return (hour%12||12)+(index%2?':30 ':':00 ')+(hour<12?'AM':'PM');
 }) : ['10:00 AM','10:30 AM'];
 for(const time of times){
  const available=time==='10:00 AM'?!window.blockFirst:(room.id==='B'&&!(window.blockSecond&&window.sends.length));
  const slot=document.createElement(available?'button':'p');
  slot.textContent=time;
  if(available){slot.type='button';
   if(window.styledControls) slot.className='eHrrZt';
   else slot.setAttribute('aria-pressed','false');
   slot.onclick=()=>{
    for(const button of form.querySelectorAll('#times button')){
     if(window.styledControls) button.className='eHrrZt';
     else button.setAttribute('aria-pressed','false');
    }
    if(window.styledControls) slot.className='dydyaH';
    else slot.setAttribute('aria-pressed','true');
    selected=time;
   }
  }
  form.querySelector('#times').append(slot);
 }
 form.querySelector('#cancel').onclick=()=>form.remove();
 form.querySelector('#send').onclick=()=>{
  window.sends.push({room:room.id,date:day,title:form.querySelector('input').value,slot:selected});
  form.remove();
  if(window.redirectAfterSend){
   document.querySelector('#cards').hidden=true;
   document.querySelector('#history-view').hidden=false;
  }
 };
 document.querySelector('#modal').append(form);
}
</script></body></html>`;

const gmail = `<!DOCTYPE html><html><head><title>Gmail fixture</title></head>
<body><button aria-label="Google Account: Test (fixture@mastersunion.org)">Account</button><main role="main"><table><tbody></tbody></table></main>
<script>
window.deliver = (msg) => {
 const row=document.createElement('tr');row.setAttribute('data-legacy-last-message-id',msg.id);
 const cell=document.createElement('td');
 const sender=document.createElement('span');sender.setAttribute('email',msg.sender||'noreply@mastersunion.org');cell.append(sender);
 const time=document.createElement('time');time.dateTime=msg.timestamp;cell.append(time);
 const subject='Room Booked (Sync Room) @ '+msg.date+' '+msg.start+' - '+msg.end+' (IST)';
 const preview=msg.inline ? ' Your room has been booked successfully. Room: Sync Room Date: '+msg.date+' Time: '+msg.start+' - '+msg.end+' (IST) Tower: '+msg.tower.replace(/^Tower /,'')+' Best regards, Masters’ Union' : ' Your meeting has been scheduled. Location '+msg.tower+' Time';
 if(msg.openBody){
  const link=document.createElement('div');link.setAttribute('role','link');link.textContent=subject+' Incomplete preview';
  link.onclick=()=>{
   const main=document.querySelector('main');
   const list=main.querySelector('table');
   location.hash='inbox/'+msg.id;
   main.innerHTML='<h2>'+subject+'</h2><article class="adn" data-legacy-message-id="'+msg.id+'"><span class="gD" email="'+(msg.sender||'noreply@mastersunion.org')+'">CoWork</span><time datetime="'+msg.timestamp+'"></time><div class="a3s">'+msg.openBody+'</div></article>';
   const returnToList=()=>{if(location.hash==='#inbox'){main.replaceChildren(list);removeEventListener('hashchange',returnToList)}};
   addEventListener('hashchange',returnToList);
  };
  cell.append(link);
 } else cell.append(subject+preview);
 row.append(cell);document.querySelector('tbody').append(row);
};
</script></body></html>`;

before(async () => {
  profile = await mkdtemp(join(tmpdir(), 'roomline-test-'));
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: process.env.ROOMLINE_HEADED !== '1', viewport: { width: 1100, height: 820 },
    args: ['--disable-extensions-except=' + app, '--load-extension=' + app,
      '--host-resolver-rules=MAP *.mastersunion.org ~NOTFOUND, MAP mail.google.com ~NOTFOUND']
  });
  await browser.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(portalUrl).origin && ['/user-dashboard', '/launch'].includes(url.pathname)) {
      return route.fulfill({ contentType: 'text/html', body: portal });
    }
    if (url.origin === new URL(gmailUrl).origin && url.pathname === '/mail/u/0/') {
      return route.fulfill({ contentType: 'text/html', body: gmail });
    }
    return route.abort();
  });
  worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  inbox = await browser.newPage();
  await inbox.goto(gmailUrl);
});
after(async () => {
  await browser?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function reset() {
  await worker.evaluate(() => chrome.storage.local.clear());
  await inbox.reload();
}
async function page() {
  const page = await browser.newPage();
  await page.goto(portalUrl);
  await page.getByRole('button', { name: 'Roomline', exact: true }).click();
  return page;
}
const asTime = minutes => [Math.floor(minutes / 60), minutes % 60].map(value => String(value).padStart(2, '0')).join(':');
async function prepare(page, duration, target = date) {
  await page.getByLabel('Meeting title').fill('Team meeting');
  await page.getByLabel('Date', { exact: true }).fill(target);
  await page.getByLabel('End time IST').fill(asTime(600 + duration));
  await page.getByRole('button', { name: 'Search rooms' }).click();
}
function result(page, tower) {
  return page.getByRole('button', { name: new RegExp('Sync Room.*Tower ' + tower + '.*Select') });
}
async function deliver(start = '10:00', end = '10:30', extras = {}) {
  await inbox.evaluate(message => window.deliver(message), {
    id: 'message-' + Math.random(), timestamp: new Date(Date.now() + 5).toISOString(), date,
    start, end, tower: 'Tower B', ...extras
  });
}
const count = page => page.evaluate(() => window.sends.length);
async function waitText(page, text) {
  await page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor();
}
async function sends(page, n) {
  await page.waitForFunction(length => window.sends.length === length, n);
}

test('search changes the date, checks duplicate-name rooms and sends zero requests', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {window.roomLoadDelay = 800});
    await prepare(tab, 60, next);
    await waitText(tab, '1 available · 2 of 2 checked.');
    assert.deepEqual(await tab.evaluate(() => window.opens), ['A', 'B']);
    assert.equal(await count(tab), 0);
    await result(tab, 'B').click();
    await waitText(tab, '10:00–10:30 IST');
    await waitText(tab, '10:30–11:00 IST');
    assert.match(await tab.locator('#summary').innerText(), /2035-11-20/);
    if (process.env.ROOMLINE_PREVIEW) await tab.locator('#drawer').screenshot({ path: process.env.ROOMLINE_PREVIEW });
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('stop preserves checked and unchecked rooms without sending', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {
      window.openDelay = 600;
      const third = document.querySelector('[data-room-id="B"]').cloneNode(true);
      third.dataset.roomId = 'C';
      third.querySelector('p').textContent = 'Third Room';
      document.querySelector('#cards').append(third);
    });
    await prepare(tab, 30);
    await waitText(tab, 'Checked 1 of 3 rooms.');
    await tab.getByRole('button', { name: 'Stop search' }).click();
    await tab.getByText(/Search stopped/).waitFor();
    await tab.getByRole('heading', {name:/Not checked/}).waitFor();
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('30 minute demo uses observed CoWork style markers and requires exact fresh email', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {window.styledControls = true});
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await deliver('10:00', '10:30', {timestamp: '2020-01-01T00:00:00Z'});
    await tab.getByRole('button', { name: 'Book this room' }).evaluate(button => {button.click();button.click()});
    await sends(tab, 1);
    await deliver('10:00', '10:30', {tower: 'Tower A'});
    await waitText(tab, 'Pending confirmation');
    await deliver();
    await waitText(tab, 'Confirmed by email');
    assert.deepEqual(await tab.evaluate(() => window.sends), [{room: 'B', date, title: 'Team meeting', slot: '10:00 AM'}]);
    rehearsals++;
  } finally { await tab.close(); }
});

test('60 minute demo sends second only after email and records partial completion', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 60);
    await result(tab, 'B').click();
    await tab.evaluate(() => {window.blockSecond = true});
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    assert.equal(await count(tab), 1);
    await deliver();
    await waitText(tab, 'Confirmed by email');
    await waitText(tab, 'Unavailable');
    assert.equal(await count(tab), 1);
    await tab.reload();
    await tab.getByRole('button', { name: 'Roomline', exact: true }).click();
    await tab.getByRole('button', { name: 'Check saved booking' }).click();
    await waitText(tab, 'Confirmed by email');
    await waitText(tab, 'Unavailable');
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('60 minute demo returns from CoWork history and sends two chronological requests', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {window.redirectAfterSend = true});
    await tab.setViewportSize({ width: 390, height: 820 });
    assert.equal(await tab.locator('#drawer').evaluate(drawer => drawer.getBoundingClientRect().right <= innerWidth), true);
    await prepare(tab, 60);
    await result(tab, 'B').focus();
    await result(tab, 'B').press('Enter');
    await tab.getByRole('button', { name: 'Book this room' }).press('Enter');
    await sends(tab, 1);
    await inbox.evaluate(({ date, timestamp }) => {
      location.hash = 'inbox/hour-first';
      document.querySelector('main').innerHTML = '<h2>Room Booked (Sync Room) @ ' + date + ' 10:00 - 10:30 (IST)</h2>' +
        '<article class="adn" data-legacy-message-id="hour-first"><span class="gD" email="noreply@mastersunion.org">CoWork</span>' +
        '<time datetime="' + timestamp + '"></time><div class="a3s">Tower: B</div></article>';
    }, { date, timestamp: new Date(Date.now() + 5).toISOString() });
    await waitText(tab, 'Return to your Gmail inbox. Roomline will then send the next reviewed request.');
    assert.equal(await count(tab), 1);
    await inbox.goto(gmailUrl);
    await inbox.reload();
    await sends(tab, 2);
    await deliver('10:30', '11:00');
    await waitText(tab, 'All requests confirmed.');
    assert.deepEqual((await tab.evaluate(() => window.sends)).map(item => item.slot), ['10:00 AM', '10:30 AM']);
    rehearsals++;
    assert.equal(rehearsals, 2);
  } finally { await tab.close(); }
});

test('competing tabs cannot each submit the same room and interval', async () => {
  await reset();
  const first = await page();
  const second = await page();
  try {
    for (const tab of [first, second]) {
      await prepare(tab, 30);
      await result(tab, 'B').click();
    }
    await first.getByRole('button', { name: 'Book this room' }).click();
    await sends(first, 1);
    await second.getByRole('button', { name: 'Book this room' }).click();
    await second.getByText('A booking is running in another Roomline tab.').waitFor();
    assert.equal(await count(second), 0);
    await first.getByRole('button', { name: 'Stop remaining' }).click();
    await first.getByRole('button', { name: 'Check email again' }).waitFor();
    await deliver();
    await first.getByRole('button', { name: 'Check email again' }).click();
    await waitText(first, 'Confirmed by email');
    assert.equal(await count(first), 1);
  } finally { await first.close(); await second.close(); }
});

test('a date change after review blocks submission', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.evaluate(() => {document.querySelector('#date').textContent='20 Nov 2035'});
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await tab.getByText(/The CoWork date, filters, or room view changed/).waitFor();
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('Chrome storage failure at the send grant produces no click', async () => {
  await reset();
  const tab = await page();
  await worker.evaluate(() => {
    const storage = chrome.storage.local;
    const set = storage.set.bind(storage);
    storage.set = async records => {
      if (Object.values(records).some(ledger => ledger.runs?.some(run => run.parts.some(part => part.state === 'pending')))) {
        throw new Error('Synthetic storage failure');
      }
      return set(records);
    };
    globalThis.restoreFixtureStorage = () => { storage.set = set; };
  });
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await waitText(tab, 'Synthetic storage failure');
    assert.equal(await count(tab), 0);
    await waitText(tab, 'Not sent');
  } finally {
    await worker.evaluate(() => globalThis.restoreFixtureStorage());
    await tab.close();
  }
});

test('reload after the first send keeps the pending result and recheck cannot resume the hour', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 60);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await tab.reload();
    await tab.getByRole('button', { name: 'Roomline', exact: true }).click();
    await tab.getByRole('button', { name: 'Check saved booking' }).click();
    await waitText(tab, 'Pending confirmation');
    await waitText(tab, 'Not sent');
    await deliver();
    await tab.getByRole('button', { name: 'Check email again' }).click();
    await waitText(tab, 'Confirmed by email');
    await waitText(tab, 'Not sent');
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('missing Gmail blocks the write while search remains available', async () => {
  await reset();
  const tab = await page();
  try {
    await inbox.evaluate(() => document.querySelector('[aria-label*="Google Account"]').remove());
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await waitText(tab, 'Open one signed-in Masters’ Union Gmail tab in this Chrome profile.');
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('an unverified selected-slot marker prevents the portal click', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.evaluate(() => {
      const native = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value) {
        if (this.matches('#times button') && name === 'aria-pressed' && value === 'true') return;
        return native.call(this, name, value);
      };
    });
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await waitText(tab, 'CoWork did not verify the selected time.');
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('an overlapping saved request blocks a new send under a different title', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await deliver();
    await waitText(tab, 'All requests confirmed.');
    await tab.getByRole('button', { name: 'New search' }).click();
    await tab.getByLabel('Meeting title').fill('Different title');
    await tab.getByRole('button', { name: 'Search rooms' }).click();
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await waitText(tab, 'A pending or confirmed Roomline request overlaps this room and time.');
    assert.equal(await count(tab), 1);
  } finally { await tab.close(); }
});

test('opening a live-format email with a minute timestamp resolves an observed incomplete preview', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    const timestamp = new Date(Date.now() + 5).toISOString();
    await inbox.evaluate(({ timestamp, date }) => {
      window.deliver({ id: 'open-email', timestamp, date, start: '10:00', end: '10:30', tower: '' });
    }, { timestamp, date });
    await waitText(tab, 'Pending confirmation');
    for (let attempt = 0; attempt < 12; attempt++) {
      const observed = await worker.evaluate(async () => {
        const state = (await chrome.storage.local.get('roomline-bookings-v1'))['roomline-bookings-v1'];
        return state?.runs.at(-1)?.parts[0].observed?.includes('open-email');
      });
      if (observed) break;
      assert.notEqual(attempt, 11, 'The inbox message ID was never observed');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await inbox.evaluate(({ timestamp, date }) => {
      location.hash = 'inbox/open-email';
      const tooltip = new Intl.DateTimeFormat('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
      }).format(new Date(timestamp));
      document.querySelector('main').innerHTML = '<h2>Room Booked (Sync Room) @ ' + date + ' 10:00 - 10:30 (IST)</h2>' +
        '<article class="adn" data-legacy-message-id="open-email"><span class="gD" email="noreply@mastersunion.org">CoWork</span>' +
        '<span title="' + tooltip + '"></span><div class="a3s"><div>Room: Sync Room</div><div>Date: ' + date +
        '</div><div>Time: 10:00 - 10:30 (IST)</div><div>Tower: B</div><div>Booking policy</div></div></article>';
    }, { timestamp, date });
    await waitText(tab, 'Confirmed by email');
    assert.equal(await count(tab), 1);
  } finally {
    await inbox.goto(gmailUrl);
    await tab.close();
  }
});

test('losing the Gmail account between intervals stops the next send', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 60);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await tab.evaluate(() => {window.openDelay = 900});
    await deliver();
    await waitText(tab, 'Confirmed by email');
    await inbox.evaluate(() => document.querySelector('[aria-label*="Google Account"]').remove());
    await waitText(tab, 'Open the original Masters’ Union Gmail account to continue.');
    await waitText(tab, 'Not sent');
    assert.equal(await count(tab), 1);
  } finally { await tab.close(); }
});

test('a slot taken after search blocks booking before the first send', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.evaluate(() => {window.blockFirst = true});
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await waitText(tab, 'This room no longer fits the full meeting. Search again.');
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('ambiguous duplicate cards stay unchecked while the unique room is still checked', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {
      const duplicate = document.querySelector('[data-room-id="A"]').cloneNode(true);
      document.querySelector('#cards').append(duplicate);
    });
    await prepare(tab, 30);
    await waitText(tab, '1 available · 1 of 3 checked.');
    await waitText(tab, 'Not checked · 2');
    assert.deepEqual(await tab.evaluate(() => window.opens), ['B']);
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('books seven hours from start and end times using exact live-format previews', { timeout: 100000 }, async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {window.extendedHours = true;window.redirectAfterSend = true});
    await prepare(tab, 420);
    await result(tab, 'B').click();
    await waitText(tab, '14 requests. Roomline confirms each by email before it sends the next one.');
    assert.equal(await count(tab), 0);
    await tab.getByRole('button', { name: 'Book this room' }).click();
    for (let index = 0; index < 14; index++) {
      await sends(tab, index + 1);
      assert.equal(await count(tab), index + 1);
      await deliver(asTime(600 + index * 30), asTime(630 + index * 30), { inline: true });
    }
    await waitText(tab, 'All requests confirmed.');
    const payload = await tab.evaluate(() => window.sends);
    assert.equal(payload.length, 14);
    assert.ok(payload.every(item => item.room === 'B' && item.date === date && item.title === 'Team meeting'));
    assert.equal(payload.at(-1).slot, '4:30 PM');
  } finally { await tab.close(); }
});

test('automatically opens a unique incomplete preview and returns to the inbox', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 30);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await deliver('10:00', '10:30', { openBody: 'Tower: B' });
    await waitText(tab, 'All requests confirmed.');
    assert.equal(await inbox.evaluate(() => location.hash), '#inbox');
    assert.equal(await count(tab), 1);
  } finally { await tab.close(); }
});

test('a late email updates the open receipt without sending a stopped interval', async () => {
  await reset();
  const tab = await page();
  try {
    await prepare(tab, 60);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await tab.getByRole('button', { name: 'Stop remaining' }).click();
    await tab.getByText(/^Stopped\./).waitFor();
    await deliver('10:00', '10:30', { inline: true });
    await waitText(tab, 'Confirmed by email');
    await waitText(tab, 'Not sent');
    assert.equal(await count(tab), 1);
  } finally { await tab.close(); }
});

test('a new portal tab mounts once when the launch page changes to the dashboard', async () => {
  await reset();
  const tab = await browser.newPage();
  try {
    await tab.goto(new URL('/launch', portalUrl).href);
    assert.equal(await tab.locator('[data-roomline]').count(), 0);
    await tab.evaluate(() => history.replaceState({}, '', '/user-dashboard'));
    await tab.getByRole('button', { name: 'Roomline', exact: true }).click({ timeout: 4500 });
    assert.equal(await tab.locator('[data-roomline]').count(), 1);
    await prepare(tab, 30);
    await waitText(tab, '2 available · 2 of 2 checked.');
    assert.equal(await count(tab), 0);
    await result(tab, 'B').click();
    await tab.getByRole('button', { name: 'Book this room' }).click();
    await sends(tab, 1);
    await deliver();
    await waitText(tab, 'All requests confirmed.');
    assert.equal(await count(tab), 1);
  } finally { await tab.close(); }
});
