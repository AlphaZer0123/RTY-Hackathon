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
<div id="cards"></div><div id="modal"></div>
<script>
let day = '2035-11-19';
const rooms = [{id:'A',name:'Sync Room',tower:'Tower A'},{id:'B',name:'Sync Room',tower:'Tower B'}];
window.sends = []; window.opens = []; window.blockSecond = false; window.openDelay = 0;
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
    cell.onclick=()=>{day='2035-11-'+String(n).padStart(2,'0'); dateField.textContent=label(); cal.remove()};
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
 let selected='';
 for(const time of ['10:00 AM','10:30 AM']){
  const available=time==='10:00 AM'||(room.id==='B'&&!(window.blockSecond&&window.sends.length));
  const slot=document.createElement(available?'button':'p');
  slot.textContent=time;
  if(available){slot.type='button';slot.setAttribute('aria-pressed','false');slot.onclick=()=>{
   for(const button of form.querySelectorAll('#times button'))button.setAttribute('aria-pressed','false');
   slot.setAttribute('aria-pressed','true');selected=time;
  }}
  form.querySelector('#times').append(slot);
 }
 form.querySelector('#cancel').onclick=()=>form.remove();
 form.querySelector('#send').onclick=()=>{
  window.sends.push({room:room.id,date:day,title:form.querySelector('input').value,slot:selected});
  form.remove();
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
 cell.append('Room Booked (Sync Room) @ '+msg.date+' '+msg.start+' - '+msg.end+' (IST) Your meeting has been scheduled. Location '+msg.tower+' Time');
 row.append(cell);document.querySelector('tbody').append(row);
};
</script></body></html>`;

before(async () => {
  profile = await mkdtemp(join(tmpdir(), 'roomline-test-'));
  browser = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1100, height: 820 },
    args: ['--disable-extensions-except=' + app, '--load-extension=' + app,
      '--host-resolver-rules=MAP *.mastersunion.org ~NOTFOUND, MAP mail.google.com ~NOTFOUND']
  });
  await browser.route('https://**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(portalUrl).origin && url.pathname === '/user-dashboard') {
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
async function prepare(page, duration, target = date) {
  await page.getByLabel('Meeting title').fill('Team meeting');
  await page.getByLabel('Date', { exact: true }).fill(target);
  await page.getByLabel('Duration').selectOption(String(duration));
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
    await prepare(tab, 60, next);
    await waitText(tab, '1 available · 2 of 2 checked.');
    assert.deepEqual(await tab.evaluate(() => window.opens), ['A', 'B']);
    assert.equal(await count(tab), 0);
    await result(tab, 'B').click();
    await waitText(tab, '10:00–10:30 IST');
    await waitText(tab, '10:30–11:00 IST');
    assert.match(await tab.locator('#summary').innerText(), /2035-11-20/);
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('stop preserves checked and unchecked rooms without sending', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.evaluate(() => {window.openDelay = 650});
    await prepare(tab, 30);
    await tab.getByRole('button', { name: 'Stop search' }).click();
    await tab.getByText(/Search stopped/).waitFor();
    await tab.getByRole('heading', {name:/Not checked/}).waitFor();
    assert.equal(await count(tab), 0);
  } finally { await tab.close(); }
});

test('30 minute demo sends once and rejects wrong or stale email before confirming the exact one', async () => {
  await reset();
  const tab = await page();
  try {
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

test('60 minute demo verifies both intervals with exactly two chronological sends', async () => {
  await reset();
  const tab = await page();
  try {
    await tab.setViewportSize({ width: 390, height: 820 });
    assert.equal(await tab.locator('#drawer').evaluate(drawer => drawer.getBoundingClientRect().right <= innerWidth), true);
    await prepare(tab, 60);
    await result(tab, 'B').focus();
    await result(tab, 'B').press('Enter');
    await tab.getByRole('button', { name: 'Book this room' }).press('Enter');
    await sends(tab, 1);
    await deliver();
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
