import { WarehouseMap } from './WarehouseMap';
import { WarehouseMiniMap } from './WarehouseMiniMap';
import { WarehouseFloorPlan, FLOOR_PLAN_ZONES } from './WarehouseFloorPlan';
import { ShelfFront, SHELF_ZONES, isMirroredZone } from './ShelfFront';
import type { LookupResult, MapCell } from '../lib/queries';
import { LOCATION_SHEET_URL } from '../lib/supabase';
import { isAndroidMode } from '../lib/useScanner';

/**
 * การ์ดผลลัพธ์ — ผังคลัง + ภาพชั้นวาง + รายละเอียดสินค้า
 *
 * ใช้ร่วมกันทั้งหน้า PDA (สแกน) และหน้า Desktop (ค้นหา)
 * แยกออกมาเป็น component เพื่อไม่ให้ต้องเขียน logic การเลือกผัง 2 ที่
 * ซึ่งจะทำให้สองหน้าจอเพี้ยนจากกันเมื่อแก้ข้างเดียว
 */

/**
 * ตัดสินว่าจะวาดผังหรือแสดงรหัสตัวใหญ่แทน
 *
 * ต้องครบ 2 อย่าง:
 *  1. รหัสแยกโซน/เชลฟ์ออกได้ (zone + aisle ไม่ null)
 *  2. มีผังให้วาดจริง — ถ้าทั้งคลังมีอยู่ตำแหน่งเดียว ตารางช่องเดียวไม่มีประโยชน์
 *     สู้แสดงรหัสตัวใหญ่ชัดๆ ดีกว่า
 */
export function canMap(
  found: LookupResult,
  cells: MapCell[]
): found is LookupResult & { zone: string; aisle: number } {
  if (!found.zone || found.aisle == null) return false;
  const zones = new Set(cells.map((c) => c.zone));
  zones.add(found.zone);
  return cells.length >= 2 || zones.size >= 2;
}

interface Props {
  found: LookupResult;
  mapCells: MapCell[];
  onEdit: () => void;
}

export function LocationResult({ found, mapCells, onEdit }: Props) {
  return (
    <div className={`card ${found.location ? 'card-ok' : 'card-warn'}`}>
      {found.location ? (
        // แผนผังใช้ได้ต่อเมื่อรหัสแยกโซน/เชลฟ์ออก (เช่น J61)
        // ถ้าเป็นข้อความอิสระ (เช่น "PRE") ให้แสดงรหัสตัวใหญ่แทน
        canMap(found, mapCells) ? (
          <>
            <div className="loc-code">{found.location}</div>
            <div className="loc-label">
              โซน {found.zone} · เชลฟ์ที่ {found.aisle}
              {found.slot != null ? ` · ชั้นที่ ${found.slot} (นับจากล่างขึ้นบน) ` : ''}
            </div>

            <div className="step-tag">
              <i>1</i> เดินไปชั้นวางโซน {found.zone}
            </div>
            {FLOOR_PLAN_ZONES.has(found.zone) ? (
              // โซนอยู่ในห้องหลัก — โชว์ผังภาพชั้นวางจริงแทน chip ย่อ
              <WarehouseFloorPlan activeZone={found.zone} />
            ) : (
              // โซนอยู่นอกห้อง (เช่น L, M, N, O) — ไม่มีในภาพผังห้องหลัก
              <WarehouseMiniMap cells={mapCells} activeZone={found.zone} />
            )}

            {SHELF_ZONES.has(found.zone) ? (
              <>
                <div className="step-tag">
                  <i>2</i> เชลฟ์ที่ {found.aisle}
                  {found.slot != null ? ` · ชั้นที่ ${found.slot} (จากล่างขึ้นบน) ` : ''}
                </div>
                <ShelfFront zone={found.zone} shelf={found.aisle} slot={found.slot} />
                <div className="sf-axis">
                  {/* โซน B, D, F, H, J นับเชลฟ์จากขวา ป้ายบอกทิศต้องสลับตาม */}
                  <span>
                    {isMirroredZone(found.zone) ? 'เชลฟ์ที่ 1 อยู่ขวาสุด →' : '← เชลฟ์ที่ 1'}
                  </span>
                  <span>ชั้น 1 = นับจากล่างขึ้นบน</span>
                </div>
              </>
            ) : (
              // โซนไม่มี layout ชั้นวาง — ใช้ตารางย่อแบบเดิม
              <WarehouseMap
                cells={mapCells}
                activeZone={found.zone}
                activeAisle={found.aisle}
                activeLabel={found.location}
              />
            )}
          </>
        ) : (
          <>
            <div className="loc-label">ตำแหน่งจัดเก็บ</div>
            <div className="loc-value">{found.location}</div>
          </>
        )
      ) : (
        <div className="loc-missing">ยังไม่ได้ระบุตำแหน่ง</div>
      )}

      <div className="item-name">{found.name}</div>

      {found.note && <div className="note">📝 {found.note}</div>}

      <div className="meta">
        {found.item_id}
        {found.unit ? ` · ${found.unit}` : ''}
      </div>
      <div className="barcode-line">{found.barcode}</div>

      {found.updated_by && (
        <div className="meta-small">
          แก้ไขล่าสุด: {found.updated_by}
          {found.location_updated_at
            ? ` · ${new Date(found.location_updated_at).toLocaleDateString('th-TH')}`
            : ''}
        </div>
      )}

      {/* โหมด Google Sheet: แก้ได้ที่ชีตที่เดียว ไม่เปิด EditLocationDialog
          บน PDA ไม่ใส่ลิงก์ — เปิดชีตในจอ 480px ใช้งานไม่ได้จริง */}
      {!LOCATION_SHEET_URL ? (
        <button className="btn btn-primary" onClick={onEdit}>
          {found.location ? 'แก้ไขตำแหน่ง' : '➕ กำหนดตำแหน่ง'}
        </button>
      ) : isAndroidMode ? (
        <div className="meta-small">แก้ตำแหน่งได้ที่ Google Sheet บนคอมพิวเตอร์</div>
      ) : (
        <a className="btn btn-primary" href={LOCATION_SHEET_URL} target="_blank" rel="noreferrer">
          แก้ตำแหน่งใน Google Sheet ↗
        </a>
      )}
    </div>
  );
}
