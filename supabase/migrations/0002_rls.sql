-- ═══════════════════════════════════════════════════════════════════
-- AninMaster Location — Row Level Security
-- ═══════════════════════════════════════════════════════════════════
-- โมเดลความปลอดภัย: ระบบใช้ login แบบ "รหัสร่วม" ตามที่ตกลงไว้
-- ไม่มี identity รายคนในระดับฐานข้อมูล ทุก request จาก client ใช้ anon key
--
-- ⚠️ ความเสี่ยงที่ยอมรับ: ใครก็ตามที่รู้ URL + anon key จะอ่าน/แก้ข้อมูลได้
--    แม้ไม่รู้รหัสหน้าเว็บ เพราะรหัสถูกเช็คฝั่ง client เท่านั้น
--    ยอมรับได้เพราะเป็นข้อมูลตำแหน่งสินค้าภายในคลัง ไม่ใช่ข้อมูลส่วนบุคคล
--    ถ้าภายหลังต้องการความเข้มงวดขึ้น ให้ย้ายไป Supabase Auth
--    แล้วเปลี่ยน `to anon` เป็น `to authenticated` ในไฟล์นี้
--
-- ⚠️ ห้ามนำ service_role key ไปไว้ฝั่ง client เด็ดขาด — ใช้เฉพาะใน scripts/
-- ═══════════════════════════════════════════════════════════════════

alter table anin_loc.items           enable row level security;
alter table anin_loc.barcodes        enable row level security;
alter table anin_loc.item_locations  enable row level security;
alter table anin_loc.location_history enable row level security;


-- ── items / barcodes: อ่านได้ และแก้ได้ผ่านหน้า Desktop ─────────────
drop policy if exists items_all on anin_loc.items;
create policy items_all on anin_loc.items
  for all to anon using (true) with check (true);

drop policy if exists barcodes_all on anin_loc.barcodes;
create policy barcodes_all on anin_loc.barcodes
  for all to anon using (true) with check (true);


-- ── item_locations: หัวใจของระบบ พนักงานแก้ได้จากหน้างาน ────────────
drop policy if exists item_locations_all on anin_loc.item_locations;
create policy item_locations_all on anin_loc.item_locations
  for all to anon using (true) with check (true);


-- ── location_history: อ่านได้อย่างเดียว ─────────────────────────────
-- เขียนผ่าน trigger (security definer) เท่านั้น จึงไม่ต้องมี insert policy
-- ทำให้ประวัติแก้ไขย้อนหลังไม่ได้จากฝั่ง client
drop policy if exists history_read on anin_loc.location_history;
create policy history_read on anin_loc.location_history
  for select to anon using (true);


-- ── สิทธิ์ระดับ schema ──────────────────────────────────────────────
grant usage on schema anin_loc to anon;
grant select, insert, update, delete
  on anin_loc.items, anin_loc.barcodes, anin_loc.item_locations to anon;
grant select on anin_loc.location_history to anon;
grant select on anin_loc.v_barcode_lookup to anon;
grant usage, select on all sequences in schema anin_loc to anon;
grant execute on function anin_loc.search_items(text, boolean, int, int) to anon;


-- ═══════════════════════════════════════════════════════════════════
-- ⚠️ ขั้นตอนที่ลืมบ่อยที่สุด — ต้องทำด้วยมือบน Dashboard
-- ═══════════════════════════════════════════════════════════════════
-- Supabase Dashboard → Settings → API → Exposed schemas → เพิ่ม `anin_loc`
--
-- ถ้าไม่ทำ จะเจอ error นี้ทั้งที่ตารางสร้างสำเร็จแล้ว:
--   "The schema must be one of the following: public, graphql_public"
-- ═══════════════════════════════════════════════════════════════════
