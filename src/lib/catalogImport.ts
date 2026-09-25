import Papa from 'papaparse';
import { supabase } from './supabase';

/**
 * นำเข้าแคตตาล็อกจาก R05.106.CSV (export จาก ProMaxx) ผ่านเบราว์เซอร์
 * ใช้ anon key ของเว็บ — ไม่ต้องมี service key บนเครื่อง จึงใช้จากคอมเครื่องไหนก็ได้
 *
 * ⚠️ กฎการอ่านไฟล์ต้องตรงกับ buildRecords() ใน scripts/import-catalog.mjs — แก้ที่หนึ่งต้องแก้อีกที่
 * ⚠️ เขียนแค่ items และ barcodes · ไม่แตะ item_locations · ข้ามสินค้าใน deleted_items
 */

export interface CatalogItem {
  item_id: string;
  name: string;
  category: string | null;
}

export interface CatalogBarcode {
  barcode: string;
  item_id: string;
  unit: string | null;
  base_multiple: number;
}

export interface CatalogPreview {
  fileName: string;
  csvRows: number;
  items: CatalogItem[];
  barcodes: CatalogBarcode[];
  skipped: { blank: number; tooShort: number; dupBarcode: number; noItemId: number };
  deletedItems: number;
  deletedBarcodes: number;
  /** คาดหวัง ~126 — ถ้าเป็น 0 แปลว่าไฟล์ผ่าน Excel มา 0 นำหน้าหายไปแล้ว */
  leadingZero: number;
  /** คาดหวัง ~410 — สินค้ารหัสภายใน (A001, S00126) ต้องไม่ถูกกรอง */
  shortCodes: number;
  itemsInDb: number;
}

const REQUIRED_COLUMNS = ['CF_BARCODE', 'CF_ITEMID', 'CF_ITEMNAME'];
/** เล็กกว่าสคริปต์ (500) — anon มี statement timeout สั้นกว่า service_role */
const WRITE_CHUNK = 250;
/** PostgREST คืนได้ครั้งละไม่เกิน 1,000 แถว */
const PAGE = 1000;

function clean(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

/** อ่านไฟล์ + ตรวจ + เทียบกับระบบ — ยังไม่เขียนอะไร */
export async function prepareCatalog(file: File): Promise<CatalogPreview> {
  let text = await file.text();
  // ⚠️ ไฟล์เป็น UTF-8 with BOM — ไม่ตัดทิ้ง คอลัมน์แรกจะชื่อ "﻿CF_BARCODE" แล้วอ่านไม่เจอทุกแถว
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.includes('�')) {
    throw new Error(
      'ไฟล์ไม่ได้บันทึกเป็น UTF-8 — ชื่อสินค้าภาษาไทยจะกลายเป็นตัวอ่านไม่ออกทั้งระบบ ' +
        'ใช้ไฟล์ที่ export จาก ProMaxx ตรงๆ อย่าเปิดแล้วบันทึกด้วย Excel'
    );
  }

  const { data, meta } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // ⚠️ ห้ามเปิด dynamicTyping — บาร์โค้ด 0 นำหน้าหาย และเลข 14-16 หลักเกิน safe integer
    dynamicTyping: false,
  });
  const missing = REQUIRED_COLUMNS.filter((c) => !meta.fields?.includes(c));
  if (missing.length) {
    throw new Error(`ไม่ใช่ไฟล์ R05.106 — ไม่มีคอลัมน์ ${missing.join(', ')}`);
  }

  const itemsMap = new Map<string, CatalogItem>();
  const allBarcodes: CatalogBarcode[] = [];
  const seenBarcode = new Set<string>();
  const skipped = { blank: 0, tooShort: 0, dupBarcode: 0, noItemId: 0 };

  for (const r of data) {
    const barcode = clean(r.CF_BARCODE);
    const itemId = clean(r.CF_ITEMID);
    const name = clean(r.CF_ITEMNAME);

    if (!barcode) { skipped.blank++; continue; }
    // ⚠️ กรองแค่ค่าที่สั้นจนใช้สแกนไม่ได้จริงๆ (พบแค่แถวเดียวคือ 'D')
    //    ห้ามกรองที่ความยาว < 6 — สินค้ารหัส A001, S00126 ฯลฯ ไม่มีบาร์โค้ดอื่นเลย (กฎเหล็กข้อ 4)
    if (barcode.length < 2) { skipped.tooShort++; continue; }
    if (!itemId || !name) { skipped.noItemId++; continue; }
    if (seenBarcode.has(barcode)) { skipped.dupBarcode++; continue; }
    seenBarcode.add(barcode);

    if (!itemsMap.has(itemId)) {
      itemsMap.set(itemId, { item_id: itemId, name, category: clean(r.CF_ITEMGROUPL1_GROUPNAME) || null });
    }
    const mult = Number(r.CF_BASEMULTIPLE);
    allBarcodes.push({
      barcode,
      item_id: itemId,
      unit: clean(r.CF_UNITNAME) || null,
      base_multiple: Number.isFinite(mult) && mult > 0 ? mult : 1,
    });
  }

  // ไฟล์ที่เปิดแล้วบันทึกด้วย Excel: 0 นำหน้าหาย · เลขยาวกลายเป็น 8.85089E+12 — กู้คืนไม่ได้
  const sci = allBarcodes.find((b) => /^\d(\.\d+)?E\+\d+$/i.test(b.barcode));
  if (sci) {
    throw new Error(
      `บาร์โค้ดเพี้ยนเป็นเลขวิทยาศาสตร์ (${sci.barcode}) — ไฟล์นี้ถูกเปิดแล้วบันทึกด้วย Excel ` +
        'ใช้ไฟล์ที่ export จาก ProMaxx ตรงๆ'
    );
  }

  const [deleted, inDb] = await Promise.all([loadDeletedIds(), countRows('items')]);
  const allItems = [...itemsMap.values()];
  const items = allItems.filter((i) => !deleted.has(i.item_id));
  const barcodes = allBarcodes.filter((b) => !deleted.has(b.item_id));

  const leadingZero = barcodes.filter((b) => b.barcode.startsWith('0')).length;
  if (leadingZero === 0 && barcodes.length > 0) {
    throw new Error(
      'ไม่มีบาร์โค้ดที่ขึ้นต้นด้วย 0 เลย (ปกติมี ~126) — 0 นำหน้าหายไปแล้ว ' +
        'ไฟล์นี้น่าจะถูกเปิดแล้วบันทึกด้วย Excel ใช้ไฟล์ที่ export จาก ProMaxx ตรงๆ'
    );
  }

  return {
    fileName: file.name,
    csvRows: data.length,
    items,
    barcodes,
    skipped,
    deletedItems: allItems.length - items.length,
    deletedBarcodes: allBarcodes.length - barcodes.length,
    leadingZero,
    shortCodes: barcodes.filter((b) => b.barcode.length < 6).length,
    itemsInDb: inDb,
  };
}

/** upsert ทีละชุด — ล้มกลางทางแล้วกดใหม่ได้ ปลอดภัย (upsert ซ้ำได้ผลเท่าเดิม) */
export async function uploadCatalog(
  p: CatalogPreview,
  onProgress: (done: number, total: number) => void
): Promise<{ items: number; barcodes: number }> {
  const total = p.items.length + p.barcodes.length;
  let done = 0;
  onProgress(done, total);

  // items ต้องมาก่อนเสมอ — barcodes.item_id มี FK ชี้มา
  const steps: [string, (CatalogItem | CatalogBarcode)[], string][] = [
    ['items', p.items, 'item_id'],
    ['barcodes', p.barcodes, 'barcode'],
  ];
  for (const [table, list, key] of steps) {
    for (let i = 0; i < list.length; i += WRITE_CHUNK) {
      const slice = list.slice(i, i + WRITE_CHUNK);
      const { error } = await supabase.from(table).upsert(slice, { onConflict: key });
      if (error) {
        throw new Error(
          `${table === 'items' ? 'สินค้า' : 'บาร์โค้ด'} ล้มเหลวที่แถว ${i.toLocaleString()}: ${error.message} ` +
            '— ข้อมูลที่เขียนไปแล้วไม่เสียหาย กดนำเข้าใหม่ได้เลย'
        );
      }
      done += slice.length;
      onProgress(done, total);
    }
  }

  const [items, barcodes] = await Promise.all([countRows('items'), countRows('barcodes')]);
  return { items, barcodes };
}

async function loadDeletedIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('deleted_items')
      .select('item_id')
      .order('item_id')
      .range(from, from + PAGE - 1);
    // อ่านไม่ได้ = หยุด — ไม่งั้นสินค้าที่ลบแล้วจะกลับมาเงียบๆ
    if (error) throw new Error(`อ่านรายการสินค้าที่ถูกลบไม่ได้: ${error.message}`);
    data.forEach((r: { item_id: string }) => ids.add(r.item_id));
    if (data.length < PAGE) return ids;
  }
}

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}
