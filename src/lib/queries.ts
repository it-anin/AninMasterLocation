import { supabase } from './supabase';

export interface LookupResult {
  barcode: string;
  unit: string | null;
  base_multiple: number | null;
  item_id: string;
  name: string;
  category: string | null;
  location: string | null;
  note: string | null;
  updated_by: string | null;
  location_updated_at: string | null;
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

/** ค้นหาสินค้าสำหรับหน้า Desktop */
export async function searchItems(opts: {
  q?: string;
  onlyMissing?: boolean;
  limit?: number;
  offset?: number;
}): Promise<SearchRow[]> {
  const { data, error } = await supabase.rpc('search_items', {
    q: opts.q ?? '',
    only_missing: opts.onlyMissing ?? false,
    lim: opts.limit ?? 50,
    off: opts.offset ?? 0,
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

export async function deleteItem(itemId: string) {
  // barcodes และ item_locations มี ON DELETE CASCADE จึงหายตามไปเอง
  const { error } = await supabase.from('items').delete().eq('item_id', itemId);
  if (error) throw new Error(error.message);
}
