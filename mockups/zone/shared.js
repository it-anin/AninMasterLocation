/* ───────────────────────────────────────────────────────────────
   ข้อมูลร่วมของทั้ง 10 แบบ — แก้ที่นี่ที่เดียว ทุกแบบเปลี่ยนตาม

   ปัญหาที่ 10 แบบนี้พยายามแก้:
   ชั้นวางในภาพเป็น perspective ขอบเอียงไม่เท่ากันทุกโซน
   การ "เจาะช่องให้พอดีตัวชั้นวาง" จึงไม่เคยพอดีจริง
   → แบบส่วนใหญ่ในนี้เลี่ยงการเจาะตามรูปทรง ใช้วิธีชี้/ครอบ/ทำเครื่องหมายแทน
   ─────────────────────────────────────────────────────────────── */

const IMG_W = 1280, IMG_H = 417;

/** กึ่งกลางป้ายวงกลม A-K ที่ฝังมาในภาพ (วัดจากพิกเซลจริง) */
const LABELS = {
  A: { x: 134, y: 40 },
  B: { x: 269, y: 37 },
  C: { x: 342, y: 35 },
  D: { x: 468, y: 36 },
  E: { x: 544, y: 36 },
  F: { x: 678, y: 36 },
  G: { x: 755, y: 36 },
  H: { x: 881, y: 36 },
  I: { x: 956, y: 36 },
  J: { x: 1087, y: 37 },
  K: { x: 1161, y: 36 },
};

/**
 * ขอบซ้าย-ขวาของแต่ละโซน (แนวนอนอย่างเดียว วัดจากเนื้อไม้)
 * ไม่เก็บขอบบน-ล่าง เพราะนั่นแหละคือส่วนที่เอียงจนครอบไม่พอดี
 */
const ZONE_X = {
  A: [91, 150],  B: [222, 284], C: [285, 348],
  D: [436, 494], E: [501, 558], F: [658, 709], G: [717, 774],
  H: [864, 925], I: [928, 992], J: [1068, 1133], K: [1134, 1195],
};

/** ช่วงแนวตั้งที่ชั้นวางอยู่ — ใช้กับแบบที่ครอบทั้งแถบ ไม่ได้เจาะตามรูป */
const RACK_TOP = 86;
const RACK_BOTTOM = 302;

const zx = z => ZONE_X[z] ?? [0, 0];
const zoneMidX = z => { const [a, b] = zx(z); return (a + b) / 2; };
const zoneW = z => { const [a, b] = zx(z); return b - a; };

const ZONES = Object.keys(ZONE_X);

/** ตัวอย่างผลลัพธ์ที่ใช้สาธิต */
const DEMO = { zone: 'C', shelf: 3, slot: 2, code: 'C32' };

/** ปุ่มสลับโซนไว้ลองดูทุกโซนในแต่ละแบบ */
function zonePicker(onPick, current) {
  const bar = document.createElement('div');
  bar.className = 'zpick';
  bar.innerHTML =
    '<span>ลองเปลี่ยนโซน:</span>' +
    ZONES.map(z => `<button type="button" data-z="${z}"${z === current ? ' class="on"' : ''}>${z}</button>`).join('');
  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-z]');
    if (!b) return;
    bar.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onPick(b.dataset.z);
  });
  return bar;
}
