import { useEffect, useState } from 'react';
import { SCAN_EVENT } from '../lib/useScanner';
import warehouseImg from '../assets/warehouse-wh.jpg';
import { FloorPlanZoomDialog } from './FloorPlanZoomDialog';

/**
 * ผังคลังจากภาพ render 3 มิติของคลังจริง
 *
 * ⚠️ ต่างจาก WarehouseMap/WarehouseMiniMap ตรงที่ "ตายตัว" ไม่ได้ query จาก
 *    v_warehouse_map เลย — พิกัดทุกค่าวัดจากภาพ src/assets/warehouse-wh.jpg
 *    ขนาด 1280×417 px ถ้าเปลี่ยนภาพใหม่ต้องวัดพิกัดทั้งหมดใหม่ทุกโซน
 *
 *    รองรับเฉพาะโซน A-K (ห้องหลักในภาพ) โซนอื่น (L, M, N, O ที่อยู่นอกห้อง)
 *    ไม่มีชั้นวางให้ไฮไลท์ — caller (PdaScan) เช็ค FLOOR_PLAN_ZONES ก่อน
 *    แล้ว fallback ไป WarehouseMiniMap เอง
 *
 * ⚠️ ไม่ใช้วิธี "เจาะกรอบครอบตัวชั้นวาง" แล้ว
 *    เพราะชั้นวางถ่ายมาแบบ perspective ขอบบน-ล่างเอียงไม่เท่ากันทุกโซน
 *    (โซน A เอียง 77px · K เอียงกลับทาง 73px) กรอบจึงไม่เคยพอดีครบทุกโซน
 *
 *    เปลี่ยนมาวาด "เส้นทางเดิน + คนเดินตามเส้น" จากประตูไปยังโซนแทน
 *    บอกได้มากกว่าว่าอยู่โซนไหน — บอกว่าเดินไปยังไงด้วย
 *    และไม่ต้องรู้ขอบชั้นวางเลย จึงไม่มีปัญหากรอบไม่ตรง
 */

const IMG_W = 1280;
const IMG_H = 417;

/**
 * ขอบซ้าย-ขวาของแต่ละโซน (แนวนอนอย่างเดียว วัดจากเนื้อไม้ในภาพ)
 *
 * เก็บแค่แกนนอนเพราะเส้นทางเดินต้องรู้แค่ "โซนนี้อยู่ตรงไหนในแนวซ้าย-ขวา"
 * ไม่ต้องรู้ขอบบน-ล่างซึ่งเป็นส่วนที่เอียงจนวัดให้พอดีไม่ได้
 */
const ZONE_X: Record<string, [number, number]> = {
  A: [91, 150], B: [222, 284], C: [285, 348],
  D: [436, 494], E: [501, 558], F: [658, 709], G: [717, 774],
  H: [864, 925], I: [928, 992], J: [1068, 1133], K: [1134, 1195],
};

export const FLOOR_PLAN_ZONES = new Set(Object.keys(ZONE_X));

/** ขอบล่างของชั้นวางในภาพ — ปลายทางที่คนเดินไปหยุด */
const RACK_BOTTOM = 302;
/** ประตูทางเข้า อยู่กลางล่างของภาพ */
// x วัดจากเสาประตูจริง 4 ต้น (x≈573, 592, 621, 640) — เป็นประตูบานคู่
// กึ่งกลางจากขอบนอก และกึ่งกลางช่องว่างระหว่างบาน ได้ค่าตรงกันที่ ~606.5
const DOOR = { x: 606, y: 372 };
/** ทางเดินหน้าชั้นวาง — คนเดินตามแนวนี้ก่อนเลี้ยวเข้าโซน */
const AISLE_Y = 340;
/** ระยะเวลาที่คนเดินจากประตูถึงโซน */
const WALK_MS = 2100;
/** หน่วงก่อนเริ่มเดิน ให้เส้นทางวาดตัวเองเสร็จก่อน */
const WALK_DELAY_MS = 850;

const zoneMidX = (zone: string) => {
  const r = ZONE_X[zone];
  return r ? (r[0] + r[1]) / 2 : IMG_W / 2;
};

/**
 * เส้นทางเดิน: ประตู → ขึ้นมาที่ทางเดิน → เลี้ยวไปตรงโซน → เข้าหาชั้นวาง
 * ใช้ทั้งวาดเส้นและให้ไอคอนคนเดินตาม (animateMotion) จึงตรงกันเสมอ
 */
function walkPath(zone: string): string {
  const cx = zoneMidX(zone);
  return `M${DOOR.x} ${DOOR.y} L${DOOR.x} ${AISLE_Y} L${cx} ${AISLE_Y} L${cx} ${RACK_BOTTOM + 10}`;
}

interface SvgProps {
  activeZone: string | null;
}

/** ตัว SVG ล้วน — ใช้ซ้ำทั้งในการ์ดผลลัพธ์และใน dialog ขยาย */
export function FloorPlanSvg({ activeZone }: SvgProps) {
  const zone = activeZone && ZONE_X[activeZone] ? activeZone : null;
  const d = zone ? walkPath(zone) : '';
  const cx = zone ? zoneMidX(zone) : 0;
  const endY = RACK_BOTTOM + 10;

  return (
    <svg
      className="floorplan"
      viewBox={`0 0 ${IMG_W} ${IMG_H}`}
      role="img"
      aria-label={
        zone ? `ผังคลัง เส้นทางเดินไปโซน ${zone}` : 'ผังคลัง'
      }
    >
      <image
        href={warehouseImg}
        x="0"
        y="0"
        width={IMG_W}
        height={IMG_H}
        className="fp-img"
      />

      {zone && (
        <>
          <circle className="fp-door" cx={DOOR.x} cy={DOOR.y} r="11" />
          <path className="fp-trail" d={d} />

          {/* ป้ายโซนลอยเหนือหัวคน ต่อก้านลงมา — ถ้าวางที่จุดเดียวกับคนจะทับกัน */}
          <g className="fp-goal">
            <line
              className="fp-goal-stem"
              x1={cx}
              y1={endY - 96}
              x2={cx}
              y2={endY - 52}
            />
            <circle className="fp-goal-c" cx={cx} cy={endY - 96} r="24" />
            <text className="fp-goal-t" x={cx} y={endY - 96} fontSize="28">
              {zone}
            </text>
          </g>

          <g className="fp-guy">
            <circle className="fp-head" cx="0" cy="-30" r="9" />
            <path className="fp-body" d="M-7 -20 h14 l-2 16 h-10 Z" />
            <line className="fp-leg fp-legL" x1="0" y1="-5" x2="-5" y2="7" />
            <line className="fp-leg fp-legR" x1="0" y1="-5" x2="5" y2="7" />
            {/* เดินตาม path เดียวกับเส้นทาง จึงเลี้ยวตรงมุมเหมือนกันเสมอ */}
            <animateMotion
              dur={`${WALK_MS}ms`}
              fill="freeze"
              begin={`${WALK_DELAY_MS}ms`}
              path={d}
              rotate="0"
            />
          </g>
        </>
      )}
    </svg>
  );
}

interface Props {
  activeZone: string | null;
}

export function WarehouseFloorPlan({ activeZone }: Props) {
  const [zoomed, setZoomed] = useState(false);

  // สแกนสินค้าชิ้นใหม่ที่อยู่คนละโซน → ปิดภาพขยายให้เอง
  useEffect(() => {
    setZoomed(false);
  }, [activeZone]);

  // สแกนชิ้นใหม่ที่อยู่โซนเดิม activeZone ไม่เปลี่ยน effect ข้างบนจึงไม่ทำงาน
  // ต้องฟัง event ตรงๆ ไม่งั้นภาพขยายค้างทับผลลัพธ์ใหม่
  useEffect(() => {
    if (!zoomed) return;
    const close = () => setZoomed(false);
    window.addEventListener(SCAN_EVENT, close);
    return () => window.removeEventListener(SCAN_EVENT, close);
  }, [zoomed]);

  return (
    <>
      <button
        type="button"
        className="fp-tap"
        onClick={() => setZoomed(true)}
        aria-label={`ขยายผังคลัง โซน ${activeZone ?? 'ไม่ระบุ'}`}
      >
        {/* key = โซน → React สร้าง SVG ใหม่เมื่อเปลี่ยนโซน
            จำเป็นเพราะ animateMotion/CSS animation ไม่เริ่มใหม่เองถ้า element เดิมถูกใช้ซ้ำ */}
        <FloorPlanSvg key={activeZone ?? 'none'} activeZone={activeZone} />
        {/* ไอคอนขยายเต็มจอ — วาดด้วย SVG ไม่ใช้ emoji เพราะ emoji
            หน้าตาต่างกันไปตามเครื่อง และย่อเล็กแล้วดูไม่ออกว่าเป็นรูปอะไร */}
        <span className="fp-expand-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15">
            <path
              d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {zoomed && (
        <FloorPlanZoomDialog activeZone={activeZone} onClose={() => setZoomed(false)} />
      )}
    </>
  );
}
