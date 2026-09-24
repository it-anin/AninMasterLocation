import { useMemo } from 'react';
import type { MapCell } from '../lib/queries';

interface Props {
  /** ผังทั้งหมดที่มีข้อมูลจริง */
  cells: MapCell[];
  /** โซนที่ต้องไฮไลท์ — ตำแหน่งของสินค้าที่เพิ่งสแกน */
  activeZone: string | null;
}

/**
 * ผังคลังแบบย่อทั้งห้องในแถวเดียว — ให้เห็นภาพรวมทั้ง A-K ในหน้าจอเดียว
 * ก่อนจะลงรายละเอียดชั้นในผังแบบเต็ม (WarehouseMap) ของโซนที่ไฮไลท์
 *
 * เรียงตามลำดับ zone.localeCompare ซึ่งตรงกับตำแหน่งจริงในคลัง
 * (A เดี่ยว, แล้ว B-C, D-E, F-G, H-I, J-K จับคู่กันไปตามผังจริง)
 */
export function WarehouseMiniMap({ cells, activeZone }: Props) {
  const zones = useMemo(() => {
    const set = new Set(cells.map((c) => c.zone));
    if (activeZone) set.add(activeZone);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cells, activeZone]);

  if (zones.length < 2) return null;

  return (
    <div className="minimap" role="img" aria-label={`ผังคลังทั้งหมด โซน ${activeZone ?? '-'}`}>
      {zones.map((z) => (
        <div key={z} className={`minimap-zone ${z === activeZone ? 'on' : ''}`}>
          {z}
        </div>
      ))}
    </div>
  );
}
