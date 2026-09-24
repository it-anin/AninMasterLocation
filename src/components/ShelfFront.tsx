import rackMain from '../assets/rack-front.png';
import rackZoneA from '../assets/rack-zone-a.png';

/**
 * ภาพชั้นวางมองจากด้านหน้า + กรอบไฮไลท์ช่องที่สินค้าอยู่
 *
 * ⚠️ พิกัดทุกค่าวัดจากพิกเซลจริงในภาพ เปลี่ยนภาพต้องวัดใหม่ทั้งหมด
 *    (ดู mockups/README.md)
 *
 * คลังมีชั้นวาง 2 แบบ จึงมี 2 ภาพ:
 *   RACK_MAIN   6 ชั้น 6 ช่อง — ใช้กับโซน B-K และโซน A ชั้น 3-4
 *   RACK_ZONE_A 2 ชั้น 2 ช่อง — ใช้กับโซน A ชั้น 1-2 เท่านั้น (ชั้นเตี้ยกว่า)
 *
 * ⚠️ ขอบชั้นต้องเป็น "ช่องว่างระหว่างแผ่นไม้" ไม่ใช่ "กึ่งกลางแผ่น"
 *    ไม่งั้นกรอบชั้นบนสุดจะลอยเหนือหลังคาชั้นวาง
 *
 * ⚠️ ไม่ได้หารความกว้างเท่าๆ กัน แต่ใช้พิกัดเสาจริง เพราะ perspective ของเลนส์
 *    ทำให้แต่ละช่องกว้างไม่เท่ากัน ถ้าหารเท่ากันกรอบจะคร่อมเสา
 */

/** แถบเหนือชั้นวาง — ใช้กับช่องที่เกินจำนวนช่องในภาพ */
interface TopStrip {
  /** ช่องที่แถบนี้แทน */
  slot: number;
  x: number;
  width: number;
}

interface RackImage {
  src: string;
  w: number;
  h: number;
  /** ขอบเสาแต่ละต้น — n ขอบ = n-1 ช่อง */
  bayEdges: number[];
  /** ช่องว่างระหว่างแผ่นไม้ เรียงจากชั้นบนสุดลงล่าง */
  gaps: Array<{ top: number; bottom: number }>;
  /** ขอบบน/ล่างของแถบเหนือชั้นวาง */
  stripTop: number;
  stripBottom: number;
  /** ช่องที่ไม่มีในภาพ → วาดเป็นแถบด้านบนแทน */
  strips: TopStrip[];
  /**
   * true = แถบบนอยู่เหนือเชลฟ์ที่เลือก (กว้างเท่าเชลฟ์นั้น ขยับตามซ้าย-ขวา)
   * false = แถบบนอยู่ตำแหน่งตายตัวตาม strip.x
   */
  stripFollowsBay?: boolean;
}

/**
 * ชั้นวางหลัก — 6 ชั้น 6 ช่อง ใช้กับโซน B-K
 *
 * ช่องที่ 7 ไม่มีในภาพ (ภาพมี 6 ช่อง) จึงวาดเป็นแถบเหนือชั้นวาง
 * กว้างเท่าช่อง 5 พอดี
 */
const RACK_MAIN: RackImage = {
  src: rackMain,
  w: 850,
  h: 395,
  bayEdges: [26, 153, 288, 424, 558, 694, 821],
  gaps: [
    { top: 56, bottom: 100 },  // ชั้น 6 (บนสุด)
    { top: 108, bottom: 147 }, // ชั้น 5
    { top: 156, bottom: 196 }, // ชั้น 4
    { top: 205, bottom: 245 }, // ชั้น 3
    { top: 254, bottom: 289 }, // ชั้น 2
    { top: 302, bottom: 340 }, // ชั้น 1 (ล่างสุด)
  ],
  stripTop: 12,
  stripBottom: 48,
  strips: [{ slot: 7, x: 558, width: 136 }],
};

/**
 * ชั้นวางโซน A ชั้น 1-2 — ชั้นเตี้ย 2 ตัวตั้งติดกัน
 *
 * ใช้แกนเดียวกับโซนอื่น — เชลฟ์ = ตัวชั้นวางซ้าย/ขวา · ชั้น = ระดับความสูง
 * (ยืนยันจากรูปที่หน้างานทำเครื่องหมายมา)
 *
 *      ┌─ A14 ─┐ ┌─ A24 ─┐   ← ชั้นที่ 4 = แถบเหนือชั้นวาง
 *      │  A13  │ │  A23  │
 *      │  A12  │ │  A22  │
 *      │  A11  │ │  A21  │   ← ชั้นที่ 1 = ล่างสุด
 *       เชลฟ์ 1    เชลฟ์ 2
 */
const RACK_ZONE_A: RackImage = {
  src: rackZoneA,
  w: 770,
  h: 395,
  /** 2 ตัวชั้นวาง: ซ้าย = ชั้น 1 · ขวา = ชั้น 2 */
  bayEdges: [40, 384, 728],
  /** ระดับความสูง เรียงบนลงล่าง = ช่อง 3, 2, 1 */
  gaps: [
    { top: 65, bottom: 126 },  // ช่อง 3
    { top: 143, bottom: 201 }, // ช่อง 2
    { top: 220, bottom: 278 }, // ช่อง 1 (ล่างสุด)
  ],
  stripTop: 12,
  stripBottom: 48,
  /** ชั้นที่ 4 = แถบเหนือชั้นวาง — อยู่เหนือเชลฟ์ที่เลือก (ซ้าย/ขวา) */
  strips: [{ slot: 4, x: 40, width: 344 }],
  stripFollowsBay: true,
};

/**
 * จำนวนชั้น/ช่องจริงของแต่ละโซน — นับจากรหัสที่ใช้จริงใน Location-WH.csv
 *
 * ใช้ตัดสินว่าโซนไหนวาดภาพชั้นวางได้บ้าง (SHELF_ZONES)
 */
const ZONE_LAYOUT: Record<string, { shelves: number; slots: number }> = {
  A: { shelves: 4, slots: 6 },
  B: { shelves: 6, slots: 7 },
  C: { shelves: 6, slots: 7 },
  D: { shelves: 6, slots: 7 },
  E: { shelves: 6, slots: 7 },
  F: { shelves: 5, slots: 6 },
  G: { shelves: 5, slots: 7 },
  H: { shelves: 5, slots: 7 },
  I: { shelves: 5, slots: 7 },
  J: { shelves: 6, slots: 7 },
  K: { shelves: 6, slots: 7 },
};

/** โซนที่วาดภาพชั้นวางได้ — โซนอื่นไม่มี layout ให้วาด */
export const SHELF_ZONES = new Set(Object.keys(ZONE_LAYOUT));

/**
 * โซนที่นับเชลฟ์จากขวาไปซ้าย
 *
 * ชั้นวางพวกนี้ตั้งหันหน้าคนละทางกับโซนอื่น (อยู่อีกฝั่งของทางเดิน)
 * พนักงานจึงเดินเข้าหาจากอีกด้าน เชลฟ์ที่ 1 เลยอยู่ขวาสุดของภาพ
 *
 * กลับเฉพาะแนวนอน (เชลฟ์) — ชั้นยังนับล่างขึ้นบนเหมือนเดิมทุกโซน
 */
const MIRRORED_ZONES = new Set(['B', 'D', 'F', 'H', 'J']);

/** true = โซนนี้เชลฟ์ที่ 1 อยู่ขวาสุด — ใช้สลับป้ายบอกทิศบนหน้าจอด้วย */
export function isMirroredZone(zone: string) {
  return MIRRORED_ZONES.has(zone);
}

/**
 * เลือกภาพชั้นวางตามโซนและชั้น
 *
 * โซน A แบ่งเป็น 2 ชุดชั้นวางคนละแบบ:
 *   ชั้น 1-2 เป็นชั้นเตี้ย 2 ช่อง (A11-A14, A21-A24)
 *   ชั้น 3-4 เป็นชั้นสูงแบบเดียวกับโซนอื่น (A31-A36, A41-A46)
 */
function pickRack(zone: string, shelf: number) {
  if (zone === 'A' && shelf <= 2) return { rack: RACK_ZONE_A };
  return { rack: RACK_MAIN };
}

/**
 * ขอบบน/ล่างของชั้นที่ s (1 = ล่างสุด) ในพิกัดภาพ
 *
 * gaps เรียงบนลงล่าง ส่วน s นับล่างขึ้นบน จึงต้องกลับลำดับ
 * โซนที่มีชั้นน้อยกว่าภาพจะใช้ช่องล่างสุดไล่ขึ้นไป เพราะชั้น 1 คือล่างสุดเสมอ
 */
function shelfBand(rack: RackImage, s: number) {
  const n = rack.gaps.length;
  return rack.gaps[n - Math.min(Math.max(s, 1), n)];
}

interface Props {
  zone: string;
  /** ชั้น 1 = ล่างสุด */
  shelf: number;
  /** ช่อง 1 = ซ้ายสุด — null ถ้ารหัสไม่มีหลักช่อง (เช่น A-03) */
  slot: number | null;
}

export function ShelfFront({ zone, shelf, slot }: Props) {
  const { rack } = pickRack(zone, shelf);
  const bays = rack.bayEdges.length - 1;

  // ⚠️ ชื่อ prop สืบทอดมาจากตอนที่ "shelf" ยังหมายถึงระดับความสูง
  //    ความหมายปัจจุบัน: shelf = เชลฟ์ (ตัวชั้นวาง แนวนอน) · slot = ชั้น (ระดับความสูง)
  //    ทุกโซนใช้แกนเดียวกันหมด รวมถึงโซน A ชั้นเตี้ย
  const bayIndex = shelf;
  const level = slot;

  // strips ระบุด้วยเลข "ชั้น" (หลักที่ 3 ของรหัส)
  const strip = slot == null ? undefined : rack.strips.find((s) => s.slot === slot);
  const band = shelfBand(rack, level ?? 1);

  // ตำแหน่งแนวนอน — ใช้ขอบเสาจริง กรอบจึงทับเชลฟ์ในภาพพอดี ไม่คร่อมเสา
  //
  // ชั้นวางหลัก: แถบบน (ชั้น 7) ไม่มีเสารองรับ ใช้ x ตายตัวที่กำหนดใน strip
  // ชั้นวางโซน A: แถบบนอยู่เหนือเชลฟ์ที่เลือก จึงใช้ขอบเสาตามปกติ
  const useStripX = strip != null && !rack.stripFollowsBay;

  // โซนที่นับเชลฟ์จากขวา → กลับ index ก่อนแปลงเป็นพิกัด
  const mirrored = MIRRORED_ZONES.has(zone);
  const clamped = bayIndex == null ? null : Math.min(Math.max(bayIndex, 1), bays);
  const bi = clamped == null ? 0 : (mirrored ? bays - clamped : clamped - 1);

  const hx = useStripX
    ? // แถบบนก็ต้องย้ายไปฝั่งตรงข้ามด้วย ไม่งั้นจะขัดกับเชลฟ์ด้านล่าง
      mirrored
      ? rack.w - strip.x - strip.width
      : strip.x
    : bayIndex == null
      ? rack.bayEdges[0]
      : rack.bayEdges[bi];
  const hw = useStripX
    ? strip.width
    : bayIndex == null
      ? rack.bayEdges[bays] - rack.bayEdges[0]
      : rack.bayEdges[bi + 1] - rack.bayEdges[bi];

  // ตำแหน่งแนวตั้ง — แถบเหนือชั้นวาง หรือระดับในชั้นวาง
  const hy = strip ? rack.stripTop : band.top;
  const hh = strip ? rack.stripBottom - rack.stripTop : band.bottom - band.top;

  const label = slot == null ? `${zone}${shelf}` : `${zone}${shelf}${slot}`;

  return (
    <div className="sf">
      <img className="sf-img" src={rack.src} alt="" />
      <svg
        className="sf-ov"
        viewBox={`0 0 ${rack.w} ${rack.h}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`ชั้นวางโซน ${zone} ชั้นที่ ${shelf}${slot != null ? ` ช่องที่ ${slot}` : ''}`}
      >
        {/* คลุมทั้งภาพให้จาง แล้วเจาะเฉพาะช่องที่ใช่ — evenodd เป็น SVG 1.1 core
            รองรับทุก WebView ต่างจาก mask-image ที่มีปัญหาบน Android รุ่นเก่า */}
        <path
          className="sf-dim"
          fillRule="evenodd"
          d={`M0 0H${rack.w}V${rack.h}H0Z M${hx} ${hy}H${hx + hw}V${hy + hh}H${hx}Z`}
        />

        {/* เส้นประคร่อมชั้น ให้กวาดตาตามแนวนอนได้ง่ายตอนยืนหน้าชั้นจริง */}
        <line className="sf-line" x1="0" y1={hy} x2={rack.w} y2={hy} />
        <line className="sf-line" x1="0" y1={hy + hh} x2={rack.w} y2={hy + hh} />

        <rect className="sf-hit" x={hx} y={hy} width={hw} height={hh} rx="4" />
        <text
          className="sf-code"
          x={hx + hw / 2}
          y={hy + hh / 2}
          fontSize={Math.min(26, hw * 0.5)}
        >
          {label}
        </text>
      </svg>
    </div>
  );
}
