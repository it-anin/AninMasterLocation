-- ─────────────────────────────────────────────────────────────────────
-- 0004 · แยก "ชั้น" กับ "ช่อง" ออกจากกัน
--
-- ปัญหา: รหัสจริงในคลังเป็นแบบ <โซน><ชั้น><ช่อง> เช่น J61 = โซน J ชั้น 6 ช่อง 1
--        แต่ regex เดิมอ่าน J61 ว่า "โซน J ชั้น 61" หน้าจอจึงขึ้น "ชั้นที่ 61"
--        ข้อมูลจริง 4,722 แถวเป็นรูปแบบนี้ทั้งหมด → อ่านผิดทุกแถว
--
-- ⚠️ regex ต้องตรงกับ parseLocation() ใน src/lib/queries.ts เป๊ะๆ (กฎเหล็กข้อ 6)
--    ถ้าแก้ที่นี่ต้องแก้ที่นั่นด้วย ไม่งั้นผังจะไฮไลท์คนละช่องกับที่ DB เก็บ
--
-- รันใน Supabase SQL Editor เท่านั้น — ห้ามใช้ migration tool ที่ generate DDL
-- ─────────────────────────────────────────────────────────────────────

-- ── 1. ลบ view ที่อ้างถึง zone/aisle ก่อน ─────────────────────────────
-- ⚠️ ต้องลบ view ก่อนลบ column ไม่งั้นได้ error 2BP01:
--    "cannot drop column zone ... because other objects depend on it"
--    ไม่ใช้ DROP ... CASCADE เพราะมันจะลบของที่เราไม่ได้ตั้งใจลบไปด้วย
--    สั่งลบเองทีละตัวแล้วสร้างคืนในขั้นที่ 4-5 ปลอดภัยกว่า
drop view if exists anin_loc.v_barcode_lookup;
drop view if exists anin_loc.v_warehouse_map;


-- ── 2. ลบ generated column เดิม (ต้องลบก่อนถึงจะนิยามใหม่ได้) ──────────
-- index ถูกลบตาม column ไปเอง ไม่ต้องสั่งแยก
alter table anin_loc.item_locations
  drop column if exists zone,
  drop column if exists aisle;


-- ── 3. นิยามใหม่: โซน · ชั้น · ช่อง ───────────────────────────────────
--
-- รูปแบบที่อ่านออก (เรียงตามลำดับที่ตรวจ):
--   <ตัวอักษร><เลข 2 หลัก>   J61  → โซน J ชั้น 6 ช่อง 1   ← รูปแบบหลัก 4,722 แถว
--   <ตัวอักษร><คั่น><เลข>    A-03 → โซน A ชั้น 3 ช่อง null (รูปแบบเดิม ยังรองรับ)
--
-- ที่เหลืออ่านไม่ออก → null ทั้งหมด แล้วหน้าจอ fallback ไปแสดงรหัสตัวใหญ่
--   PRE · COOL · DELETE · N · M · OFF · FREE   (4,421 แถว)
--   L1 · L2                                    (267 แถว — เลขหลักเดียว ไม่ใช่ชั้น+ช่อง)
--   กล่อง · โหล · แผง · หลอด                    (17 แถว)
-- การ fallback ไม่ใช่ error — เป็นพฤติกรรมที่ตั้งใจ

alter table anin_loc.item_locations
  add column if not exists zone text
    generated always as (
      -- ⚠️ zone ต้องเป็น null เมื่ออ่านชั้นไม่ได้ ไม่งั้นจะไม่ตรงกับ parseLocation()
      --    เช่น L1 (เลขหลักเดียว ไม่มีตัวคั่น) และ A123 (เลข 3 หลัก) ต้องได้ null
      --    ถ้าปล่อยให้ได้ zone='L' แต่ aisle=null ข้อมูลสองฝั่งจะไม่ตรงกัน
      case
        when location ~ '^\s*[A-Za-z]+\s*\d{2}\s*$'
          or location ~ '^\s*[A-Za-z]+\s*[-_ ]\s*\d+\s*$'
        then upper((regexp_match(location, '^\s*([A-Za-z]+)'))[1])
      end
    ) stored,

  -- ชั้น: ถ้าเป็นเลข 2 หลัก เอาหลักแรก · ถ้ามีตัวคั่นหรือหลักเดียว เอาทั้งก้อน
  add column if not exists aisle int
    generated always as (
      case
        when location ~ '^\s*[A-Za-z]+\s*\d{2}\s*$'
          then substring((regexp_match(location, '^\s*[A-Za-z]+\s*(\d{2})\s*$'))[1] from 1 for 1)::int
        when location ~ '^\s*[A-Za-z]+\s*[-_ ]\s*\d+\s*$'
          then ((regexp_match(location, '^\s*[A-Za-z]+\s*[-_ ]\s*(\d+)\s*$'))[1])::int
      end
    ) stored,

  -- ช่อง: มีเฉพาะรูปแบบเลข 2 หลักติดกัน (J61 → 1)
  add column if not exists slot int
    generated always as (
      case
        when location ~ '^\s*[A-Za-z]+\s*\d{2}\s*$'
          then substring((regexp_match(location, '^\s*[A-Za-z]+\s*(\d{2})\s*$'))[1] from 2 for 1)::int
      end
    ) stored;

create index if not exists item_locations_zone_aisle_idx
  on anin_loc.item_locations (zone, aisle);


-- ── 4. สร้าง view ผังคลังคืน — เพิ่ม slot ─────────────────────────────
-- v_warehouse_map รวมชั้น/ช่องที่มีของจริง ใช้สร้างผังโดยไม่ต้องตั้งค่าล่วงหน้า
create view anin_loc.v_warehouse_map as
select
  zone,
  aisle,
  slot,
  count(*)::int as item_count
from anin_loc.item_locations
where zone is not null and aisle is not null
group by zone, aisle, slot
order by zone, aisle, slot;


-- ── 5. สร้าง view lookup คืน — ส่ง slot ไปให้หน้าจอด้วย ───────────────
create view anin_loc.v_barcode_lookup as
select
  b.barcode,
  b.unit,
  b.base_multiple,
  i.item_id,
  i.name,
  i.category,
  l.location,
  l.zone,
  l.aisle,
  l.slot,
  l.note,
  l.updated_by,
  l.updated_at as location_updated_at
from anin_loc.barcodes b
join anin_loc.items i on i.item_id = b.item_id
left join anin_loc.item_locations l on l.item_id = b.item_id;


-- ── 6. คืนสิทธิ์ให้ view ที่สร้างใหม่ ─────────────────────────────────
-- ⚠️ DROP VIEW ลบ grant ทิ้งไปด้วย ถ้าไม่ grant คืน หน้าสแกนจะพังทันที
--    ด้วย error "permission denied for view v_barcode_lookup"
--    (ค่าเดิมมาจาก 0002_rls.sql และ 0003_service_role_grants.sql)
grant select on anin_loc.v_barcode_lookup to anon;
grant select on anin_loc.v_warehouse_map to anon;
grant select on anin_loc.v_barcode_lookup, anin_loc.v_warehouse_map to service_role;


-- ── 7. ตรวจผลหลังรัน ──────────────────────────────────────────────────
-- ควรได้ J61 → J/6/1 · A-03 → A/3/null · PRE → null/null/null
--
-- select location, zone, aisle, slot
-- from anin_loc.item_locations
-- where location in ('J61','A14','C32','A-03','PRE','L1')
-- order by location;
--
-- จำนวนแถวที่แยกได้ (ควรได้ราว 4,722):
-- select count(*) from anin_loc.item_locations where slot is not null;
