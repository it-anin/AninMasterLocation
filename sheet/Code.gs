/**
 * AninMaster Location — แก้ตำแหน่งสินค้าผ่าน Google Sheet
 *
 * ชีตนี้เป็น "ที่แก้ตำแหน่งที่เดียว" — ส่งค่าเข้า Supabase ทางเดียว (ชีต → DB)
 * ผ่านฟังก์ชัน anin_loc.sheet_apply() ใน supabase/migrations/0006_sheet_sync.sql
 * ไม่มีการดึงตำแหน่งจาก DB กลับมาทับชีต (ยกเว้นเมนูตั้งค่าครั้งแรก / เติมแถวที่หาย)
 *
 * ต้นฉบับอยู่ใน repo ที่ sheet/Code.gs — แก้ที่นั่นแล้ววางทับใน Apps Script editor
 * วิธีติดตั้ง → sheet/README.md
 *
 * ⚠️ ใช้ anon key เท่านั้น ห้ามใช้ service_role key เด็ดขาด
 *    Supabase โปรเจกต์นี้มีฐาน POS ตัวจริง (schema public) อยู่ด้วย
 *    service key ข้าม RLS ได้ทุกตาราง และใครที่เปิด Apps Script ได้จะเห็น key นี้
 *
 * การป้องกันที่ใส่ไว้ (ทุกข้อมาจากปัญหาที่เกิดได้จริงกับสเปรดชีต):
 *   - ตั้งทุกคอลัมน์เป็น "ข้อความ" ก่อนเขียนข้อมูล กัน 0 นำหน้าหาย / 3-1 กลายเป็นวันที่
 *     (Location-WH.csv เคยโดน Excel แปลงบาร์โค้ด 608 แถวเป็น 8.85089E+12 กู้คืนไม่ได้)
 *   - ช่องตำแหน่งที่ชีตแปลงเป็นตัวเลข/วันที่ไปแล้ว → ไม่ส่ง แจ้งให้พิมพ์ใหม่
 *   - เพดานจำนวนการเปลี่ยนต่อครั้ง — เลือกทั้งคอลัมน์แล้วกด Delete หรือ sort คอลัมน์เดียว
 *     จะไม่ลบ/สลับตำแหน่งทั้งคลัง ต้องยืนยันผ่านเมนูก่อน
 *   - ลบทั้งแถวในชีต ≠ ลบตำแหน่งใน DB (รายงานอย่างเดียว)
 */

const SHEET_MAIN = 'ตำแหน่ง';
const SHEET_LOCS = 'รายการตำแหน่ง';
const SHEET_LOG = 'บันทึกซิงก์';

// ⚠️ ทุกคอลัมน์ก่อน LOCATION = ระบบเขียนเอง · LOCATION/NOTE ต้องติดกัน · STATUS/UPDATED ต้องติดกัน
//    ย้ายคอลัมน์ = แก้ 3 บรรทัดนี้ แล้วสร้างแท็บ "ตำแหน่ง" ใหม่ (ดู README หัวข้อเปลี่ยนโครงคอลัมน์)
const COL = { ITEM: 1, BARCODES: 2, NAME: 3, UNITS: 4, CATEGORY: 5, LOCATION: 6, NOTE: 7, STATUS: 8, UPDATED: 9 };
const HEADERS = ['รหัสสินค้า', 'บาร์โค้ด', 'ชื่อสินค้า', 'หน่วย', 'หมวด', 'ตำแหน่ง ✏️', 'หมายเหตุ ✏️', 'สถานะ', 'แก้ล่าสุด'];
const WIDTHS = [100, 170, 320, 110, 140, 110, 180, 270, 210];
const NUM_COLS = HEADERS.length;

/** แก้ในชีตครั้งเดียว (วาง/ลบหลายช่อง) เปลี่ยนได้ไม่เกินนี้ — เกินต้องยืนยันผ่านเมนู */
const EDIT_MAX_CHANGES = 200;
/** ซิงก์อัตโนมัติเปลี่ยนได้ไม่เกินนี้ — ปกติควรเป็น 0 เพราะแก้ในชีตส่งเข้าระบบไปแล้วทันที */
const RECONCILE_MAX_CHANGES = 50;
/** ScriptApp รับได้แค่ 1, 5, 10, 15, 30 */
const RECONCILE_MINUTES = 10;

const DEFAULT_SUPABASE_URL = 'https://sntxojhhtxfrwprmhrhy.supabase.co';
/** Supabase ตัดผลที่ 1,000 แถวต่อ request */
const PAGE = 1000;
const LOG_KEEP = 500;
const EDITOR_FALLBACK = 'google-sheet';
const PROTECT_TAG = 'AninLoc';
const CHANGED = ['insert', 'update', 'delete'];
/** สถานะที่อาจค้างหลังปัญหาหายไปแล้ว — reconcile ขอสถานะใหม่ให้ (ไม่ใส่ FE0F ให้เทียบต้นข้อความได้) */
const STALE_PREFIXES = ['⛔', '⏸', '⚠'];
const BAD_VALUE_MSG =
  '⚠️ ชีตแปลงค่านี้เป็นตัวเลข/วันที่ — ยังไม่ได้บันทึก พิมพ์ตำแหน่งใหม่อีกครั้ง';

const LABELS = [
  ['insert', 'เพิ่มตำแหน่งใหม่'],
  ['update', 'แก้ตำแหน่ง'],
  ['delete', 'ลบตำแหน่ง'],
  ['duplicate', 'รหัสสินค้าซ้ำในชีต (ข้าม)'],
  ['unknown_item', 'ไม่พบรหัสสินค้าในระบบ (ข้าม)'],
  ['missing_from_sheet', 'มีตำแหน่งในระบบแต่ไม่มีแถวในชีต (ไม่ลบ)'],
];


// ═══════════════════════════════════════════════════════════════════
// เมนู
// ═══════════════════════════════════════════════════════════════════

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📦 ตำแหน่ง')
    .addItem('ซิงก์ทั้งหมดตอนนี้', 'syncAllNow')
    .addItem('อัปเดตจากระบบ (สินค้าใหม่ + รายการตำแหน่ง)', 'updateFromDb')
    .addSeparator()
    .addItem('ตั้งค่าครั้งแรก', 'setupFirstTime')
    .addItem('ติดตั้งการซิงก์อัตโนมัติใหม่', 'installTriggers')
    .addToUi();
}

/**
 * ดึงสินค้าทั้งหมดจากระบบมาสร้างชีต — ทำได้ครั้งเดียวตอนแท็บยังว่าง
 * หลังจากนี้ชีตเป็นที่แก้ที่เดียว จะไม่ดึงตำแหน่งจาก DB มาทับอีก
 */
function setupFirstTime() {
  const ui = SpreadsheetApp.getUi();
  cfg_(); // ตรวจ Script Properties ก่อน ไม่งั้นไปพังกลางทาง
  const ss = SpreadsheetApp.getActive();

  let sh = ss.getSheetByName(SHEET_MAIN);
  if (sh && sh.getLastRow() > 1) {
    ui.alert(
      'ตั้งค่าไปแล้ว',
      'แท็บ "ตำแหน่ง" มีข้อมูลอยู่แล้ว — ไม่เขียนทับ\n' +
        'ถ้าต้องการดึงสินค้าใหม่ ใช้เมนู "อัปเดตจากระบบ"',
      ui.ButtonSet.OK
    );
    return;
  }
  if (!sh) {
    // ไฟล์ใหม่มีแท็บว่างมาให้ 1 แท็บ — ใช้แท็บนั้นเลย ไม่ต้องมีแท็บว่างค้าง
    const sheets = ss.getSheets();
    const lone = sheets.length === 1 && sheets[0].getLastRow() === 0 ? sheets[0] : null;
    sh = lone ? lone.setName(SHEET_MAIN) : ss.insertSheet(SHEET_MAIN, 0);
  }

  ss.toast('กำลังดึงข้อมูลจากระบบ…', 'ตั้งค่าครั้งแรก', -1);
  const data = loadFromDb_();
  const rows = data.items.map((it) => sheetRow_(it, data));

  refreshLocationList_(data.locations);
  ensureRows_(sh, rows.length + 1);
  formatSheet_(sh, 1); // ⚠️ ต้องตั้งเป็นข้อความก่อนเขียนข้อมูล ตั้งทีหลังไม่ช่วย
  if (rows.length) sh.getRange(2, 1, rows.length, NUM_COLS).setValues(rows);
  installTriggers_();

  ss.toast('เสร็จแล้ว', 'ตั้งค่าครั้งแรก', 3);
  ui.alert(
    'ตั้งค่าเสร็จ',
    `ดึงสินค้า ${rows.length} รายการ · มีตำแหน่งแล้ว ${Object.keys(data.locById).length} รายการ\n\n` +
      'แก้ได้เฉพาะคอลัมน์ "ตำแหน่ง" และ "หมายเหตุ" — บันทึกเข้าระบบทันทีที่แก้\n' +
      `ซิงก์อัตโนมัติทุก ${RECONCILE_MINUTES} นาที ทำงานในนามบัญชี ${activeEmail_() || 'นี้'}`,
    ui.ButtonSet.OK
  );
}

/**
 * ส่งทั้งชีตเข้าระบบ — ทดลองก่อน ให้ดูจำนวนที่จะเปลี่ยนแล้วค่อยยืนยัน
 * ใช้ตอนที่ซิงก์อัตโนมัติหยุดเพราะเกินเพดาน หรือแก้พร้อมกันหลายร้อยแถวโดยตั้งใจ
 */
function syncAllNow() {
  const ui = SpreadsheetApp.getUi();
  const sh = mainSheet_();
  if (!sh) {
    ui.alert('ยังไม่มีแท็บ "ตำแหน่ง" — ใช้เมนู "ตั้งค่าครั้งแรก" ก่อน');
    return;
  }
  const problem = layoutProblem_(sh);
  if (problem) {
    ui.alert('ซิงก์ทั้งหมด', problem, ui.ButtonSet.OK);
    return;
  }
  const who = activeEmail_() || EDITOR_FALLBACK;

  const dry = apply_(collectRows_(readAll_(sh)).rows, who, { full: true, dryRun: true });
  if (!dry.changes) {
    clearAlert_();
    const issues = issuesText_(dry.counts);
    ui.alert(
      'ซิงก์ทั้งหมด',
      'ชีตกับระบบตรงกันแล้ว ไม่มีอะไรต้องบันทึก' + (issues ? '\n\n' + issues : ''),
      ui.ButtonSet.OK
    );
    return;
  }

  const answer = ui.alert(
    'ซิงก์ทั้งหมด',
    `จะบันทึกลงระบบ ${dry.changes} รายการ\n\n${summary_(dry.counts, '\n')}\n\nยืนยัน?`,
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  let res;
  try {
    // อ่านใหม่ — ระหว่างรอกดยืนยัน อาจมีคนแก้ชีตไปแล้ว
    // ถ้าอ่านรอบนี้จะเปลี่ยนมากกว่าที่ยืนยันไปเยอะ ให้หยุด ไม่เขียนสิ่งที่ผู้ใช้ไม่ได้เห็น
    const block = readAll_(sh);
    const { rows, badIdx } = collectRows_(block);
    res = apply_(rows, who, { full: true, maxChanges: dry.changes + RECONCILE_MAX_CHANGES });
    if (res.applied) {
      mergeStaleStatuses_(block, res);
      writeResults_(sh, 2, block, res, who, badIdx);
      clearAlert_();
      log_('ซิงก์ทั้งหมด', `${who} บันทึก ${res.changes} รายการ · ${summary_(res.counts)}`, false);
    }
  } finally {
    lock.releaseLock();
  }

  ui.alert(
    'ซิงก์ทั้งหมด',
    res.applied
      ? `บันทึกแล้ว ${res.changes} รายการ`
      : `ไม่ได้บันทึก — ระหว่างรอยืนยันมีการแก้ชีตเพิ่มอีกมาก (${res.changes} รายการ) ลองใหม่อีกครั้ง`,
    ui.ButtonSet.OK
  );
}

/**
 * เติมสินค้าที่ยังไม่มีในชีตต่อท้าย + อัปเดตรายการตำแหน่ง (dropdown)
 * ต้องมีเพราะ `npm run import` เพิ่มสินค้าใหม่เข้า DB แต่ชีตไม่รู้เรื่อง
 *
 * ไม่แตะคอลัมน์ตำแหน่ง/หมายเหตุของแถวที่มีอยู่แล้วเด็ดขาด — ชีตเป็นที่แก้ที่เดียว
 * แถวที่เติมใหม่ใช้ตำแหน่งจากระบบ (ถ้ามี) เพราะเป็นแถวที่ถูกลบไปจากชีต
 */
function updateFromDb() {
  const ui = SpreadsheetApp.getUi();
  const sh = mainSheet_();
  if (!sh || sh.getLastRow() < 2) {
    ui.alert('ยังไม่ได้ตั้งค่า — ใช้เมนู "ตั้งค่าครั้งแรก" ก่อน');
    return;
  }
  const problem = layoutProblem_(sh); // แถวใหม่เขียนตามโครงปัจจุบัน — ต่อท้ายชีตโครงเก่าไม่ได้
  if (problem) {
    ui.alert('อัปเดตจากระบบ', problem, ui.ButtonSet.OK);
    return;
  }

  const data = loadFromDb_(); // ดึงนอก lock — ช้า ไม่ต้องให้คนที่กำลังแก้ชีตรอ
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  let fresh;
  try {
    const have = {};
    readAll_(sh).disp.forEach((v) => {
      have[String(v[COL.ITEM - 1]).trim()] = true;
    });
    fresh = data.items.filter((it) => !have[it.item_id]);

    refreshLocationList_(data.locations);
    if (fresh.length) {
      const start = sh.getLastRow() + 1;
      ensureRows_(sh, start + fresh.length - 1);
      formatSheet_(sh, start); // ครอบแถวใหม่ด้วย format/การป้องกัน/dropdown ก่อนเขียน
      sh.getRange(start, 1, fresh.length, NUM_COLS).setValues(fresh.map((it) => sheetRow_(it, data)));
    }
  } finally {
    lock.releaseLock();
  }

  const restored = fresh.filter((it) => data.locById[it.item_id]).length;
  if (fresh.length) {
    log_('อัปเดตจากระบบ', `เพิ่มสินค้าต่อท้าย ${fresh.length} รายการ (เติมแถวที่หาย ${restored})`, false);
  }
  ui.alert(
    'อัปเดตจากระบบ',
    `เพิ่มสินค้าต่อท้ายชีต ${fresh.length} รายการ` +
      (restored
        ? `\n(ในนั้น ${restored} รายการมีตำแหน่งในระบบอยู่แล้ว — เป็นแถวที่ถูกลบจากชีต จึงเติมกลับพร้อมตำแหน่งเดิม)`
        : '') +
      `\nรายการตำแหน่งสำหรับ dropdown ${data.locations.length} ค่า`,
    ui.ButtonSet.OK
  );
}

/** ติดตั้ง trigger ใหม่ — trigger ทำงานในนามคนที่กดเมนูนี้ */
function installTriggers() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.alert(
    'ติดตั้งการซิงก์อัตโนมัติ',
    `การซิงก์จะทำงานในนามบัญชี ${activeEmail_() || 'นี้'}\n` +
      'ถ้าบัญชีนี้ถูกปิดหรือเจ้าของลาออก การซิงก์จะหยุดทั้งหมด — ควรใช้บัญชีกลางของแผนก\n' +
      '⚠️ ให้ติดตั้งคนเดียว ถ้าหลายคนติดตั้ง จะมี trigger ซ้อนกันหลายชุด\n\nติดตั้ง?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;
  installTriggers_();
  ui.alert('ติดตั้งแล้ว');
}


// ═══════════════════════════════════════════════════════════════════
// Triggers
// ═══════════════════════════════════════════════════════════════════

/**
 * แก้ในชีต → ส่งเข้าระบบทันที
 *
 * เป็น installable trigger (ติดตั้งจากเมนู) ไม่ใช่ simple trigger
 * เพราะ simple trigger เรียก UrlFetchApp ไม่ได้
 * ⚠️ ห้ามเปลี่ยนชื่อเป็น onEdit — จะกลายเป็น simple trigger อีกตัวที่รันซ้ำและ error ทุกครั้ง
 *
 * ไม่ทำงานกับ sort / ลบแถว / แก้โดยสคริปต์ — ซิงก์อัตโนมัติ (reconcile) เก็บตกให้
 */
function onEditInstallable(e) {
  const range = e.range;
  const sh = range.getSheet();
  if (sh.getName() !== SHEET_MAIN) return;
  if (range.getLastColumn() < COL.LOCATION || range.getColumn() > COL.NOTE) return;
  const problem = layoutProblem_(sh);
  if (problem) {
    logOnce_('layout', 'แก้ในชีต', problem, true);
    return;
  }

  const first = Math.max(range.getRow(), 2);
  const last = range.getLastRow();
  if (last < first) return;

  const editor = editorOf_(e);
  const lock = LockService.getDocumentLock();
  lock.waitLock(30000); // หมดเวลา = โยน error ไม่บันทึก — reconcile รอบถัดไปเก็บตกให้
  try {
    syncRange_(sh, first, last - first + 1, editor);
  } finally {
    lock.releaseLock();
  }
}

/**
 * ซิงก์อัตโนมัติ — ส่งทั้งชีตทุก 10 นาที
 *
 * เก็บตกสิ่งที่ onEdit ไม่เห็น: sort, ลบแถว, onEdit ล้ม, มีคนแก้ DB ตรง
 * ถ้าจะเปลี่ยนเกินเพดาน → ไม่เขียนอะไรเลย แล้วแจ้งเตือนในแท็บ "บันทึกซิงก์"
 * (sort คอลัมน์ตำแหน่งคอลัมน์เดียว = ตำแหน่งสลับกันทั้งไฟล์ ต้องไม่ถูกเขียนลงระบบ)
 */
function reconcile() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return; // มีคนกำลังแก้/ซิงก์อยู่ รอบหน้าค่อยทำ
  try {
    const sh = mainSheet_();
    if (!sh) return;
    const problem = layoutProblem_(sh);
    logOnce_('layout', 'ซิงก์อัตโนมัติ', problem, true); // ว่าง = ล้างค่าที่จำไว้ ให้เตือนได้อีกถ้าเกิดซ้ำ
    if (problem) return;
    const block = readAll_(sh);
    const { rows, badIdx } = collectRows_(block);
    if (!rows.length) return;

    const res = apply_(rows, EDITOR_FALLBACK, { full: true, maxChanges: RECONCILE_MAX_CHANGES });
    if (!res.applied) {
      logOnce_(
        'reconcile-blocked',
        'ซิงก์อัตโนมัติ',
        `⛔ หยุดซิงก์อัตโนมัติ: ชีตต่างจากระบบ ${res.changes} รายการ (เพดาน ${RECONCILE_MAX_CHANGES}) — ` +
          'อาจเกิดจากการเรียงข้อมูลคอลัมน์เดียว หรือลบทั้งคอลัมน์ ตรวจชีตก่อน ' +
          'ถ้าถูกต้องแล้วใช้เมนู "ซิงก์ทั้งหมดตอนนี้" · ' +
          summary_(res.counts),
        true
      );
      return;
    }

    mergeStaleStatuses_(block, res);
    writeResults_(sh, 2, block, res, EDITOR_FALLBACK, badIdx);
    clearAlert_();
    if (res.changes) {
      log_('ซิงก์อัตโนมัติ', `บันทึก ${res.changes} รายการที่ยังไม่เข้าระบบ · ${summary_(res.counts)}`, false);
    }
    // ปัญหาที่ค้างอยู่ (รหัสซ้ำ ฯลฯ) บันทึกเฉพาะตอนที่เปลี่ยน ไม่งั้นบันทึกซ้ำทุก 10 นาที
    logOnce_('reconcile-issues', 'ซิงก์อัตโนมัติ', issuesText_(res.counts), false);
  } finally {
    lock.releaseLock();
  }
}

function installTriggers_() {
  const ss = SpreadsheetApp.getActive();
  // เห็นเฉพาะ trigger ของบัญชีตัวเอง — ของคนอื่นลบจากตรงนี้ไม่ได้
  ScriptApp.getProjectTriggers()
    .filter((t) => ['onEditInstallable', 'reconcile'].indexOf(t.getHandlerFunction()) >= 0)
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('reconcile').timeBased().everyMinutes(RECONCILE_MINUTES).create();
}


// ═══════════════════════════════════════════════════════════════════
// ซิงก์
// ═══════════════════════════════════════════════════════════════════

function syncRange_(sh, startRow, numRows, editor) {
  const block = readBlock_(sh, startRow, numRows);
  const { rows, badIdx } = collectRows_(block);

  let res = { applied: true, changes: 0, rows: [] };
  if (rows.length) {
    try {
      // ส่งทั้งช่วงในครั้งเดียว ไม่แบ่งชุด — เพดานต้องนับรวมทั้งการแก้ครั้งนี้
      res = apply_(rows, editor, { maxChanges: EDIT_MAX_CHANGES });
    } catch (err) {
      writeError_(sh, startRow, block, '⛔ ยังไม่ได้บันทึก: ' + err.message + ' — จะลองใหม่ในรอบซิงก์อัตโนมัติ');
      log_('แก้ในชีต', `⛔ บันทึกไม่สำเร็จ ${rows.length} แถว (${editor}): ${err.message}`, false);
      return;
    }
  }

  if (!res.applied) {
    const msg =
      `⏸ ${editor} แก้พร้อมกัน ${res.changes} รายการ เกินเพดาน ${EDIT_MAX_CHANGES} — ยังไม่ได้บันทึก ` +
      'ถ้าตั้งใจ ใช้เมนู "ซิงก์ทั้งหมดตอนนี้" · ถ้าไม่ตั้งใจ กด Ctrl+Z';
    log_('แก้ในชีต', msg, true);
    try {
      SpreadsheetApp.getActive().toast(msg, 'ยังไม่ได้บันทึก', 15);
    } catch (err) {
      // toast จาก trigger บางครั้งไม่ขึ้น — มีคอลัมน์สถานะและบันทึกซิงก์อยู่แล้ว
    }
  }
  writeResults_(sh, startRow, block, res, editor, badIdx);
}

/**
 * แถวที่สถานะค้างเป็น ⛔/⏸/⚠ แต่ตอนนี้ตรงกับระบบแล้ว — ขอสถานะใหม่มาเขียนทับ
 * เช่น onEdit ล้มแต่ reconcile เขียนให้ · กด Ctrl+Z ยกเลิกการแก้ที่เกินเพดาน · ลบแถวซ้ำออกแล้ว
 * การส่งทั้งชีตคืนเฉพาะแถวที่เปลี่ยน แถวพวกนี้จึงไม่ได้สถานะใหม่ถ้าไม่ขอแยก
 */
function mergeStaleStatuses_(block, res) {
  const seen = {};
  res.rows.forEach((r) => {
    seen[r.item_id] = true;
  });
  const stale = [];
  block.disp.forEach((v, i) => {
    const id = String(v[COL.ITEM - 1]).trim();
    const status = String(v[COL.STATUS - 1]);
    const raw = block.rawLoc[i][0];
    const stuck = STALE_PREFIXES.some((p) => status.indexOf(p) === 0);
    if (id && !seen[id] && typeof raw === 'string' && stuck) {
      stale.push({ item_id: id, location: raw, note: v[COL.NOTE - 1] });
    }
  });
  if (!stale.length) return;
  const more = apply_(stale, EDITOR_FALLBACK, { dryRun: true });
  res.rows = res.rows.concat(more.rows);
}

/**
 * อ่านช่วงแถวจากชีต
 * disp   = ค่าที่เห็นบนจอ (ทุกคอลัมน์)
 * rawLoc = ค่าจริงของคอลัมน์ตำแหน่ง — ใช้ดูว่าชีตแปลงเป็นตัวเลข/วันที่ไปหรือยัง
 */
function readBlock_(sh, startRow, numRows) {
  if (numRows < 1) return { disp: [], rawLoc: [] };
  return {
    disp: sh.getRange(startRow, 1, numRows, NUM_COLS).getDisplayValues(),
    rawLoc: sh.getRange(startRow, COL.LOCATION, numRows, 1).getValues(),
  };
}

function readAll_(sh) {
  return readBlock_(sh, 2, sh.getLastRow() - 1);
}

/**
 * แปลงแถวในชีตเป็นข้อมูลที่ส่งให้ sheet_apply
 * ⚠️ ไม่กรองตามความยาว/รูปแบบ (กฎเหล็กข้อ 4) — DB จัดประเภทเอง
 * ข้ามเฉพาะแถวที่ไม่มีรหัสสินค้า และช่องตำแหน่งที่ชีตแปลงเป็นตัวเลข/วันที่ไปแล้ว
 * (ค่าบนจอเพี้ยนไปแล้ว เช่น 3-1 → 3/1/2026 ส่งไปก็ได้ตำแหน่งผิด)
 */
function collectRows_(block) {
  const rows = [];
  const badIdx = [];
  block.disp.forEach((v, i) => {
    const id = String(v[COL.ITEM - 1]).trim();
    if (!id) return;
    const raw = block.rawLoc[i][0];
    if (raw !== '' && typeof raw !== 'string') {
      badIdx.push(i);
      return;
    }
    rows.push({ item_id: id, location: raw, note: v[COL.NOTE - 1] });
  });
  return { rows, badIdx };
}

/** เขียนคอลัมน์ สถานะ/แก้ล่าสุด ตามผลจาก DB — แถวที่ DB ไม่ได้ตอบถึงคงค่าเดิม */
function writeResults_(sh, startRow, block, res, who, badIdx) {
  const byId = {};
  res.rows.forEach((r) => {
    if (r.action !== 'missing_from_sheet') byId[r.item_id] = r;
  });
  const bad = {};
  (badIdx || []).forEach((i) => {
    bad[i] = true;
  });
  const stamp = stamp_(who, new Date());

  let dirty = false;
  const out = block.disp.map((v, i) => {
    let status = v[COL.STATUS - 1];
    let updated = v[COL.UPDATED - 1];
    const r = byId[String(v[COL.ITEM - 1]).trim()];
    if (bad[i]) {
      status = BAD_VALUE_MSG;
      dirty = true;
      // ตั้งกลับเป็นข้อความ ให้พิมพ์ใหม่แล้วไม่โดนแปลงซ้ำ
      sh.getRange(startRow + i, COL.LOCATION).setNumberFormat('@');
    } else if (r) {
      const isChange = CHANGED.indexOf(r.action) >= 0;
      if (isChange && !res.applied) {
        status = '⏸ ยังไม่ได้บันทึก — แก้พร้อมกันเกินเพดาน ดูแท็บ "บันทึกซิงก์"';
      } else {
        status = statusText_(r);
        if (isChange) updated = stamp;
      }
      dirty = true;
    }
    return [status, updated];
  });
  if (dirty) sh.getRange(startRow, COL.STATUS, out.length, 2).setValues(out);
}

function writeError_(sh, startRow, block, msg) {
  const out = block.disp.map((v) =>
    String(v[COL.ITEM - 1]).trim() ? [msg] : [v[COL.STATUS - 1]]
  );
  sh.getRange(startRow, COL.STATUS, out.length, 1).setValues(out);
}

/**
 * ข้อความสถานะของแถว — ทำให้เห็นทันทีว่าผังจะไฮไลท์ถูกไหม
 * zone/aisle/slot มาจาก generated column ใน DB (0004) ไม่ได้แยกเองฝั่งนี้
 * ⚠️ aisle = "เชลฟ์" · slot = "ชั้น" (ชื่อคอลัมน์เดิม ดู CLAUDE.md)
 */
function statusText_(r) {
  switch (r.action) {
    case 'unknown_item':
      return '❌ ไม่พบรหัสสินค้านี้ในระบบ — ไม่ได้บันทึก';
    case 'duplicate':
      return '⚠️ รหัสสินค้าซ้ำในชีต — ไม่ได้บันทึก ลบแถวที่ซ้ำออก';
    case 'delete':
      return '🗑 ลบตำแหน่งแล้ว';
  }
  if (!r.location) return '';
  if (r.zone && r.slot != null) return `✅ โซน ${r.zone} · เชลฟ์ ${r.aisle} · ชั้น ${r.slot}`;
  if (r.zone) return `✅ โซน ${r.zone} · เชลฟ์ ${r.aisle}`;
  // PRE, COOL, L1, พิมพ์ผิดอย่าง J6l — ไม่ใช่ error แต่ PDA จะไม่มีผังให้ดู
  return 'ℹ️ รหัสพิเศษ — PDA แสดงเป็นตัวใหญ่ ไม่มีผัง';
}


// ═══════════════════════════════════════════════════════════════════
// โครงชีต
// ═══════════════════════════════════════════════════════════════════

/**
 * หัวตาราง · format ข้อความ · การป้องกันคอลัมน์ · dropdown
 * fromRow = แถวแรกที่ต้องตั้ง format ข้อความ (ตั้งเฉพาะแถวใหม่ ไม่ไปแตะค่าเดิม)
 */
function formatSheet_(sh, fromRow) {
  const n = sh.getMaxRows();

  // ⚠️ ต้องตั้งก่อนเขียนข้อมูล — ถ้าเขียนก่อน บาร์โค้ด 0 นำหน้าจะหาย 16 หลักจะเพี้ยน
  sh.getRange(fromRow, 1, n - fromRow + 1, NUM_COLS).setNumberFormat('@');

  sh.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]).setFontWeight('bold').setBackground('#eeeeee');
  sh.getRange(1, COL.LOCATION, 1, 2).setBackground('#fff2cc'); // คอลัมน์ที่แก้ได้
  sh.setFrozenRows(1);
  WIDTHS.forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // เตือนอย่างเดียว ไม่ล็อกจริง — ถ้าล็อกจริง เมนูที่พนักงานกดจะเขียนคอลัมน์สถานะไม่ได้
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter((p) => p.getDescription().indexOf(PROTECT_TAG) === 0)
    .forEach((p) => p.remove());
  [
    sh.getRange(1, 1, 1, NUM_COLS),
    sh.getRange(2, 1, n - 1, COL.LOCATION - 1),
    sh.getRange(2, COL.STATUS, n - 1, 2),
  ].forEach((r) =>
    r
      .protect()
      .setDescription(PROTECT_TAG + ': ระบบเขียนเอง — แก้ได้เฉพาะ ตำแหน่ง/หมายเหตุ')
      .setWarningOnly(true)
  );

  const list = SpreadsheetApp.getActive().getSheetByName(SHEET_LOCS);
  if (list) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInRange(list.getRange('A2:A'), true)
      .setAllowInvalid(true) // ตำแหน่งเป็นข้อความอิสระ — เตือนแต่ไม่บังคับ
      .setHelpText('ไม่อยู่ในรายการตำแหน่งที่ใช้อยู่ — ตรวจว่าพิมพ์ถูก · ดูผลในคอลัมน์ "สถานะ"')
      .build();
    sh.getRange(2, COL.LOCATION, n - 1, 1).setDataValidation(rule);
  }
}

/** แท็บ dropdown — ตำแหน่งทั้งหมดที่ใช้อยู่ในระบบ */
function refreshLocationList_(locations) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET_LOCS) || ss.insertSheet(SHEET_LOCS);
  sh.clearContents();
  ensureRows_(sh, locations.length + 1);
  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  sh.getRange(1, 1)
    .setValue('ตำแหน่งที่ใช้อยู่ในระบบ — ตัวเลือกของคอลัมน์ "ตำแหน่ง" (ระบบเขียนเอง อัปเดตจากเมนู)')
    .setFontWeight('bold');
  if (locations.length) {
    sh.getRange(2, 1, locations.length, 1).setValues(locations.map((l) => [l]));
  }
  sh.setColumnWidth(1, 480);
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach((p) => p.remove());
  sh.protect().setDescription(PROTECT_TAG + ': ระบบเขียนเอง').setWarningOnly(true);
}

function ensureRows_(sh, needed) {
  const have = sh.getMaxRows();
  if (have < needed) sh.insertRowsAfter(have, needed - have);
}

function mainSheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_MAIN);
}

/**
 * หัวตารางต้องตรงกับ HEADERS ก่อนอ่าน/เขียนทุกครั้ง — ไม่ตรงได้ข้อความปัญหา ตรงได้ ''
 * ไม่ตรง = คอลัมน์ที่อ่านอาจไม่ใช่ตำแหน่ง (มีคนแทรก/ย้ายคอลัมน์ · วางโค้ดใหม่ทับชีตโครงเก่า)
 * ถ้าซิงก์ต่อ หมายเหตุหรือหมวดจะถูกส่งเข้าระบบเป็นตำแหน่ง
 */
function layoutProblem_(sh) {
  const got = sh.getRange(1, 1, 1, NUM_COLS).getDisplayValues()[0].map((v) => String(v).trim());
  if (HEADERS.every((h, i) => got[i] === h)) return '';
  return (
    `⛔ หยุดซิงก์: หัวตารางแท็บ "${SHEET_MAIN}" ไม่ตรงกับที่สคริปต์รู้จัก ` +
    `(ต้องเป็น ${HEADERS.join(' | ')} · ตอนนี้เป็น ${got.join(' | ')}) — ` +
    'มีการแทรก/ย้ายคอลัมน์ หรือวางโค้ดใหม่ทับชีตโครงเก่า ดู README หัวข้อ "เปลี่ยนโครงคอลัมน์"'
  );
}

/** แถวตามลำดับ HEADERS — หน่วยเรียงคู่กับบาร์โค้ด (ตัวที่ 2 ของหน่วย = หน่วยของบาร์โค้ดตัวที่ 2) */
function sheetRow_(it, data) {
  const l = data.locById[it.item_id];
  const bcs = data.bcById[it.item_id] || [];
  const row = [];
  row[COL.ITEM - 1] = it.item_id;
  row[COL.BARCODES - 1] = bcs.map((b) => b.barcode).join(', ');
  row[COL.NAME - 1] = it.name || '';
  row[COL.UNITS - 1] = bcs.map((b) => b.unit || '-').join(', ');
  row[COL.CATEGORY - 1] = it.category || '';
  row[COL.LOCATION - 1] = l ? l.location : '';
  row[COL.NOTE - 1] = l && l.note ? l.note : '';
  row[COL.STATUS - 1] = l
    ? statusText_({ action: 'unchanged', location: l.location, zone: l.zone, aisle: l.aisle, slot: l.slot })
    : '';
  row[COL.UPDATED - 1] = l && l.updated_by ? stamp_(l.updated_by, new Date(l.updated_at)) : '';
  return row;
}


// ═══════════════════════════════════════════════════════════════════
// Supabase
// ═══════════════════════════════════════════════════════════════════

function loadFromDb_() {
  // เรียงตาม primary key — แบ่งหน้าด้วย offset ต้องเรียงด้วยค่าที่ไม่ซ้ำ ไม่งั้นแถวหาย/ซ้ำข้ามหน้า
  const items = fetchAll_('items', 'item_id,name,category', 'item_id');
  const barcodes = fetchAll_('barcodes', 'barcode,item_id,unit', 'barcode');
  const locs = fetchAll_(
    'item_locations',
    'item_id,location,note,updated_by,updated_at,zone,aisle,slot',
    'item_id'
  );

  const bcById = {};
  barcodes.forEach((b) => {
    (bcById[b.item_id] = bcById[b.item_id] || []).push(b);
  });
  const locById = {};
  const seen = {};
  locs.forEach((l) => {
    locById[l.item_id] = l;
    seen[l.location] = true;
  });

  items.sort((a, b) => String(a.name).localeCompare(String(b.name), 'th'));
  return { items, bcById, locById, locations: Object.keys(seen).sort() };
}

function fetchAll_(table, select, order) {
  const out = [];
  for (let off = 0; ; ) {
    const page = rest_('get', `${table}?select=${select}&order=${order}.asc&limit=${PAGE}&offset=${off}`);
    if (!page.length) return out;
    out.push.apply(out, page);
    off += page.length; // ไม่ใช่ += PAGE — ถ้า server ตั้ง max rows ต่ำกว่า จะข้ามแถวไป
  }
}

function apply_(rows, editor, opts) {
  opts = opts || {};
  return rest_('post', 'rpc/sheet_apply', {
    p_rows: rows,
    p_editor: editor || null,
    p_full: !!opts.full,
    p_max_changes: opts.maxChanges == null ? null : opts.maxChanges,
    p_dry_run: !!opts.dryRun,
  });
}

function rest_(method, path, body) {
  const c = cfg_();
  // ⚠️ ต้องระบุ schema ทุก request — ไม่งั้น PostgREST ไปหาใน public (ฐาน POS)
  const headers = { apikey: c.key, 'Accept-Profile': 'anin_loc', 'Content-Profile': 'anin_loc' };
  if (c.key.indexOf('eyJ') === 0) headers.Authorization = 'Bearer ' + c.key; // key แบบ JWT (anon เดิม)
  const opts = { method: method, headers: headers, muteHttpExceptions: true };
  if (body !== undefined) {
    opts.contentType = 'application/json; charset=utf-8';
    opts.payload = JSON.stringify(body);
  }

  const res = UrlFetchApp.fetch(c.url + '/rest/v1/' + path, opts);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 300) {
    let msg = text;
    try {
      msg = JSON.parse(text).message || text;
    } catch (err) {
      // ไม่ใช่ JSON ใช้ข้อความดิบ
    }
    if (msg.indexOf('schema must be one of') >= 0) {
      msg += ' — ต้องเพิ่ม anin_loc ใน Supabase → Settings → API → Exposed schemas';
    }
    if (msg.indexOf('sheet_apply') >= 0) msg += ' — รัน 0006_sheet_sync.sql แล้วหรือยัง?';
    throw new Error(`Supabase ${code}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

/** อ่าน Script Properties — Project Settings → Script Properties */
function cfg_() {
  const p = PropertiesService.getScriptProperties();
  const url = (p.getProperty('SUPABASE_URL') || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key = (p.getProperty('SUPABASE_ANON_KEY') || '').trim();
  if (!key) {
    throw new Error('ยังไม่ได้ตั้ง Script Property: SUPABASE_ANON_KEY (ดู sheet/README.md)');
  }
  assertNotServiceKey_(key);
  return { url: url, key: key };
}

/** กันวาง service key ผิดช่อง — key นั้นเข้าถึงฐาน POS ได้ทั้งหมด */
function assertNotServiceKey_(key) {
  const msg =
    'SUPABASE_ANON_KEY เป็น service_role key — ห้ามใช้เด็ดขาด (เข้าถึงฐาน POS ได้ทั้งหมด) ' +
    'ใช้ anon / publishable key แทน แล้วหมุน service key ใหม่ที่ Supabase เพราะหลุดมาแล้ว';
  if (key.indexOf('sb_secret_') === 0) throw new Error(msg);
  const parts = key.split('.');
  if (parts.length !== 3) return;
  let payload = null;
  try {
    let b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    payload = JSON.parse(Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString());
  } catch (err) {
    return; // อ่าน JWT ไม่ออก ปล่อยให้ Supabase ตอบ error เอง
  }
  if (payload && payload.role === 'service_role') throw new Error(msg);
}


// ═══════════════════════════════════════════════════════════════════
// บันทึก / ตัวช่วย
// ═══════════════════════════════════════════════════════════════════

function log_(source, message, isAlert) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) {
    sh = ss.insertSheet(SHEET_LOG);
    sh.getRange(1, 1, 1, 3).setValues([['เวลา', 'ที่มา', 'รายละเอียด']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 150);
    sh.setColumnWidth(2, 130);
    sh.setColumnWidth(3, 900);
  }
  sh.insertRowBefore(2); // ใหม่สุดอยู่บน
  sh.getRange(2, 1, 1, 3).setValues([[fmtDate_(new Date()), source, message]]);
  if (sh.getMaxRows() > LOG_KEEP + 1) sh.deleteRows(LOG_KEEP + 2, sh.getMaxRows() - LOG_KEEP - 1);
  if (isAlert) sh.setTabColor('#d93025');
}

/** บันทึกเฉพาะเมื่อข้อความต่างจากครั้งก่อน — ข้อความว่าง = ปัญหาหายแล้ว ล้างค่าที่จำไว้ */
function logOnce_(key, source, message, isAlert) {
  const props = PropertiesService.getDocumentProperties();
  const k = 'last_' + key;
  if (!message) {
    props.deleteProperty(k);
    return;
  }
  if (props.getProperty(k) === message) return;
  props.setProperty(k, message);
  log_(source, message, isAlert);
}

function clearAlert_() {
  PropertiesService.getDocumentProperties().deleteProperty('last_reconcile-blocked');
  const sh = SpreadsheetApp.getActive().getSheetByName(SHEET_LOG);
  if (sh && sh.getTabColor()) sh.setTabColor(null);
}

function summary_(counts, sep) {
  const c = counts || {};
  const parts = LABELS.filter((l) => c[l[0]]).map((l) => `${l[1]} ${c[l[0]]}`);
  return parts.join(sep || ' · ') || 'ไม่มีความต่าง';
}

/** เฉพาะปัญหาที่ต้องมีคนไปดู (ไม่รวม insert/update/delete) — ไม่มีปัญหาได้ '' */
function issuesText_(counts) {
  const c = counts || {};
  const parts = LABELS.slice(3)
    .filter((l) => c[l[0]])
    .map((l) => `${l[1]} ${c[l[0]]}`);
  return parts.length ? '⚠️ ' + parts.join(' · ') : '';
}

function stamp_(who, date) {
  return who + ' · ' + fmtDate_(date);
}

function fmtDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
}

/**
 * อีเมลคนที่แก้ — ได้เฉพาะเมื่ออยู่ Google Workspace โดเมนเดียวกับเจ้าของสคริปต์
 * บัญชี Gmail ทั่วไปได้ค่าว่าง → บันทึกเป็น 'google-sheet'
 * (ประวัติรายเซลล์ยังดูได้จาก File → Version history ของชีต)
 */
function editorOf_(e) {
  try {
    const email = e && e.user ? e.user.getEmail() : '';
    return email || EDITOR_FALLBACK;
  } catch (err) {
    return EDITOR_FALLBACK;
  }
}

function activeEmail_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (err) {
    return '';
  }
}
