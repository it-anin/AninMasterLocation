import { useEffect, useRef } from 'react';
import { FloorPlanSvg } from './WarehouseFloorPlan';

interface Props {
  activeZone: string | null;
  onClose: () => void;
}

/**
 * ภาพผังคลังขยายเต็มจอ — เลื่อนซ้าย-ขวาดูได้
 *
 * ภาพเป็นแนวนอนยาว (1280×417) ส่วนจอ PDA เป็นแนวตั้ง 480×800
 * จึงขยายให้กว้างเกินจอแล้วให้เลื่อนดู แทนที่จะย่อให้พอดีซึ่งไม่ได้ขยายอะไรเลย
 *
 * ⚠️ ต่างจาก EditLocationDialog ตรงที่ "ไม่ปิด" ตัวสแกน เพราะไม่มีช่องให้พิมพ์
 *    พนักงานยิงชิ้นต่อไปได้ทันทีโดยไม่ต้องปิดเอง — ตัวที่เรียกใช้
 *    (WarehouseFloorPlan) จัดการปิด dialog ให้เมื่อมีการสแกน
 */
export function FloorPlanZoomDialog({ activeZone, onClose }: Props) {
  // overlay เป็น div ไม่ได้ focus เหมือน input ของ EditLocationDialog
  // จึงต้องดัก Escape ที่ document แทน onKeyDown บน element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * แตะตรงไหนก็ปิด รวมถึงบนตัวภาพ
   *
   * ⚠️ แต่ต้องไม่ปิดตอน "ลาก" เลื่อนภาพซ้าย-ขวา ไม่งั้นเลื่อนดูไม่ได้เลย
   *    จึงจำตำแหน่งตอนกดไว้ แล้วเทียบกับตอนปล่อย — ขยับเกิน 10px ถือว่าลาก
   */
  const downAt = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(e: React.PointerEvent) {
    downAt.current = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp(e: React.PointerEvent) {
    const start = downAt.current;
    downAt.current = null;
    if (!start) return;
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (moved <= 10) onClose();
  }

  return (
    <div
      className="overlay fp-overlay"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <div className="fp-zoom">
        <FloorPlanSvg activeZone={activeZone} />
      </div>
      <div className="fp-zoom-hint">
        {activeZone
          ? `โซน ${activeZone} · เลื่อนซ้าย-ขวาเพื่อดู · แตะเพื่อปิด`
          : 'แตะเพื่อปิด'}
      </div>
    </div>
  );
}
