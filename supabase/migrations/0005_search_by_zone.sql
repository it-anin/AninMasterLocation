-- ─────────────────────────────────────────────────────────────────────
-- 0005 · กรองรายการสินค้าตามโซน (หน้าจัดการข้อมูลบน Desktop)
--
-- ปัญหา: เดิมกรองโซนได้ด้วยการพิมพ์ในช่องค้นหาเท่านั้น แต่ `q` ค้นแบบ
--        `location ilike '%C%'` ซึ่งไปแมตช์ทั้งชื่อสินค้า, `DELETE`, `PRE`
--        พิมพ์ "C" จึงได้ 3,801 รายการที่ไม่เกี่ยวกับโซน C เลย
--
-- แก้: เพิ่มพารามิเตอร์ `zone_filter` กรองจากคอลัมน์ `zone` ที่แยกไว้แล้ว
--      (generated column จาก 0004) จึงตรงเป้าเสมอ
--
-- ⚠️ เพิ่มพารามิเตอร์ต่อท้ายและให้มี default ทุกตัว โค้ดเดิมที่เรียกโดยไม่ส่ง
--    zone_filter จึงยังทำงานได้เหมือนเดิม ไม่ต้องแก้พร้อมกัน
--
-- รันใน Supabase SQL Editor เท่านั้น
-- ─────────────────────────────────────────────────────────────────────

-- signature เปลี่ยน (เพิ่มพารามิเตอร์) ต้อง drop ตัวเก่าก่อน
drop function if exists anin_loc.search_items(text, boolean, int, int);

create or replace function anin_loc.search_items(
  q            text default '',
  only_missing boolean default false,   -- true = เอาเฉพาะที่ยังไม่มี location
  lim          int default 50,
  off          int default 0,
  zone_filter  text default null         -- null/'' = ทุกโซน · 'C' = เฉพาะโซน C
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
      l.location, l.note, l.updated_by, l.updated_at
    from anin_loc.items i
    left join anin_loc.item_locations l on l.item_id = i.item_id
    where
      (not only_missing or l.item_id is null)
      -- กรองโซนจากคอลัมน์ zone ที่แยกไว้แล้ว ไม่ใช่ค้นในข้อความ location
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
    f.*,
    array(
      select b.barcode from anin_loc.barcodes b
       where b.item_id = f.item_id order by b.barcode
    ) as barcodes,
    count(*) over () as total_count
  from filtered f
  order by f.name
  limit lim offset off;
$$;

-- ⚠️ DROP FUNCTION ลบ grant ทิ้งด้วย ต้อง grant คืน ไม่งั้นหน้าจัดการพัง
grant execute on function anin_loc.search_items(text, boolean, int, int, text) to anon;
grant execute on function anin_loc.search_items(text, boolean, int, int, text) to service_role;


-- ── ตรวจผลหลังรัน ──────────────────────────────────────────────────
-- ควรได้เฉพาะสินค้าที่ zone = 'C' จริงๆ ไม่ใช่ DELETE/PRE ที่มีตัว C
--
-- select location, name from anin_loc.search_items('', false, 10, 0, 'C');
--
-- จำนวนต่อโซน:
-- select zone, count(*) from anin_loc.item_locations
-- where zone is not null group by zone order by zone;
