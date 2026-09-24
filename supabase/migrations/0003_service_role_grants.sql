-- ═══════════════════════════════════════════════════════════════════
-- AninMaster Location — สิทธิ์สำหรับ service_role
-- ═══════════════════════════════════════════════════════════════════
-- 0002_rls.sql grant สิทธิ์ระดับ schema/table ให้ `anon` เท่านั้น
-- service_role bypass RLS ได้ก็จริง แต่ "GRANT USAGE ON SCHEMA" และ
-- "GRANT ... ON TABLE" เป็นสิทธิ์คนละชั้นกับ RLS — ถ้าไม่ grant ให้
-- service_role ด้วย scripts/import-*.mjs (ที่ใช้ SUPABASE_SERVICE_KEY)
-- จะเจอ "permission denied for schema anin_loc" ทั้งที่ RLS policy ผ่านหมด
--
-- วิธีรัน: Supabase Dashboard → SQL Editor → วางทั้งไฟล์ → Run
-- ═══════════════════════════════════════════════════════════════════

grant usage on schema anin_loc to service_role;
grant select, insert, update, delete
  on anin_loc.items, anin_loc.barcodes, anin_loc.item_locations, anin_loc.location_history
  to service_role;
grant select on anin_loc.v_barcode_lookup, anin_loc.v_warehouse_map to service_role;
grant usage, select on all sequences in schema anin_loc to service_role;
grant execute on function anin_loc.search_items(text, boolean, int, int) to service_role;
