-- ─────────────────────────────────────────────────────────────────────
-- 0006 · แก้ตำแหน่งผ่าน Google Sheet (sync ทางเดียว Sheet → DB)
--
-- Google Sheet เป็นที่แก้ตำแหน่งที่เดียว — Apps Script ใน sheet/Code.gs
-- ส่งค่าเข้ามาผ่าน anin_loc.sheet_apply() ฟังก์ชันเดียว ไม่เขียนตารางตรง
-- เพื่อให้การจัดประเภท/เพดานความปลอดภัย/ประวัติ อยู่ที่ DB ที่เดียว
--
-- ⚠️ ไม่แตะ generated column zone/aisle/slot — regex ยังเป็นของ 0004 (กฎเหล็กข้อ 6)
--
-- รันใน Supabase SQL Editor เท่านั้น
-- ─────────────────────────────────────────────────────────────────────


-- ── 1. อนุญาต source = 'sheet' ในประวัติ ─────────────────────────────
-- ชื่อ constraint เป็นชื่อที่ Postgres ตั้งให้เองจาก check ใน 0001
alter table anin_loc.location_history
  drop constraint if exists location_history_source_check;
alter table anin_loc.location_history
  add constraint location_history_source_check
  check (source in ('pda', 'web', 'import', 'sheet'));


-- ── 2. trigger อ่าน source / คนแก้ จาก setting ของ transaction ─────────
-- sheet_apply() ตั้ง anin_loc.source / anin_loc.editor ไว้ก่อนเขียน
-- ถ้าไม่มีใครตั้ง (แก้จากเว็บ/SQL มือ) ได้ 'web' และ old.updated_by เหมือนเดิมทุกอย่าง
--
-- ⚠️ ต้อง nullif(..., '') เพราะหลัง transaction ที่เคยตั้งค่าจบไป
--    current_setting() คืน '' ไม่ใช่ null ใน connection เดิม
--
-- create or replace ไม่ลบ trigger ที่ผูกอยู่ ไม่ต้องสร้าง trigger ใหม่
create or replace function anin_loc.fn_log_location_change()
returns trigger
language plpgsql
security definer
set search_path = anin_loc, pg_temp
as $$
declare
  v_source text := coalesce(nullif(current_setting('anin_loc.source', true), ''), 'web');
begin
  if tg_op = 'INSERT' then
    insert into anin_loc.location_history
      (item_id, old_location, new_location, action, changed_by, source)
    values (new.item_id, null, new.location, 'create', new.updated_by, v_source);
    return new;

  elsif tg_op = 'UPDATE' then
    -- บันทึกเฉพาะตอน location เปลี่ยนจริง (แก้แค่ note ไม่ต้องบันทึก)
    if new.location is distinct from old.location then
      insert into anin_loc.location_history
        (item_id, old_location, new_location, action, changed_by, source)
      values (new.item_id, old.location, new.location, 'update', new.updated_by, v_source);
    end if;
    new.updated_at := now();
    return new;

  else -- DELETE
    -- แถวที่ถูกลบไม่มี new.updated_by ให้ใช้ — เอาคนที่ลบจาก setting ก่อน
    -- ไม่มีค่อยใช้คนแก้ล่าสุดเหมือนเดิม
    insert into anin_loc.location_history
      (item_id, old_location, new_location, action, changed_by, source)
    values (
      old.item_id, old.location, null, 'delete',
      coalesce(nullif(current_setting('anin_loc.editor', true), ''), old.updated_by),
      v_source
    );
    return old;
  end if;
end;
$$;


-- ── 3. sheet_apply — ทางเข้าเดียวของ Google Sheet ────────────────────
--
-- p_rows        [{item_id, location, note}, ...] ค่าตามที่เห็นในชีต
-- p_editor      อีเมลคนแก้ (ถ้า Apps Script รู้) — ไม่มีได้ 'google-sheet'
-- p_full        true = p_rows คือทั้งชีต → รายงาน item ที่มีตำแหน่งใน DB แต่ไม่มีในชีต
-- p_max_changes เพดานความปลอดภัย: ถ้าจะเปลี่ยนเกินนี้ ไม่เขียนอะไรเลย
--               กันกรณี sort คอลัมน์เดียว / ลบคอลัมน์ทิ้ง แล้วซิงก์อัตโนมัติพังทั้งคลัง
-- p_dry_run     true = จัดประเภทอย่างเดียว ไม่เขียน
--
-- การจัดประเภทแต่ละแถว:
--   insert        ยังไม่มีตำแหน่งใน DB
--   update        location หรือ note ต่างจาก DB
--   delete        ช่องตำแหน่งว่าง แต่ DB มีค่า
--   unchanged     ตรงกับ DB แล้ว
--   unknown_item  item_id ไม่มีใน items (FK จะไม่ยอมอยู่แล้ว)
--   duplicate     item_id ซ้ำในชีต → ไม่รู้ว่าแถวไหนถูก ข้ามทั้งหมด
--   missing_from_sheet  (เฉพาะ p_full) มีใน DB แต่ไม่มีในชีต → รายงานอย่างเดียว ไม่ลบ
--
-- ⚠️ ไม่กรองตามความยาว/รูปแบบ (กฎเหล็กข้อ 4) — A001, S00126 ต้องผ่าน
--
-- คืน jsonb ก้อนเดียว ไม่ใช่ returns table เพราะ PostgREST ตัดผลที่ 1,000 แถว
-- แต่ชีตมี ~8,000 แถว
--
-- ทำแบบ set-based ทั้งหมด ไม่วน loop — role anon มี statement timeout 3 วินาที
create or replace function anin_loc.sheet_apply(
  p_rows        jsonb,
  p_editor      text    default null,
  p_full        boolean default false,
  p_max_changes int     default null,
  p_dry_run     boolean default false
)
returns jsonb
language plpgsql
set search_path = anin_loc, pg_temp
as $$
declare
  v_editor  text := coalesce(nullif(btrim(p_editor), ''), 'google-sheet');
  v_plan    jsonb;
  v_changes int;
  v_applied boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows ต้องเป็น JSON array';
  end if;

  -- is_local = true → มีผลแค่ transaction นี้ ไม่รั่วไป request อื่นที่ใช้ connection ซ้ำ
  perform set_config('anin_loc.source', 'sheet', true);
  perform set_config('anin_loc.editor', v_editor, true);

  -- ── จัดประเภท (ยังไม่เขียน) ──
  -- ทำความสะอาดแบบเดียวกับ clean() ใน scripts/import-locations.mjs
  with raw as (
    select
      nullif(btrim(regexp_replace(coalesce(r->>'item_id',  ''), '\s+', ' ', 'g')), '') as item_id,
      nullif(btrim(regexp_replace(coalesce(r->>'location', ''), '\s+', ' ', 'g')), '') as location,
      nullif(btrim(regexp_replace(coalesce(r->>'note',     ''), '\s+', ' ', 'g')), '') as note
    from jsonb_array_elements(p_rows) as r
  ),
  input as (
    select raw.*, count(*) over (partition by raw.item_id) as copies
    from raw
    where raw.item_id is not null
  ),
  classified as (
    select distinct on (i.item_id)
      i.item_id,
      i.location,
      i.note,
      l.location as old_location,
      case
        when i.copies > 1                             then 'duplicate'
        when it.item_id is null                       then 'unknown_item'
        when i.location is null and l.item_id is null then 'unchanged'
        when i.location is null                       then 'delete'
        when l.item_id is null                        then 'insert'
        when i.location is distinct from l.location
          or i.note is distinct from l.note           then 'update'
        else 'unchanged'
      end as action
    from input i
    left join anin_loc.items it on it.item_id = i.item_id
    left join anin_loc.item_locations l on l.item_id = i.item_id
    order by i.item_id
  ),
  missing as (
    select l.item_id, null::text, null::text, l.location, 'missing_from_sheet'
    from anin_loc.item_locations l
    where p_full
      and not exists (select 1 from input i where i.item_id = l.item_id)
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)
    into v_plan
    from (select * from classified union all select * from missing) x;

  select count(*) into v_changes
    from jsonb_array_elements(v_plan) e
   where e->>'action' in ('insert', 'update', 'delete');

  v_applied := not p_dry_run
               and (p_max_changes is null or v_changes <= p_max_changes);

  -- ── เขียนจริง ──
  if v_applied and v_changes > 0 then
    delete from anin_loc.item_locations l
     using jsonb_to_recordset(v_plan) as p(item_id text, action text)
     where p.action = 'delete'
       and l.item_id = p.item_id;

    insert into anin_loc.item_locations (item_id, location, note, updated_by, updated_at)
    select p.item_id, p.location, p.note, v_editor, now()
      from jsonb_to_recordset(v_plan) as p(item_id text, location text, note text, action text)
     where p.action in ('insert', 'update')
    on conflict (item_id) do update
      set location   = excluded.location,
          note       = excluded.note,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at;
  end if;

  -- ── สรุปผล ──
  -- rows: ถ้าส่งมาทั้งชีต (p_full) คืนเฉพาะแถวที่ไม่ใช่ unchanged ให้ก้อนเล็ก
  --       ถ้าส่งมาไม่กี่แถว (แก้ในชีต) คืนทุกแถว ให้ชีตเขียนสถานะได้ครบ
  -- zone/aisle/slot อ่านหลังเขียน = ค่าที่ generated column แยกได้จริง
  return jsonb_build_object(
    'applied', v_applied,
    'changes', v_changes,
    'counts', coalesce((
      select jsonb_object_agg(action, n)
        from (select e->>'action' as action, count(*) as n
                from jsonb_array_elements(v_plan) e
               group by 1) c
    ), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'item_id',      p.item_id,
               'action',       p.action,
               'location',     p.location,
               'old_location', p.old_location,
               'zone',         l.zone,
               'aisle',        l.aisle,
               'slot',         l.slot))
        from jsonb_to_recordset(v_plan)
               as p(item_id text, action text, location text, old_location text)
        left join anin_loc.item_locations l on l.item_id = p.item_id
       where p.action <> 'unchanged' or not p_full
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function anin_loc.sheet_apply(jsonb, text, boolean, int, boolean) to anon;
grant execute on function anin_loc.sheet_apply(jsonb, text, boolean, int, boolean) to service_role;

-- ให้ PostgREST เห็นฟังก์ชันใหม่ทันที ไม่งั้นได้ "Could not find the function"
notify pgrst, 'reload schema';


-- ── ตรวจผลหลังรัน ──────────────────────────────────────────────────
-- ทดลองโดยไม่เขียน (p_dry_run = true) — 900157 ควรได้ unchanged ถ้ายังเป็น J11
--
-- select anin_loc.sheet_apply('[{"item_id":"900157","location":"J11"}]', 'test', false, null, true);
--
-- ทดลองเขียนจริงแล้วย้อนกลับ — ประวัติควรได้ source = 'sheet', changed_by = 'test'
--
-- begin;
-- select anin_loc.sheet_apply('[{"item_id":"900157","location":"J12"}]', 'test');
-- select item_id, old_location, new_location, changed_by, source
--   from anin_loc.location_history where item_id = '900157' order by id desc limit 1;
-- rollback;
--
-- เพดาน: 2 แถวที่เปลี่ยน แต่ให้เปลี่ยนได้ 1 → applied = false และ DB ไม่เปลี่ยน
--
-- select anin_loc.sheet_apply(
--   '[{"item_id":"900157","location":"J12"},{"item_id":"S00126","location":"PRE"}]',
--   'test', false, 1);
--
-- ซ้ำ / ไม่มีในระบบ / SKU มีตัวอักษร → duplicate, unknown_item, และ S00126
-- ต้องไม่ถูกกรองทิ้ง (ช่องว่าง + DB มี OFF → ได้ delete · เป็น dry run ไม่ลบจริง)
--
-- select anin_loc.sheet_apply(
--   '[{"item_id":"900157","location":"J11"},{"item_id":"900157","location":"J12"},
--     {"item_id":"NOPE-123","location":"A11"},{"item_id":"S00126","location":""}]',
--   'test', false, null, true);
