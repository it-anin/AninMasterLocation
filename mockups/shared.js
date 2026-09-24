/* ───────────────────────────────────────────────────────────────
   ข้อมูลร่วมของทั้ง 10 แบบ — แก้ที่นี่ที่เดียว ทุกแบบเปลี่ยนตาม

   พิกัดโซนวัดจากพิกเซลจริงใน wh.jpg (1280×417)
   lean = ระยะที่ขอบเอียงจากบนลงล่าง ตาม perspective ของภาพ
   ─────────────────────────────────────────────────────────────── */

const IMG_W = 1280, IMG_H = 417;

const ZONES = [
  { zone: 'A', sx: 91,   sy: 88, sw: 60, sh: 214 },
  { zone: 'B', sx: 222,  sy: 88, sw: 63, sh: 214, leanR: -5 },
  { zone: 'C', sx: 285,  sy: 88, sw: 64, sh: 214, leanL: -5 },
  { zone: 'D', sx: 436,  sy: 88, sw: 59, sh: 212 },
  { zone: 'E', sx: 501,  sy: 86, sw: 58, sh: 216 },
  { zone: 'F', sx: 658,  sy: 88, sw: 52, sh: 214 },
  { zone: 'G', sx: 717,  sy: 88, sw: 58, sh: 214 },
  { zone: 'H', sx: 864,  sy: 88, sw: 62, sh: 212 },
  { zone: 'I', sx: 928,  sy: 88, sw: 65, sh: 214 },
  { zone: 'J', sx: 1068, sy: 86, sw: 66, sh: 214, leanR: 12 },
  { zone: 'K', sx: 1134, sy: 88, sw: 62, sh: 214, leanL: 12 },
];

const ZONE_BY_ID = Object.fromEntries(ZONES.map(z => [z.zone, z]));

/** จำนวนชั้น — ล่างขึ้นบน 1..6 ทุกโซน */
const SHELVES = 6;

/**
 * ภาพชั้นวางมองจากด้านหน้า (view2.png) + พิกัดโครงชั้นวางในภาพ
 *
 * `decks` = ตำแหน่งกึ่งกลางแผ่นไม้แต่ละแผ่น เรียงบนลงล่าง วัดจากพิกเซลจริง
 *    7 แผ่น → ช่องว่างระหว่างแผ่น 6 ช่อง = ชั้นเก็บของ 6 ชั้น พอดีกับ SHELVES
 *    แผ่นบนสุดคือหลังคาชั้นวาง ไม่ใช่ชั้นเก็บของ
 *
 * ⚠️ ใช้พิกัดที่วัดได้จริง ไม่ได้แบ่งเท่าๆ กัน เพราะ perspective ของเลนส์
 *    ทำให้ระยะห่างแต่ละชั้นไม่เท่ากัน (52, 47, 49, 49, 47, 50 px)
 *    ถ้าแบ่งเท่ากันกรอบจะเลื่อนจากแผ่นไม้จริงไปหลายพิกเซล
 *
 *    เปลี่ยนภาพใหม่ต้องวัดใหม่ทั้งหมด (ดู mockups/README.md)
 */
const RACK_IMG = {
  src: 'view2.png',
  w: 850, h: 395,               // ขนาดภาพหลัง crop + ย่อ
  x0: 26, x1: 821,              // ขอบซ้าย/ขวาของโครงชั้นวาง
  // ขอบเสาจริง 7 ขอบ = 6 ช่อง — ใช้แทนการหารเท่าๆ กัน กรอบจะทับช่องพอดี
  bayEdges: [26, 153, 288, 424, 558, 694, 821],
  // ช่องว่างระหว่างแผ่นไม้ = พื้นที่วางของจริง เรียงบนลงล่าง
  // ⚠️ ต้องเป็นช่องว่าง ไม่ใช่กึ่งกลางแผ่น ไม่งั้นกรอบชั้นบนสุดจะลอยเหนือหลังคา
  gaps: [
    { top: 56, bottom: 100 },  // ชั้น 6 (บนสุด)
    { top: 108, bottom: 147 }, // ชั้น 5
    { top: 156, bottom: 196 }, // ชั้น 4
    { top: 205, bottom: 245 }, // ชั้น 3
    { top: 254, bottom: 289 }, // ชั้น 2
    { top: 302, bottom: 340 }, // ชั้น 1 (ล่างสุด)
  ],
  // ช่องที่ 7 = แถบเหนือชั้นวาง (ของวางบนหลังคา) ไม่ใช่คอลัมน์ที่ 7
  // กว้างเท่าช่อง 5 พอดี (x 558..694)
  topStrip: { top: 12, bottom: 48 },
};

/** จำนวนชั้นเก็บของที่ภาพนี้รองรับ */
RACK_IMG.shelves = RACK_IMG.gaps.length;
/** จำนวนช่องที่ภาพมีจริง */
RACK_IMG.bays = RACK_IMG.bayEdges.length - 1;
// แถบช่อง 7 อ้างขอบเสาจริงของช่อง 5 — ถ้า bayEdges เปลี่ยน แถบขยับตามเอง
RACK_IMG.topStrip.x = RACK_IMG.bayEdges[4];
RACK_IMG.topStrip.width = RACK_IMG.bayEdges[5] - RACK_IMG.bayEdges[4];

/** true = ภาพตรงกับ scheme พอดี กรอบจะทับชั้นจริง */
const rackImgMatches = () => RACK_IMG.shelves === SHELVES;

/**
 * ขอบบน/ล่างของชั้นที่ s (1 = ล่างสุด) ในพิกัดภาพ
 * gaps เรียงบนลงล่าง ส่วน s นับล่างขึ้นบน จึงต้องกลับลำดับ
 */
function shelfBand(s) {
  const n = RACK_IMG.shelves;
  return RACK_IMG.gaps[n - Math.min(Math.max(s, 1), n)];
}

/**
 * จำนวนช่องย่อยต่อชั้น แยกตามโซน
 * ⚠️ J/K ยังไม่ได้ระบุ — ตั้งเป็น 7 ตามโซนข้างเคียง (F-I) รอยืนยัน
 */
const SLOTS = {
  A: 4,
  B: 6, C: 6, D: 6, E: 6,
  F: 7, G: 7, H: 7, I: 7,
  J: 7, K: 7,
};

const slotsOf = z => SLOTS[z] ?? 6;

/** รหัสเต็ม: โซน + ชั้น + ช่อง เช่น A11 = โซน A ชั้น 1 ช่อง 1 */
const code = (zone, shelf, slot) => `${zone}${shelf}${slot}`;

/** ช่องเจาะรูปสี่เหลี่ยมด้านไม่ขนาน ตาม perspective ของชั้นวางในภาพ */
function zoneQuad(z) {
  const top = z.sy, bot = z.sy + z.sh;
  const l = z.sx, r = z.sx + z.sw;
  return {
    tl: [l, top], tr: [r, top],
    br: [r + (z.leanR ?? 0), bot],
    bl: [l + (z.leanL ?? 0), bot],
  };
}

/** path คลุมทั้งภาพแล้วเจาะเฉพาะโซนที่เลือก (fill-rule=evenodd) */
function scrimPath(z) {
  const outer = `M0 0H${IMG_W}V${IMG_H}H0Z`;
  if (!z) return outer;
  const q = zoneQuad(z);
  return `${outer} M${q.tl[0]} ${q.tl[1]}L${q.tr[0]} ${q.tr[1]}L${q.br[0]} ${q.br[1]}L${q.bl[0]} ${q.bl[1]}Z`;
}

/** ตัวอย่างสินค้าไว้สาธิตหน้าจอ */
const DEMO = {
  barcode: '8851467011175',
  item_id: '900157',
  name: 'พาราเซตามอล 500 มก. (แผง 10 เม็ด)',
  unit: 'แผง',
  zone: 'C', shelf: 3, slot: 2,
  note: 'ล็อตใหม่วางด้านหน้า',
  updated_by: 'สมชาย',
};
DEMO.code = code(DEMO.zone, DEMO.shelf, DEMO.slot);
