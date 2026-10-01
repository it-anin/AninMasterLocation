#!/usr/bin/env node
/**
 * Driver ของ skill run-aninmaster-location
 *
 * ขับเบราว์เซอร์จริง (Chrome / Edge ที่ลงไว้ในเครื่อง ผ่าน playwright-core — ไม่โหลดเบราว์เซอร์เพิ่ม)
 * ล็อกอิน → ทำตาม step ที่สั่งทีละอัน → พิมพ์สิ่งที่เห็นบนจอ + query ที่ยิงไป Supabase + ภาพหน้าจอ
 * ออกด้วย code 1 ถ้ามี query ของ Supabase ตอบ >= 400 หรือหน้าเว็บ throw error → ใช้เป็น smoke test ได้
 *
 * ใช้: node .claude/skills/run-aninmaster-location/driver.mjs [options] step...   (ดู --help)
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HELP = `node driver.mjs [options] step [step...]

options
  --mode pda|desktop  pda = ?android=1 จอ 480x800 (ค่าเริ่มต้น) · desktop = จอ 1280x800
  --url <url>         ค่าเริ่มต้น http://localhost:5173 · เว็บจริง = https://anin-masterlocation.vercel.app
  --code <รหัส>       ค่าเริ่มต้น 1234 = packing (ดูอย่างเดียว) · 0000 = admin (มีปุ่มแก้ → เขียนฐานจริงได้)
  --delay <ms>       หน่วงต่อตัวอักษรตอนพิมพ์ (ค่าเริ่มต้น 30)
  --out <dir>         โฟลเดอร์เก็บภาพ (ค่าเริ่มต้น <tmp>/aninloc-shots)
  --max <n>           ตัดข้อความผลลัพธ์ที่ n ตัวอักษร (ค่าเริ่มต้น 300)

steps (ทำตามลำดับ · ไม่ใส่เลย = ล็อกอินแล้วถ่ายภาพหน้าแรก)
  type:<ข้อความ>   ล้างช่องค้นหา → พิมพ์ → Enter → รอผล → รายงาน
  keys:<ข้อความ>   พิมพ์อย่างเดียว ไม่กด Enter (ใช้ประกอบกับ wait / press)
  press:<ปุ่ม>     กดปุ่ม (เช่น press:Enter) → รอผล → รายงาน
  scan:<รหัส>      ส่ง CustomEvent 'loc-scan' เหมือนที่ MainActivity.kt ทำ — เฉพาะ --mode pda
  click:<css>      คลิกตัวเลือก CSS → รอผล → รายงาน
  focus | blur     ย้าย focus เข้า/ออกจากช่องค้นหา (blur = จำลองกรณีช่องไม่ได้ focus)
  wait:<ms>        หน่วงเวลา
  shot:<ชื่อ>      ถ่ายภาพเพิ่ม

env
  CHROME_PATH      path ของ chrome/msedge ถ้าหาเองไม่เจอ (ปกติลองช่อง chrome แล้ว msedge ให้เอง)`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

const { values: opt, positionals: steps } = parseArgs({
  allowPositionals: true,
  options: {
    mode: { type: 'string', default: 'pda' },
    url: { type: 'string', default: 'http://localhost:5173' },
    code: { type: 'string', default: '1234' },
    delay: { type: 'string', default: '30' },
    out: { type: 'string', default: path.join(os.tmpdir(), 'aninloc-shots') },
    max: { type: 'string', default: '300' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opt.help) {
  console.log(HELP);
  process.exit(0);
}

const MODES = {
  pda: { android: true, viewport: { width: 480, height: 800 }, input: '.scan-input', body: '.result-area' },
  desktop: { android: false, viewport: { width: 1280, height: 800 }, input: '.dsearch-input', body: '.dsearch-body' },
};
const mode = MODES[opt.mode];
if (!mode) fail(`--mode ต้องเป็น pda หรือ desktop (ได้ "${opt.mode}")`);

const KNOWN = ['type', 'keys', 'press', 'scan', 'click', 'focus', 'blur', 'wait', 'shot'];
if (steps.length === 0) steps.push('shot:home');
for (const s of steps) {
  const cmd = s.split(':')[0];
  if (!KNOWN.includes(cmd)) fail(`step ไม่รู้จัก: "${s}" (ดู --help)`);
  if (cmd === 'scan' && !mode.android) fail('scan: ใช้ได้เฉพาะ --mode pda (หน้า Desktop ไม่ฟัง event ยิงบาร์โค้ด)');
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') throw e;
  // path แบบ / เสมอ — ถ้าเป็น \ ใน bash จะถูกกินเป็น escape แล้วคำสั่งที่ copy ไปรันไม่ได้
  const rel = (path.relative(process.cwd(), here) || '.').split(path.sep).join('/');
  fail(`ไม่พบ playwright-core — รัน \`npm install --prefix ${rel}\` ก่อน`);
}

/** ชื่อ event เดียวกับที่แอปฟังจริง (กฎเหล็กข้อ 5) — อ่านจากซอร์สเพื่อไม่ให้ driver ล้าหลังถ้ามีคนเปลี่ยนชื่อ */
function scanEventName() {
  try {
    const src = fs.readFileSync(path.join(repoRoot, 'src', 'lib', 'useScanner.ts'), 'utf8');
    return /SCAN_EVENT\s*=\s*'([^']+)'/.exec(src)?.[1] ?? 'loc-scan';
  } catch {
    return 'loc-scan';
  }
}

async function launch() {
  if (process.env.CHROME_PATH) {
    return chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
  }
  let last;
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ headless: true, channel });
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`ไม่เจอ Chrome/Edge — ติดตั้ง Chrome หรือตั้ง CHROME_PATH=<path ของ chrome.exe>\n${last?.message ?? ''}`);
}

// ── ติดตาม request ไป Supabase (PostgREST) ───────────────────────────
const isRest = (u) => u.includes('/rest/v1/');
/** หน้าตา query แบบอ่านง่าย: ชื่อ view + filter (ตัด select/order/limit ที่เป็นแค่เสียงรบกวน) */
function prettyQuery(u) {
  const raw = u.split('/rest/v1/')[1] ?? u;
  const i = raw.indexOf('?');
  const table = i < 0 ? raw : raw.slice(0, i);
  let qs = i < 0 ? '' : raw.slice(i + 1);
  try {
    qs = decodeURIComponent(qs);
  } catch {
    /* ปล่อยตามที่ส่งจริง */
  }
  const filters = qs.split('&').filter((p) => p && !/^(select|order|limit)=/.test(p)).join('&');
  return filters ? `${table} ${filters}` : table;
}

const log = []; // { status, q } ตามลำดับที่ response กลับมา
const problems = []; // ทำให้ exit code = 1
const warnings = new Set(); // แสดงแต่ไม่ทำให้ fail
let started = 0;
let inflight = 0;

let browser;
let shotNo = 0;
try {
  browser = await launch();
  const ctx = await browser.newContext({ viewport: mode.viewport });
  const page = await ctx.newPage();

  page.on('request', (r) => {
    if (isRest(r.url())) {
      started++;
      inflight++;
    }
  });
  page.on('requestfinished', (r) => isRest(r.url()) && inflight--);
  page.on('requestfailed', (r) => {
    if (isRest(r.url())) {
      inflight--;
      problems.push(`request ล้มเหลว: ${prettyQuery(r.url())} — ${r.failure()?.errorText}`);
    }
  });
  page.on('response', (r) => {
    const u = r.url();
    if (isRest(u)) log.push({ status: r.status(), q: prettyQuery(u) });
    if (r.status() >= 400) {
      // query ของ Supabase พัง = แอปใช้งานไม่ได้จริง · ไฟล์อื่น (เช่น /favicon.ico) แค่เตือน
      if (isRest(u)) problems.push(`HTTP ${r.status()} ${prettyQuery(u)}`);
      else warnings.add(`HTTP ${r.status()} ${u}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url ?? '';
    warnings.add(`console.error: ${msg.text()}${where ? ` [${where}]` : ''}`);
  });

  // ── ล็อกอิน ────────────────────────────────────────────────────────
  const target = new URL(opt.url);
  if (mode.android) target.searchParams.set('android', '1');
  // หน้าเว็บ throw ตอนโหลด (เช่น VITE_SUPABASE_URL ว่าง → "supabaseUrl is required.") = หน้าขาว ไม่มีวันขึ้นหน้าล็อกอิน
  // ล้มทันทีพร้อมสาเหตุ ดีกว่ารอ 20 วินาทีแล้วได้ timeout ของ Playwright
  // ⚠️ ต้องผูกก่อน goto — error เกิดระหว่างโหลด ถ้าผูกทีหลังจะพลาด · .catch เปล่า กัน unhandled rejection ก่อนถึง race
  const crashed = new Promise((_, reject) =>
    page.once('pageerror', (e) =>
      reject(new Error(`หน้าเว็บ error ตั้งแต่โหลด จึงไม่ขึ้นหน้าล็อกอิน: ${e.message} — ถ้าเป็น "supabaseUrl is required" แปลว่า VITE_SUPABASE_URL ว่าง (ดู .env แล้วรัน dev server ใหม่)`))
    )
  );
  crashed.catch(() => {});
  await page.goto(target.href);
  await Promise.race([page.waitForSelector('input[type=password], .setup-note', { timeout: 20000 }), crashed]);
  if (await page.locator('.setup-note').count()) {
    throw new Error('แอปขึ้น "ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล" — ขาด VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน .env');
  }
  await page.fill('input[type=password]', opt.code);
  await page.click('button[type=submit]');
  await page.waitForSelector(`${mode.input}, .dialog-error`, { timeout: 20000 });
  if (await page.locator('.dialog-error').count()) throw new Error(`รหัสไม่ถูกต้อง: "${opt.code}"`);
  await page.focus(mode.input);

  const who = (await page.locator('.staff').innerText()).trim();
  console.log(`เข้าระบบแล้ว · ${opt.mode} ${mode.viewport.width}x${mode.viewport.height} · ${target.href} · ${who}`);

  // ── ตัวช่วยของ step ────────────────────────────────────────────────
  const delay = Number(opt.delay);
  const max = Number(opt.max);
  const scanEvent = scanEventName();

  /** รอผลของ step: request แรกต้องออกไป → ไม่มี request ค้าง 350ms → ข้อความ "กำลังค้นหา" หายไป */
  async function settle(startedBefore) {
    const t0 = Date.now();
    while (started === startedBefore && Date.now() - t0 < 1500) await page.waitForTimeout(25);
    let idleSince = 0;
    while (Date.now() - t0 < 15000) {
      if (inflight === 0) {
        idleSince ||= Date.now();
        if (Date.now() - idleSince > 350) break;
      } else {
        idleSince = 0;
      }
      await page.waitForTimeout(25);
    }
    await page
      .waitForFunction((sel) => !document.querySelector(sel)?.innerText.includes('กำลังค้นหา'), mode.body, { timeout: 5000 })
      .catch(() => {});
  }

  // \p{M} = วรรณยุกต์/สระลอยของภาษาไทย — ไม่ใส่ ชื่อไฟล์ "ยาแก้" จะกลายเป็น "ยาแก"
  const slug = (s) => s.replace(/[^\p{L}\p{M}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 40) || 'step';
  // นำหน้าด้วยเวลา (HHMMSS) — รันหลายรอบแล้ว label ซ้ำกัน ภาพจะไม่เขียนทับกัน
  const runId = new Date().toTimeString().slice(0, 8).replace(/:/g, '');
  async function screenshot(label) {
    fs.mkdirSync(opt.out, { recursive: true });
    const file = path.resolve(opt.out, `${runId}-${String(++shotNo).padStart(2, '0')}-${slug(label)}.png`);
    await page.screenshot({ path: file });
    return file;
  }

  async function report(label, mark) {
    const text = (await page.locator(mode.body).innerText()).replace(/\s*\n+\s*/g, ' | ').trim();
    const qs = log.slice(mark).filter((x) => !x.q.startsWith('v_warehouse_map'));
    console.log(`▶ ${label}`);
    console.log(`  ผล   : ${text.slice(0, max)}${text.length > max ? ' …' : ''}`);
    console.log(`  query: ${qs.length ? qs.map((x) => `${x.status} ${x.q}`).join('  ·  ') : '(ไม่มี)'}`);
    console.log(`  ภาพ  : ${await screenshot(label)}`);
  }

  // ── รัน step ตามลำดับ ──────────────────────────────────────────────
  for (const step of steps) {
    const i = step.indexOf(':');
    const cmd = i < 0 ? step : step.slice(0, i);
    const arg = i < 0 ? '' : step.slice(i + 1);
    const mark = log.length;
    const before = started;

    switch (cmd) {
      case 'type':
        await page.fill(mode.input, ''); // หน้า Desktop ไม่ล้างช่องให้หลังค้น — ล้างเองไม่งั้นต่อท้ายของเดิม
        await page.keyboard.type(arg, { delay });
        await page.keyboard.press('Enter');
        await settle(before);
        await report(step, mark);
        break;
      case 'keys':
        await page.keyboard.type(arg, { delay });
        console.log(`▶ ${step}`);
        break;
      case 'press':
        await page.keyboard.press(arg || 'Enter');
        await settle(before);
        await report(step, mark);
        break;
      case 'scan':
        await page.evaluate(([ev, code]) => window.dispatchEvent(new CustomEvent(ev, { detail: code })), [scanEvent, arg]);
        await settle(before);
        await report(step, mark);
        break;
      case 'click':
        await page.click(arg);
        await settle(before);
        await report(step, mark);
        break;
      case 'focus':
        await page.focus(mode.input);
        console.log(`▶ ${step}`);
        break;
      case 'blur':
        await page.click('.brand');
        console.log(`▶ ${step} · activeElement = ${await page.evaluate(() => document.activeElement?.tagName)}`);
        break;
      case 'wait':
        await page.waitForTimeout(Number(arg) || 0);
        console.log(`▶ ${step}`);
        break;
      case 'shot':
        console.log(`▶ ${step}\n  ภาพ  : ${await screenshot(arg || 'shot')}`);
        break;
    }
  }
} catch (e) {
  problems.push(e.message);
} finally {
  await browser?.close();
}

for (const w of warnings) console.log(`เตือน : ${w}`);
for (const p of problems) console.log(`ผิดพลาด: ${p}`);
process.exit(problems.length ? 1 : 0);

function fail(msg) {
  console.error(msg);
  process.exit(2);
}
