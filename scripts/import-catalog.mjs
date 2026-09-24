/**
 * import-catalog.mjs
 * นำเข้าข้อมูลสินค้า (ชื่อ + บาร์โค้ด) จาก CSV export ของ ProMaxx เข้า Supabase
 *
 * รัน:  node scripts/import-catalog.mjs
 *       node scripts/import-catalog.mjs "D:\path\to\R05.106.CSV"
 *       node scripts/import-catalog.mjs --dry-run      ← ตรวจไฟล์อย่างเดียว ไม่เขียน DB
 *
 * ต้องรัน supabase/migrations/0001_schema.sql, 0002_rls.sql และ 0007_deleted_items.sql ก่อน
 *
 * ⚠️ สคริปต์นี้เขียนแค่ตาราง items และ barcodes เท่านั้น
 *    ไม่แตะ item_locations เลย — รันซ้ำได้ปลอดภัย location ที่กรอกไว้ไม่หาย
 *    ข้ามสินค้าที่อยู่ใน deleted_items (ลบจากหน้าจัดการแล้ว) แม้ยังอยู่ใน CSV
 *
 * CSV columns ที่ใช้ (จากทั้งหมด 27 คอลัมน์):
 *   CF_BARCODE                 บาร์โค้ด (unique ทุกแถว)
 *   CF_ITEMID                  รหัสสินค้า — สินค้า 1 ตัวมีได้หลายบาร์โค้ด
 *   CF_ITEMNAME                ชื่อสินค้า (ไทย/อังกฤษปนกัน)
 *   CF_UNITNAME                หน่วย เช่น แผง กล่อง
 *   CF_BASEMULTIPLE            จำนวนหน่วยย่อยต่อแพ็ก
 *   CF_ITEMGROUPL1_GROUPNAME   หมวดสินค้า
 */

import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { readFileSync, existsSync } from 'fs';

// ─── CONFIG ───────────────────────────────────────────────
const CSV_CANDIDATES = [
  'C:\\Users\\BigYa-spare\\Desktop\\run-upload-stock\\R05.106.CSV',
  'C:\\Users\\AninMainPC\\Desktop\\run-upload-stock\\R05.106.CSV',
  'C:\\Users\\BigYa-spare\\Desktop\\Cycle-Count\\R05106.CSV',
];

const SUPABASE_URL = 'https://sntxojhhtxfrwprmhrhy.supabase.co';
const WRITE_CHUNK = 500;

function getServiceKey() {
  if (process.env.SUPABASE_SERVICE_KEY) return process.env.SUPABASE_SERVICE_KEY.trim();
  for (const rel of ['../.env', './.env']) {
    try {
      const envText = readFileSync(new URL(rel, import.meta.url), 'utf-8');
      const m = envText.match(/^\s*SUPABASE_SERVICE_KEY\s*=\s*(.+)\s*$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch {
      // ไม่มีไฟล์ .env ก็ข้าม
    }
  }
  return null;
}
// ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const csvArg = args.find((a) => !a.startsWith('--'));

function resolveCsvPath() {
  if (csvArg) {
    if (!existsSync(csvArg)) {
      console.error(`❌ ไม่พบไฟล์: ${csvArg}`);
      process.exit(1);
    }
    return csvArg;
  }
  const found = CSV_CANDIDATES.find((p) => existsSync(p));
  if (!found) {
    console.error('❌ ไม่พบไฟล์ CSV ในตำแหน่งที่รู้จัก:');
    CSV_CANDIDATES.forEach((p) => console.error(`   - ${p}`));
    console.error('\nระบุ path เองได้: node scripts/import-catalog.mjs "D:\\path\\to\\file.CSV"');
    process.exit(1);
  }
  return found;
}

function clean(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function parseCsv(csvPath) {
  // ⚠️ กับดักที่ 1: ไฟล์นี้เป็น UTF-8 WITH BOM
  //    ถ้าไม่ตัด BOM ทิ้ง คอลัมน์แรกจะชื่อ "\ufeffCF_BARCODE"
  //    แล้ว row.CF_BARCODE จะเป็น undefined ทุกแถวโดยไม่มี error ให้เห็นเลย
  let text = readFileSync(csvPath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const { data, errors } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    // ⚠️ กับดักที่ 2: ห้ามเปิด dynamicTyping เด็ดขาด
    //    บาร์โค้ดจะถูกแปลงเป็น Number → leading zero หาย (มี 126 แถวที่ขึ้นต้นด้วย 0)
    //    และเลข 14-16 หลักจะเกินช่วง safe integer ของ JS
    dynamicTyping: false,
  });

  if (errors.length) {
    console.warn(`⚠️  papaparse เตือน ${errors.length} รายการ (แสดง 3 แรก):`);
    errors.slice(0, 3).forEach((e) => console.warn(`   แถว ${e.row}: ${e.message}`));
  }
  return data;
}

function buildRecords(rows) {
  const itemsMap = new Map();
  const barcodes = [];
  const seenBarcode = new Set();
  const stats = { blank: 0, tooShort: 0, dupBarcode: 0, noItemId: 0 };

  for (const r of rows) {
    const barcode = clean(r.CF_BARCODE);
    const itemId = clean(r.CF_ITEMID);
    const name = clean(r.CF_ITEMNAME);

    if (!barcode) { stats.blank++; continue; }

    // ⚠️ กรองแค่ค่าที่สั้นจนใช้สแกนไม่ได้จริงๆ (พบแค่แถวเดียวคือ 'D')
    //    ห้ามกรองที่ความยาว < 6 เพราะมี 378 แถวที่ barcode == item_id
    //    (สินค้ารหัส A001, S00126, D0037 ฯลฯ) และ 296 ตัวในนั้นไม่มีบาร์โค้ดอื่นเลย
    //    กรองทิ้งเมื่อไหร่ = สแกนสินค้าพวกนี้ไม่เจอตลอดไป
    if (barcode.length < 2) { stats.tooShort++; continue; }

    if (!itemId || !name) { stats.noItemId++; continue; }
    if (seenBarcode.has(barcode)) { stats.dupBarcode++; continue; }
    seenBarcode.add(barcode);

    if (!itemsMap.has(itemId)) {
      itemsMap.set(itemId, {
        item_id: itemId,
        name,
        category: clean(r.CF_ITEMGROUPL1_GROUPNAME) || null,
      });
    }

    const mult = Number(r.CF_BASEMULTIPLE);
    barcodes.push({
      barcode,
      item_id: itemId,
      unit: clean(r.CF_UNITNAME) || null,
      base_multiple: Number.isFinite(mult) && mult > 0 ? mult : 1,
    });
  }

  return { items: [...itemsMap.values()], barcodes, stats };
}

/**
 * รหัสสินค้าที่ลบจากหน้าจัดการแล้ว (0007_deleted_items.sql)
 * อ่านไม่ได้ = หยุดเลย — import ต่อไปจะเพิ่มสินค้าที่ลบแล้วกลับมาเงียบๆ
 */
async function loadDeletedIds(sb) {
  const ids = new Set();
  const PAGE = 1000; // PostgREST คืนได้ครั้งละไม่เกิน 1,000 แถว
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from('deleted_items')
      .select('item_id')
      .order('item_id')
      .range(from, from + PAGE - 1);
    if (error) {
      throw new Error(
        `อ่านรายการสินค้าที่ถูกลบไม่ได้: ${error.message}\n` +
          '   ถ้ายังไม่ได้รัน supabase/migrations/0007_deleted_items.sql ให้รันใน SQL Editor ก่อน'
      );
    }
    data.forEach((r) => ids.add(r.item_id));
    if (data.length < PAGE) return ids;
  }
}

async function upsertChunked(sb, table, list, onConflict) {
  let done = 0;
  for (let i = 0; i < list.length; i += WRITE_CHUNK) {
    const slice = list.slice(i, i + WRITE_CHUNK);
    const { error } = await sb.from(table).upsert(slice, { onConflict });
    if (error) {
      console.error(`\n❌ ${table} ล้มเหลวที่แถว ${i}: ${error.message}`);
      if (error.message.includes('schema must be one of')) {
        console.error(
          '\n💡 ต้องเพิ่ม `anin_loc` ใน Exposed schemas ก่อน:\n' +
            '   Supabase Dashboard → Settings → API → Exposed schemas'
        );
      }
      process.exit(1);
    }
    done += slice.length;
    process.stdout.write(`\r   ${table}: ${done}/${list.length}`);
  }
  process.stdout.write(`\r   ${table}: ${done}/${list.length} ✅\n`);
}

async function main() {
  const csvPath = resolveCsvPath();
  console.log(`📄 อ่านไฟล์: ${csvPath}`);

  const rows = parseCsv(csvPath);
  console.log(`   อ่านได้ ${rows.length.toLocaleString()} แถว`);

  const built = buildRecords(rows);
  const { stats } = built;

  const key = getServiceKey();
  const sb = key
    ? createClient(SUPABASE_URL, key, {
        db: { schema: 'anin_loc' },      // ⚠️ ห้ามชี้ public — public คือฐาน POS จริง
        auth: { persistSession: false },
      })
    : null;

  // สินค้าที่ลบจากหน้าจัดการแล้ว — ไม่เพิ่มกลับ แม้ยังอยู่ใน ProMaxx
  const deleted = sb ? await loadDeletedIds(sb) : null;
  const items = deleted ? built.items.filter((i) => !deleted.has(i.item_id)) : built.items;
  const barcodes = deleted ? built.barcodes.filter((b) => !deleted.has(b.item_id)) : built.barcodes;

  console.log('\n📊 สรุปข้อมูลที่จะนำเข้า');
  console.log(`   สินค้า (items)     : ${items.length.toLocaleString()}`);
  console.log(`   บาร์โค้ด (barcodes) : ${barcodes.length.toLocaleString()}`);
  console.log(
    `   ข้าม               : ${stats.blank} ว่าง · ${stats.tooShort} สั้นเกิน · ` +
      `${stats.dupBarcode} ซ้ำ · ${stats.noItemId} ไม่มี id/ชื่อ`
  );
  if (deleted) {
    console.log(
      `   ข้ามสินค้าที่ถูกลบ   : ${built.items.length - items.length} สินค้า ` +
        `(${built.barcodes.length - barcodes.length} บาร์โค้ด) — ดู anin_loc.deleted_items`
    );
  } else {
    console.log('   ข้ามสินค้าที่ถูกลบ   : ยังไม่ได้เช็ค (ไม่มี SUPABASE_SERVICE_KEY)');
  }

  // sanity check เทียบกับค่าที่สำรวจไฟล์ไว้
  const leadingZero = barcodes.filter((b) => b.barcode.startsWith('0')).length;
  const shortCodes = barcodes.filter((b) => b.barcode.length < 6).length;
  console.log(`   บาร์โค้ดขึ้นต้นด้วย 0 : ${leadingZero} (คาดหวัง ~126 — ถ้าเป็น 0 แปลว่า leading zero หาย)`);
  console.log(`   บาร์โค้ดสั้นกว่า 6   : ${shortCodes} (คาดหวัง ~410 — สินค้ารหัสภายใน ต้องไม่ถูกกรอง)`);

  if (leadingZero === 0 && barcodes.length > 0) {
    console.error('\n❌ leading zero หายไปหมด — แปลว่า barcode ถูก parse เป็นตัวเลข');
    console.error('   ตรวจว่า dynamicTyping ปิดอยู่');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run: ไม่เขียนลง DB');
    console.log('\nตัวอย่าง 3 แถวแรก:');
    barcodes.slice(0, 3).forEach((b) => {
      const it = items.find((i) => i.item_id === b.item_id);
      console.log(`   ${b.barcode} → ${b.item_id} · ${it?.name?.slice(0, 40)} · ${b.unit}`);
    });
    return;
  }

  if (!sb) {
    console.error('\n❌ ไม่พบ SUPABASE_SERVICE_KEY');
    console.error('   สร้างไฟล์ .env ที่ root ของโปรเจกต์ แล้วใส่:');
    console.error('   SUPABASE_SERVICE_KEY=<service_role key จาก Supabase Dashboard>');
    console.error('\n   ⚠️ key นี้ข้ามผ่าน RLS ทั้งหมด ใช้เฉพาะสคริปต์ในเครื่อง');
    console.error('      ห้ามใส่ในเว็บหรือ commit ลง git เด็ดขาด');
    process.exit(1);
  }

  console.log('\n⬆️  กำลังอัปโหลด...');
  // items ต้องมาก่อนเสมอ เพราะ barcodes.item_id มี FK ชี้มา
  await upsertChunked(sb, 'items', items, 'item_id');
  await upsertChunked(sb, 'barcodes', barcodes, 'barcode');

  // ตรวจจำนวนจริงใน DB เทียบกับที่ส่งไป
  const [itemCount, barcodeCount] = await Promise.all([
    sb.from('items').select('*', { count: 'exact', head: true }),
    sb.from('barcodes').select('*', { count: 'exact', head: true }),
  ]);

  console.log('\n✅ เสร็จสิ้น — จำนวนจริงในฐานข้อมูล');
  console.log(`   items    : ${itemCount.count?.toLocaleString() ?? '?'}`);
  console.log(`   barcodes : ${barcodeCount.count?.toLocaleString() ?? '?'}`);

  if (itemCount.count !== items.length || barcodeCount.count !== barcodes.length) {
    console.warn(
      '\n⚠️  จำนวนไม่ตรงกับที่ส่งไป — อาจมีข้อมูลเก่าค้างอยู่จากการ import รอบก่อน\n' +
        '   ถ้าเป็นการ import รอบแรก ให้ตรวจสอบว่าไม่มี error ระหว่างทาง'
    );
  }
}

main().catch((e) => {
  console.error('\n❌ ล้มเหลว:', e.message);
  // exitCode แทน process.exit() — exit ทันทีตอน fetch ยังปิดไม่เสร็จ ทำ Node บน Windows assert พัง
  process.exitCode = 1;
});
