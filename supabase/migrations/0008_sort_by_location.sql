-- ─────────────────────────────────────────────────────────────────────
-- 0008 · หน้าจัดการข้อมูล: เรียงตามตำแหน่ง (โซน → เชลฟ์ → ชั้น) แทนชื่อสินค้า
--
-- เรียงจากคอลัมน์ zone/aisle/slot ที่แยกไว้แล้ว (generated column จาก 0004)
-- ไม่เรียงข้อความ location ตรงๆ — ข้อความจะได้ A10 ก่อน A2
--
--   1. รหัสที่แยกได้   A11 → A12 → A21 → … → B11 …  (aisle = เชลฟ์ · slot = ชั้น)
--   2. รหัสพิเศษ       COOL, DELETE, L1, OFF, PRE … เรียงตามตัวอักษร
--   3. ยังไม่มีตำแหน่ง  ท้ายสุด
--   ตำแหน่งเดียวกัน → เรียงตามชื่อ · สุดท้ายด้วย item_id ให้ลำดับตายตัว
--   (แบ่งหน้าด้วย offset ถ้าลำดับไม่ตายตัว แถวจะซ้ำ/หายข้ามหน้า)
--
-- signature และคอลัมน์ที่คืนเหมือน 0005 ทุกอย่าง → create or replace ได้เลย
-- ไม่ต้อง drop จึงไม่เสีย grant · ไม่แตะ regex ของ zone/aisle/slot (กฎเหล็กข้อ 6)
--
-- รันใน Supabase SQL Editor เท่านั้น
-- ─────────────────────────────────────────────────────────────────────

create or replace function anin_loc.search_items(
  q            text default '',
  only_missing boolean default false,
  lim          int default 50,
  off          int default 0,
  zone_filter  text default null
)
returns table (
  item_id      text,
  name         text,
  category     text,
  location     text,
  note         text,
  updated_by   text,
  updated_at   timestamptz,
  barcodes     text[],
  total_count  bigint
)
language sql
stable
set search_path = anin_loc, pg_temp
as $$
  with filtered as (
    select
      i.item_id, i.name, i.category,
      l.location, l.note, l.updated_by, l.updated_at,
      l.zone, l.aisle, l.slot
    from anin_loc.items i
    left join anin_loc.item_locations l on l.item_id = i.item_id
    where
      (not only_missing or l.item_id is null)
      and (
        zone_filter is null or zone_filter = ''
        or l.zone = upper(zone_filter)
      )
      and (
        q = '' or q is null
        or i.name ilike '%' || q || '%'
        or i.item_id ilike q || '%'
        or coalesce(l.location, '') ilike '%' || q || '%'
        or exists (
          select 1 from anin_loc.barcodes b
           where b.item_id = i.item_id and b.barcode like q || '%'
        )
      )
  )
  select
    f.item_id, f.name, f.category, f.location, f.note, f.updated_by, f.updated_at,
    array(
      select b.barcode from anin_loc.barcodes b
       where b.item_id = f.item_id order by b.barcode
    ) as barcodes,
    count(*) over () as total_count
  from filtered f
  order by
    (f.location is null),        -- ยังไม่มีตำแหน่ง ท้ายสุด
    (f.zone is null),            -- รหัสพิเศษ ต่อจากรหัสที่แยกได้
    f.zone, f.aisle, f.slot nulls first,
    f.location, f.name, f.item_id
  limit lim offset off;
$$;


-- ── ตรวจผลหลังรัน ──────────────────────────────────────────────────
-- ควรได้ A11, A12, … A21 … ตามลำดับ (ไม่ใช่ตามชื่อสินค้า)
--
-- select location, name from anin_loc.search_items('', false, 20, 0, null);
--
-- โซน C อย่างเดียว:
-- select location, name from anin_loc.search_items('', false, 20, 0, 'C');
