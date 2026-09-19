import { useMemo } from 'react';
import type { MapCell } from '../lib/queries';

interface Props {
  /** ผังทั้งหมดที่มีข้อมูลจริง */
  cells: MapCell[];
  /** โซน/ชั้นที่ต้องไฮไลท์ — ตำแหน่งของสินค้าที่เพิ่งสแกน */
  activeZone: string | null;
  activeAisle: number | null;
  /** รหัสเต็มไว้แสดงในช่องที่ไฮไลท์ เช่น A-03-2 */
  activeLabel: string | null;
}

/** จำนวนชั้นสูงสุดที่แสดงต่อโซน — เกินกว่านี้ตัดให้เลื่อนดูแทน */
const MAX_COLS = 6;

/**
 * ผังคลังแบบตาราง: แถว = โซน · คอลัมน์ = ชั้น
 *
 * ผังสร้างจากข้อมูลที่กรอกเข้ามาจริง (v_warehouse_map) ไม่ได้ตั้งค่าล่วงหน้า
 * ถ้าตำแหน่งที่สแกนไม่อยู่ในผัง (เช่นเพิ่งกรอกโซนใหม่) จะแทรกเข้าไปให้เห็นด้วย
 */
export function WarehouseMap({ cells, activeZone, activeAisle, activeLabel }: Props) {
  const rows = useMemo(() => {
    // รวมตำแหน่งที่กำลังไฮไลท์เข้าไปด้วย เผื่อเป็นโซน/ชั้นใหม่ที่ยังไม่มีในผัง
    const all: MapCell[] = [...cells];
    if (
      activeZone &&
      activeAisle != null &&
      !cells.some((c) => c.zone === activeZone && c.aisle === activeAisle)
    ) {
      all.push({ zone: activeZone, aisle: activeAisle, item_count: 1 });
    }

    const byZone = new Map<string, number[]>();
    for (const c of all) {
      const list = byZone.get(c.zone) ?? [];
      if (!list.includes(c.aisle)) list.push(c.aisle);
      byZone.set(c.zone, list);
    }

    return [...byZone.entries()]
      .map(([zone, aisles]) => ({ zone, aisles: aisles.sort((a, b) => a - b) }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
  }, [cells, activeZone, activeAisle]);

  if (rows.length === 0) return null;

  // โซนที่ไฮไลท์ควรอยู่ในสายตาเสมอ — ถ้าโซนเยอะ ตัดให้เหลือรอบๆ โซนนั้น
  const activeIdx = rows.findIndex((r) => r.zone === activeZone);
  const visible =
    rows.length <= 4 || activeIdx < 0
      ? rows.slice(0, 4)
      : rows.slice(Math.max(0, activeIdx - 1), Math.max(0, activeIdx - 1) + 4);

  return (
    <div className="map" role="img" aria-label={`ผังคลัง ตำแหน่ง ${activeLabel ?? 'ไม่ระบุ'}`}>
      {visible.map((row) => {
        const isActiveRow = row.zone === activeZone;
        // ชั้นในโซนที่ไฮไลท์ต้องเห็นชั้นนั้นเสมอ
        let aisles = row.aisles;
        if (aisles.length > MAX_COLS) {
          const ai = aisles.indexOf(activeAisle ?? -1);
          const start = isActiveRow && ai >= 0 ? Math.max(0, ai - 2) : 0;
          aisles = aisles.slice(start, start + MAX_COLS);
        }

        return (
          <div className="map-row" key={row.zone}>
            <div className={`map-zone ${isActiveRow ? 'on' : ''}`}>{row.zone}</div>
            <div className="map-cells">
              {aisles.map((a) => {
                const on = isActiveRow && a === activeAisle;
                return (
                  <div key={a} className={`map-cell ${on ? 'on' : ''}`}>
                    {on ? activeLabel ?? `${row.zone}-${pad(a)}` : pad(a)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}
