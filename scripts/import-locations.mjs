/**
 * import-locations.mjs
 * นำเข้าตำแหน่งจัดเก็บ (item_id → LOCATION) จาก Location-WH.csv เข้า anin_loc.item_locations
 *
 * รัน:  node scripts/import-locations.mjs
 *       node scripts/import-locations.mjs "D:\path\to\Location-WH.csv"
 *       node scripts/import-locations.mjs --dry-run      ← ตรวจไฟล์อย่างเดียว ไม่เขียน DB
 *
 * ต้องรัน import-catalog.mjs ก่อน (item_id ต้องมีอยู่ใน anin_loc.items แล้ว
 * เพราะ item_locations.item_id มี FK ชี้ไปหา items)
 *
 * ⚠️ ต่างจาก import-catalog.mjs ตรงที่สคริปต์นี้ "เขียนทับ" item_locations โดยตรง
 *    ใช้สำหรับ seed ข้อมูลตำแหน่งชุดแรกเท่านั้น ถ้ารันซ้ำหลังพนักงานเริ่มแก้ไข
 *    ในเว็บแล้ว ตำแหน่งที่พนักงานแก้จะถูกเขียนทับด้วยค่าจากไฟล์นี้อีกครั้ง
 *
 * ⚠️ CF_BARCODE ในไฟล์นี้ห้ามใช้เด็ดขาด — พบว่า 608 แถวถูก Excel แปลงเป็น
 *    scientific notation (เช่น 8.85089E+12) ทำให้ค่าคลาดเคลื่อนแบบกู้คืนไม่ได้
 *    สคริปต์นี้อ่านเฉพาะ CF_ITEMID + LOCATION เท่านั้น ไม่แตะ CF_BARCODE เลย
 *
 * CSV columns ที่ใช้ (จากทั้งหมด):
 *   CF_ITEMID   รหัสสินค้า — ต้องมีอยู่แล้วใน anin_loc.items
 *   LOCATION    ตำแหน่งจัดเก็บ (ข้อความอิสระ เช่น J61, H32, PRE)
 */

import { createClient } from '@supabase/supabase-js';
import Papa from 'papaparse';
import { readFileSync, existsSync } from 'fs';

// ─── CONFIG ───────────────────────────────────────────────
const CSV_CANDIDATES = [
  'C:\\Users\\BigYa-spare\\Desktop\\AninMaster Location\\Location-WH.csv',
];

const SUPABASE_URL = 'https://sntxojhhtxfrwprmhrhy.supabase.co';
const WRITE_CHUNK = 500;
const IMPORT_TAG = 'import-location'; // บันทึกใน updated_by เพื่อสาวกลับว่าแถวไหนมาจาก import

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
    console.error('\nระบุ path เองได้: node scripts/import-locations.mjs "D:\\path\\to\\file.csv"');
    process.exit(1);
  }
  return found;
}

function clean(raw) {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function parseCsv(csvPath) {
  // ⚠️ ไฟล์นี้ก็เป็น UTF-8 with BOM เหมือน R05.106.CSV — ตัด BOM ทิ้งก่อนเสมอ
  let text = readFileSync(csvPath, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const { data, errors } = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false, // ห้ามเปิด — item_id ที่เป็นตัวเลขล้วนจะโดนตัด leading zero
  });

  if (errors.length) {
    console.warn(`⚠️  papaparse เตือน ${errors.length} รายการ (แสดง 3 แรก):`);
    errors.slice(0, 3).forEach((e) => console.warn(`   แถว ${e.row}: ${e.message}`));
  }
  return data;
}

function buildRecords(rows) {
  const locMap = new Map(); // item_id -> location (ตรวจแล้วว่าไฟล์นี้ไม่มี item_id ไหนขัดแย้งกันเอง)
  const stats = { blank: 0, noItemId: 0, conflict: 0 };

  for (const r of rows) {
    const itemId = clean(r.CF_ITEMID);
    const location = clean(r.LOCATION);

    if (!itemId) { stats.noItemId++; continue; }
    if (!location) { stats.blank++; continue; }

    const existing = locMap.get(itemId);
    if (existing && existing !== location) {
      // ไม่คาดว่าจะเจอ (ตรวจไฟล์แล้วว่า 0 กรณี) แต่กันไว้ — ยึดค่าที่เจอก่อน
      stats.conflict++;
      continue;
    }
    locMap.set(itemId, location);
  }

  return {
    locations: [...locMap.entries()].map(([item_id, location]) => ({
      item_id,
      location,
      updated_by: IMPORT_TAG,
    })),
    stats,
  };
}

async function upsertChunked(sb, table, list, onConflict) {
  let done = 0;
  const skipped = [];
  for (let i = 0; i < list.length; i += WRITE_CHUNK) {
    const slice = list.slice(i, i + WRITE_CHUNK);
    const { error } = await sb.from(table).upsert(slice, { onConflict });
    if (error) {
      // FK violation = มี item_id ในไฟล์ location ที่ไม่มีใน items แล้ว
      // ลองทีละแถวในชุดนี้เพื่อแยกว่าตัวไหนเป็นปัญหา แทนที่จะ exit ทั้งก้อน
      if (error.message.includes('foreign key') || error.code === '23503') {
        for (const row of slice) {
          const { error: rowErr } = await sb.from(table).upsert([row], { onConflict });
          if (rowErr) skipped.push({ item_id: row.item_id, reason: rowErr.message });
        }
        done += slice.length - skipped.filter((s) => slice.some((x) => x.item_id === s.item_id)).length;
      } else {
        console.error(`\n❌ ${table} ล้มเหลวที่แถว ${i}: ${error.message}`);
        if (error.message.includes('schema must be one of')) {
          console.error(
            '\n💡 ต้องเพิ่ม `anin_loc` ใน Exposed schemas ก่อน:\n' +
              '   Supabase Dashboard → Settings → API → Exposed schemas'
          );
        }
        process.exit(1);
      }
    } else {
      done += slice.length;
    }
    process.stdout.write(`\r   ${table}: ${done}/${list.length}`);
  }
  process.stdout.write(`\r   ${table}: ${done}/${list.length} ✅\n`);
  return skipped;
}

async function main() {
  const csvPath = resolveCsvPath();
  console.log(`📄 อ่านไฟล์: ${csvPath}`);

  const rows = parseCsv(csvPath);
  console.log(`   อ่านได้ ${rows.length.toLocaleString()} แถว`);

  const { locations, stats } = buildRecords(rows);

  console.log('\n📊 สรุปข้อมูลที่จะนำเข้า');
  console.log(`   ตำแหน่ง (item_locations) : ${locations.length.toLocaleString()}`);
  console.log(
    `   ข้าม                     : ${stats.blank} ไม่มี location · ` +
      `${stats.noItemId} ไม่มี item_id · ${stats.conflict} ขัดแย้งกันเอง`
  );

  if (DRY_RUN) {
    console.log('\n🔍 --dry-run: ไม่เขียนลง DB');
    console.log('\nตัวอย่าง 5 แถวแรก:');
    locations.slice(0, 5).forEach((l) => console.log(`   ${l.item_id} → ${l.location}`));
    return;
  }

  const key = getServiceKey();
  if (!key) {
    console.error('\n❌ ไม่พบ SUPABASE_SERVICE_KEY');
    console.error('   ใส่ใน .env: SUPABASE_SERVICE_KEY=<service_role key จาก Supabase Dashboard>');
    process.exit(1);
  }

  const sb = createClient(SUPABASE_URL, key, {
    db: { schema: 'anin_loc' }, // ⚠️ ห้ามชี้ public — public คือฐาน POS จริง
    auth: { persistSession: false },
  });

  console.log('\n⬆️  กำลังอัปโหลด...');
  const skipped = await upsertChunked(sb, 'item_locations', locations, 'item_id');

  if (skipped.length) {
    console.warn(`\n⚠️  ข้าม ${skipped.length} รายการ เพราะ item_id ไม่มีอยู่ใน anin_loc.items:`);
    skipped.slice(0, 10).forEach((s) => console.warn(`   ${s.item_id}: ${s.reason}`));
    if (skipped.length > 10) console.warn(`   ... และอีก ${skipped.length - 10} รายการ`);
  }

  const { count } = await sb
    .from('item_locations')
    .select('*', { count: 'exact', head: true });

  console.log('\n✅ เสร็จสิ้น — จำนวนจริงในฐานข้อมูล');
  console.log(`   item_locations : ${count?.toLocaleString() ?? '?'}`);
}

main().catch((e) => {
  console.error('\n❌ ล้มเหลว:', e.message);
  process.exit(1);
});
