import { supabase } from './supabase';

export interface LookupResult {
  barcode: string;
  unit: string | null;
  base_multiple: number | null;
  item_id: string;
  name: string;
  category: string | null;
  location: string | null;
  /** โซน แยกอัตโนมัติจาก location — null ถ้ารหัสไม่เข้ารูปแบบ <ตัวอักษร><ตัวเลข> */
  zone: string | null;
  /** ชั้น แยกอัตโนมัติจาก location (1 = ล่างสุด) */
  aisle: number | null;
  /** ช่องในชั้น แยกอัตโนมัติจาก location — null ถ้ารหัสไม่มีหลักช่อง */
  slot: number | null;
  note: string | null;
  updated_by: string | null;
  location_updated_at: string | null;
}

/** หนึ่งช่องบนผังคลัง */
export interface MapCell {
  zone: string;
  aisle: number;
  slot: number | null;
  item_count: number;
}

/**
 * แยกโซน/ชั้น/ช่อง จากรหัสตำแหน่ง
 *
 * ⚠️ ต้องให้ผลตรงกับ generated column ใน 0004_shelf_slot.sql เป๊ะๆ (กฎเหล็กข้อ 6)
 *    ถ้าแก้ regex ที่นี่ ต้องแก้ใน SQL ด้วย ไม่งั้นผังจะไฮไลท์ผิดช่อง
 *
 * รูปแบบที่อ่านออก:
 *   J61   → โซน J ชั้น 6 ช่อง 1   (รูปแบบหลักของคลัง — เลข 2 หลักติดกัน)
 *   A-03  → โซน A ชั้น 3 ช่อง null (รูปแบบเดิม ยังรองรับ)
 *
 * อ่านไม่ออก → null ทั้งหมด (PRE · COOL · L1 · กล่อง)
 * แล้วหน้าจอ fallback ไปแสดงรหัสตัวใหญ่ — ไม่ใช่ error
 */
export function parseLocation(location: string | null): {
  zone: string | null;
  aisle: number | null;
  slot: number | null;
} {
  const none = { zone: null, aisle: null, slot: null };
  if (!location) return none;

  // เลข 2 หลักติดกัน = ชั้น + ช่อง
  const two = /^\s*([A-Za-z]+)\s*(\d)(\d)\s*$/.exec(location);
  if (two) {
    return {
      zone: two[1].toUpperCase(),
      aisle: parseInt(two[2], 10),
      slot: parseInt(two[3], 10),
    };
  }

  // มีตัวคั่น = ชั้นอย่างเดียว (รูปแบบเดิม)
  const sep = /^\s*([A-Za-z]+)\s*[-_ ]\s*(\d+)\s*$/.exec(location);
  if (sep) {
    return { zone: sep[1].toUpperCase(), aisle: parseInt(sep[2], 10), slot: null };
  }

  return none;
}

export interface SearchRow {
  item_id: string;
  name: string;
  category: string | null;
  location: string | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string | null;
  barcodes: string[];
  total_count: number;
}

export interface HistoryRow {
  id: number;
  item_id: string;
  old_location: string | null;
  new_location: string | null;
  action: 'create' | 'update' | 'delete';
  changed_by: string | null;
  source: string;
  changed_at: string;
}

/** หาสินค้าจากบาร์โค้ดที่สแกน — query เดียวจบผ่าน view */
export async function lookupBarcode(barcode: string): Promise<LookupResult | null> {
  // firmware บางรุ่นต่อ \r\n ท้ายมาด้วยเมื่อตั้ง "Add End Mark"
  const code = barcode.trim().replace(/[\r\n\t]+$/, '');
  if (!code) return null;

  const { data, error } = await supabase
    .from('v_barcode_lookup')
    .select('*')
    .eq('barcode', code)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as LookupResult | null;
}

/**
 * ค้นหาด้วย SKU (item_id) แบบขึ้นต้นด้วย — พิมพ์ 1000 เจอ 100008, 100011, …
 *
 * ⚠️ ไม่จำกัดเฉพาะตัวเลข 6 หลัก แม้ SKU ส่วนใหญ่ (6,309 ตัว) จะเป็นแบบนั้น
 *    เพราะอีก 1,649 ตัวมีตัวอักษรปน (A001, S00126, D0037) ซึ่งเป็นสินค้าจริง
 *    ถ้ากรองเฉพาะตัวเลขจะหาสินค้าพวกนี้ไม่เจอเลย (กฎเหล็กข้อ 4 แนวเดียวกัน)
 *
 * ใช้ view เดียวกับตอนสแกน จึงได้ zone/aisle/slot มาครบเลย ไม่ต้อง query ซ้ำ
 * สินค้าตัวเดียวมีหลายบาร์โค้ด — dedupe ด้วย item_id ฝั่ง client
 */
export async function searchSku(sku: string, limit = 25): Promise<LookupResult[]> {
  const q = sku.trim();
  if (!q) return [];

  const { data, error } = await supabase
    .from('v_barcode_lookup')
    .select('*')
    .like('item_id', `${q}%`)
    .order('item_id')
    .limit(limit * 4); // เผื่อแถวซ้ำจากหลายบาร์โค้ด

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const out: LookupResult[] = [];
  for (const row of (data ?? []) as LookupResult[]) {
    if (seen.has(row.item_id)) continue;
    seen.add(row.item_id);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * ผังคลังทั้งหมด — สร้างจากตำแหน่งที่กรอกเข้ามาจริง ไม่ต้องตั้งค่าล่วงหน้า
 * ช่วงแรกที่ยังไม่มีข้อมูลจะได้ array ว่าง หน้าจอจะ fallback ไปแสดงรหัสตัวใหญ่
 */
export async function loadWarehouseMap(): Promise<MapCell[]> {
  const { data, error } = await supabase.from('v_warehouse_map').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []) as MapCell[];
}

/** ค้นหาสินค้าสำหรับหน้า Desktop */
export async function searchItems(opts: {
  q?: string;
  onlyMissing?: boolean;
  limit?: number;
  offset?: number;
  /** กรองเฉพาะโซนนี้ — null/'' = ทุกโซน (ต้องรัน 0005_search_by_zone.sql ก่อน) */
  zone?: string | null;
}): Promise<SearchRow[]> {
  const { data, error } = await supabase.rpc('search_items', {
    q: opts.q ?? '',
    only_missing: opts.onlyMissing ?? false,
    lim: opts.limit ?? 50,
    off: opts.offset ?? 0,
    zone_filter: opts.zone ?? null,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as SearchRow[];
}

/** บันทึก location — trigger ที่ DB จะเขียนประวัติให้เอง */
export async function saveLocation(
  itemId: string,
  location: string,
  updatedBy: string,
  note?: string | null
) {
  const value = location.trim();
  if (!value) throw new Error('กรุณากรอกตำแหน่งจัดเก็บ');

  const { error } = await supabase.from('item_locations').upsert(
    {
      item_id: itemId,
      location: value,
      note: note?.trim() || null,
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'item_id' }
  );
  if (error) throw new Error(error.message);
}

export async function deleteLocation(itemId: string) {
  const { error } = await supabase.from('item_locations').delete().eq('item_id', itemId);
  if (error) throw new Error(error.message);
}

/**
 * ค่า location ที่เคยใช้ สำหรับ autocomplete
 * ดึงมาทั้งหมดแล้ว dedupe ฝั่ง client — จำนวนตำแหน่งจริงในคลังมีไม่มาก
 */
export async function listLocations(): Promise<string[]> {
  const { data, error } = await supabase
    .from('item_locations')
    .select('location')
    .order('location');
  if (error) throw new Error(error.message);

  const set = new Set<string>();
  for (const r of (data ?? []) as { location: string }[]) {
    if (r.location) set.add(r.location);
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'th'));
}

export async function listHistory(itemId?: string, limit = 100): Promise<HistoryRow[]> {
  let q = supabase
    .from('location_history')
    .select('*')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (itemId) q = q.eq('item_id', itemId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as HistoryRow[];
}

/** ความคืบหน้าการกรอก location — ใช้เป็น KPI บนหน้า Desktop */
export async function getProgress(): Promise<{ filled: number; total: number }> {
  const [items, locs] = await Promise.all([
    supabase.from('items').select('*', { count: 'exact', head: true }),
    supabase.from('item_locations').select('*', { count: 'exact', head: true }),
  ]);
  if (items.error) throw new Error(items.error.message);
  if (locs.error) throw new Error(locs.error.message);
  return { filled: locs.count ?? 0, total: items.count ?? 0 };
}

/** เพิ่มสินค้าใหม่พร้อมบาร์โค้ดแรก (ใช้ตอนสแกนแล้วไม่พบ) */
export async function createItem(opts: {
  itemId: string;
  name: string;
  barcode: string;
  unit?: string | null;
  category?: string | null;
}) {
  const { error: e1 } = await supabase.from('items').upsert(
    { item_id: opts.itemId, name: opts.name.trim(), category: opts.category?.trim() || null },
    { onConflict: 'item_id' }
  );
  if (e1) throw new Error(e1.message);

  const { error: e2 } = await supabase.from('barcodes').upsert(
    {
      barcode: opts.barcode.trim(),
      item_id: opts.itemId,
      unit: opts.unit?.trim() || null,
      base_multiple: 1,
    },
    { onConflict: 'barcode' }
  );
  if (e2) throw new Error(e2.message);
}

/**
 * ลบผ่าน delete_item() ไม่ลบตาราง items ตรง — ต้องจดรหัสลง deleted_items ด้วย
 * ไม่งั้น npm run import จะเพิ่มสินค้ากลับมา (ดู 0007_deleted_items.sql)
 */
export async function deleteItem(itemId: string, deletedBy: string) {
  const { error } = await supabase.rpc('delete_item', { p_item_id: itemId, p_by: deletedBy });
  if (error) throw new Error(error.message);
}
