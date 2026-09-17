-- ═══════════════════════════════════════════════════════════════════
-- AninMaster Location — schema หลัก
-- ═══════════════════════════════════════════════════════════════════
-- ⚠️ กฎเหล็ก: ห้ามสร้าง/แก้ตารางใน schema `public` เด็ดขาด
--    `public` คือฐานข้อมูล POS ตัวจริงที่ใช้งานอยู่ (products, product_master,
--    customer_history, dl_medicines, ss_orders, app_page_settings)
--    ทุก statement ในไฟล์นี้ qualify ด้วย anin_loc. เสมอ
--
-- วิธีรัน: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ═══════════════════════════════════════════════════════════════════

create schema if not exists anin_loc;

-- สำหรับค้นหาชื่อสินค้าแบบ ILIKE '%คำ%' ให้เร็ว
create extension if not exists pg_trgm;


-- ── 1. สินค้า ───────────────────────────────────────────────────────
-- grain = 1 แถวต่อ 1 item (คาดหวัง 7,959 แถวจาก R05.106.CSV)
-- ตรวจแล้วว่าไม่มี item_id ไหนมีชื่อหรือหมวดขัดแย้งกัน จึงแยกออกมาได้สะอาด
create table if not exists anin_loc.items (
  item_id     text primary key,
  name        text not null,
  category    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists items_name_trgm
  on anin_loc.items using gin (name gin_trgm_ops);
create index if not exists items_category_idx
  on anin_loc.items (category);


-- ── 2. บาร์โค้ด ─────────────────────────────────────────────────────
-- grain = 1 แถวต่อ 1 barcode (คาดหวัง 10,863 แถว)
-- สินค้า 1 ตัวมีได้หลายบาร์โค้ดตามหน่วย เช่น 900157 มีทั้งแบบแผงและกล่อง
create table if not exists anin_loc.barcodes (
  barcode        text primary key,   -- ⚠️ TEXT เสมอ! มี 126 บาร์โค้ดขึ้นต้นด้วย 0
                                     --    และมีเลข 14-16 หลักที่เกินช่วง safe integer
  item_id        text not null
                   references anin_loc.items(item_id) on delete cascade,
  unit           text,               -- CF_UNITNAME เช่น แผง, กล่อง, ขวด
  base_multiple  numeric,            -- CF_BASEMULTIPLE จำนวนหน่วยย่อยต่อแพ็ก
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists barcodes_item_id_idx
  on anin_loc.barcodes (item_id);


-- ── 3. ตำแหน่งจัดเก็บ ───────────────────────────────────────────────
-- grain = 1 แถวต่อ 1 สินค้า (ผูกกับ item_id ไม่ใช่ barcode)
-- ยิงบาร์โค้ดไหนของสินค้าตัวเดียวกันก็ได้ location เดียวกัน
-- location เป็นข้อความอิสระ ไม่ validate รูปแบบ
create table if not exists anin_loc.item_locations (
  item_id     text primary key
                references anin_loc.items(item_id) on delete cascade,
  location    text not null,
  note        text,
  updated_by  text,                  -- ชื่อพนักงานที่เลือกหลัง login
  updated_at  timestamptz not null default now()
);

-- ใช้ตอนค้นว่า "ที่ตำแหน่งนี้มีสินค้าอะไรบ้าง" และตอนดึงค่า autocomplete
create index if not exists item_locations_location_idx
  on anin_loc.item_locations (location);


-- ── 4. ประวัติการแก้ไข ──────────────────────────────────────────────
create table if not exists anin_loc.location_history (
  id            bigserial primary key,
  item_id       text not null,
  old_location  text,
  new_location  text,
  action        text not null check (action in ('create', 'update', 'delete')),
  changed_by    text,
  source        text not null default 'web' check (source in ('pda', 'web', 'import')),
  changed_at    timestamptz not null default now()
);

create index if not exists location_history_item_idx
  on anin_loc.location_history (item_id, changed_at desc);
create index if not exists location_history_time_idx
  on anin_loc.location_history (changed_at desc);


-- ── 5. View สำหรับหน้าสแกน — query เดียวจบ ──────────────────────────
create or replace view anin_loc.v_barcode_lookup as
select
  b.barcode,
  b.unit,
  b.base_multiple,
  i.item_id,
  i.name,
  i.category,
  l.location,
  l.note,
  l.updated_by,
  l.updated_at as location_updated_at
from anin_loc.barcodes b
join anin_loc.items i on i.item_id = b.item_id
left join anin_loc.item_locations l on l.item_id = b.item_id;


-- ── 6. Trigger เขียนประวัติอัตโนมัติ ────────────────────────────────
-- เขียนที่ DB layer เพื่อให้ประวัติครบเสมอ ไม่ว่าจะแก้จาก PDA, เว็บ หรือ SQL มือ
create or replace function anin_loc.fn_log_location_change()
returns trigger
language plpgsql
security definer
set search_path = anin_loc, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into anin_loc.location_history
      (item_id, old_location, new_location, action, changed_by)
    values (new.item_id, null, new.location, 'create', new.updated_by);
    return new;

  elsif tg_op = 'UPDATE' then
    -- บันทึกเฉพาะตอน location เปลี่ยนจริง (แก้แค่ note ไม่ต้องบันทึก)
    if new.location is distinct from old.location then
      insert into anin_loc.location_history
        (item_id, old_location, new_location, action, changed_by)
      values (new.item_id, old.location, new.location, 'update', new.updated_by);
    end if;
    new.updated_at := now();
    return new;

  else -- DELETE
    insert into anin_loc.location_history
      (item_id, old_location, new_location, action, changed_by)
    values (old.item_id, old.location, null, 'delete', old.updated_by);
    return old;
  end if;
end;
$$;

drop trigger if exists trg_log_location_ins on anin_loc.item_locations;
create trigger trg_log_location_ins
  after insert on anin_loc.item_locations
  for each row execute function anin_loc.fn_log_location_change();

drop trigger if exists trg_log_location_upd on anin_loc.item_locations;
create trigger trg_log_location_upd
  before update on anin_loc.item_locations
  for each row execute function anin_loc.fn_log_location_change();

drop trigger if exists trg_log_location_del on anin_loc.item_locations;
create trigger trg_log_location_del
  after delete on anin_loc.item_locations
  for each row execute function anin_loc.fn_log_location_change();


-- ── 7. ฟังก์ชันค้นหาสำหรับหน้า Desktop ──────────────────────────────
-- ค้นได้ทั้งชื่อสินค้า / บาร์โค้ด / item_id / location ในช่องเดียว
create or replace function anin_loc.search_items(
  q            text default '',
  only_missing boolean default false,   -- true = เอาเฉพาะที่ยังไม่มี location
  lim          int default 50,
  off          int default 0
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
