-- ─────────────────────────────────────────────────────────────────────
-- 0007 · จำสินค้าที่ลบแล้ว ไม่ให้ npm run import เพิ่มกลับ
--
-- import-catalog.mjs upsert ทุกสินค้าใน R05.106.CSV — สินค้าที่ลบจากหน้าจัดการ
-- แต่ยังอยู่ใน ProMaxx จะกลับมาทุกครั้งที่ import (ไม่มีตำแหน่ง เพราะถูก cascade ลบไปแล้ว)
-- ปุ่ม "ลบสินค้า" จึงลบผ่าน delete_item() ซึ่งจดรหัสลง deleted_items ด้วย
-- แล้วสคริปต์ import ข้ามรหัสที่อยู่ในตารางนี้
--
-- รันใน Supabase SQL Editor เท่านั้น — ต้องรันก่อน deploy เว็บที่เรียก delete_item()
-- ─────────────────────────────────────────────────────────────────────


-- ── 1. ตารางสินค้าที่ลบแล้ว ──────────────────────────────────────────
-- ไม่มี FK ไป items — แถวใน items ถูกลบไปแล้ว
create table if not exists anin_loc.deleted_items (
  item_id     text primary key,
  name        text,                  -- ชื่อตอนลบ ไว้ดูว่าลบอะไรไป
  deleted_by  text,
  deleted_at  timestamptz not null default now()
);

-- anon อ่านได้อย่างเดียว — เขียนผ่าน delete_item() (security definer) เท่านั้น
alter table anin_loc.deleted_items enable row level security;
drop policy if exists deleted_items_read on anin_loc.deleted_items;
create policy deleted_items_read on anin_loc.deleted_items
  for select to anon using (true);

grant select on anin_loc.deleted_items to anon;
grant select, insert, update, delete on anin_loc.deleted_items to service_role;


-- ── 2. ลบสินค้า + จดรหัส ใน transaction เดียว ────────────────────────
-- barcodes และ item_locations หายตาม ON DELETE CASCADE
-- ตำแหน่งที่หายไปถูกบันทึกใน location_history โดย trigger เดิม
create or replace function anin_loc.delete_item(p_item_id text, p_by text default null)
returns void
language plpgsql
security definer
set search_path = anin_loc, pg_temp
as $$
begin
  insert into anin_loc.deleted_items (item_id, name, deleted_by)
  select i.item_id, i.name, coalesce(nullif(trim(p_by), ''), 'ไม่ระบุ')
  from anin_loc.items i
  where i.item_id = p_item_id
  on conflict (item_id) do update
    set name = excluded.name, deleted_by = excluded.deleted_by, deleted_at = now();

  delete from anin_loc.items where item_id = p_item_id;
end;
$$;

revoke all on function anin_loc.delete_item(text, text) from public;
grant execute on function anin_loc.delete_item(text, text) to anon;
grant execute on function anin_loc.delete_item(text, text) to service_role;


-- ─────────────────────────────────────────────────────────────────────
-- ตรวจผล / ใช้งาน
-- ─────────────────────────────────────────────────────────────────────
-- ดูรายการที่ลบแล้ว:
--   select * from anin_loc.deleted_items order by deleted_at desc;
--
-- เอาสินค้ากลับ (ยกเลิกการลบ) — ลบรหัสออกจากรายการ แล้วรัน npm run import
-- สินค้ากลับมาพร้อมบาร์โค้ด แต่ไม่มีตำแหน่ง ต้องกรอกใหม่ในชีต (เมนู "อัปเดตจากระบบ")
--   delete from anin_loc.deleted_items where item_id = 'XXXXXX';
