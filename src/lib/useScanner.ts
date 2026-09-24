import { useEffect, useRef } from 'react';

/** ชื่อ CustomEvent ที่ native shell (MainActivity.kt) ยิงเข้ามา — ต้องตรงกันทั้งสองฝั่ง */
export const SCAN_EVENT = 'loc-scan';

/** โหมด PDA เปิดด้วย ?android=1 จาก WEBAPP_URL ใน MainActivity.kt */
export const isAndroidMode =
  new URLSearchParams(window.location.search).get('android') === '1';

/**
 * บังคับธีมสว่างทั้งระบบ ไม่ตามการตั้งค่าเครื่อง
 *
 * PDA: เครื่องหลายตัวตั้งโหมดมืดไว้ แต่คลังแสงจ้า จอมืดอ่านแทบไม่ออก
 * Desktop: ภาพผังคลังกับภาพชั้นวางเป็นภาพพื้นขาว ในโหมดมืดต้องหรี่ภาพลง
 *          ทำให้ดูรายละเอียดชั้นวางยาก — ใช้สว่างทั้งคู่จะเห็นตรงกันด้วย
 *
 * ตั้งตอนโหลด module ก่อน React render แรก — กันจอกะพริบมืดแล้วค่อยสว่าง
 */
document.documentElement.setAttribute('data-theme', 'light');

/**
 * ฟังบาร์โค้ดจากเครื่องสแกน
 *
 * รับได้ 2 ทาง:
 *  1. CustomEvent 'loc-scan' จาก native WebView shell (โหมด Broadcast)
 *  2. keyboard-wedge — เครื่องพิมพ์ตัวเลขรัวๆ แล้วปิดท้ายด้วย Enter (โหมด HID)
 *     ใช้ตอน dev บนเบราว์เซอร์ และรองรับกรณีเครื่องตั้งเป็นโหมด HID
 *
 * ใช้ ref เก็บ callback เพื่อกัน closure stale — onScan เปลี่ยนทุก render
 * แต่ listener ผูกครั้งเดียวตอน mount
 */
export function useScanner(onScan: (barcode: string) => void, enabled = true) {
  const cb = useRef(onScan);
  cb.current = onScan;

  // ── ทาง 1: native broadcast ──────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: Event) => {
      const code = (e as CustomEvent<string>).detail;
      if (code) cb.current(String(code).trim());
    };
    window.addEventListener(SCAN_EVENT, handler);
    return () => window.removeEventListener(SCAN_EVENT, handler);
  }, [enabled]);

  // ── ทาง 2: keyboard wedge ────────────────────────────────
  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastAt = 0;
    // เครื่องสแกนพิมพ์เร็วกว่ามนุษย์มาก ถ้าเว้นเกิน 150ms ถือว่าเป็นการพิมพ์มือ
    const GAP_MS = 150;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastAt > GAP_MS) buffer = '';
      lastAt = now;

      if (e.key === 'Enter') {
        const code = buffer.trim();
        buffer = '';
        // ต้องยาวพอที่จะเป็นบาร์โค้ด ไม่ใช่การกด Enter เปล่าๆ
        if (code.length >= 2) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }

      // เก็บเฉพาะอักขระเดี่ยว (ตัวเลข/ตัวอักษร) ข้าม Shift, Tab, F1 ฯลฯ
      if (e.key.length === 1) buffer += e.key;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/**
 * Listener ชั้น fallback สำหรับหน้าที่ไม่ได้เขียน handler เฉพาะ
 * ยิงค่าเข้า input ที่ focus อยู่ แล้วจำลอง Enter
 *
 * เรียกครั้งเดียวที่ App ระดับบนสุด
 */
export function useScanFallback() {
  useEffect(() => {
    if (!isAndroidMode) return;

    const handler = (e: Event) => {
      const barcode = (e as CustomEvent<string>).detail;
      if (!barcode) return;

      // หน้าปัจจุบันมี handler เฉพาะอยู่แล้ว → ห้าม inject ซ้ำ
      if (document.querySelector('[data-android-barcode="true"]')) return;

      let input = document.activeElement as HTMLInputElement | null;
      if (!input || input.tagName !== 'INPUT' || input.disabled || input.readOnly) {
        input =
          Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="text"], input:not([type])')
          ).find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !el.disabled && !el.readOnly;
          }) ?? null;
      }
      if (!input) return;

      input.focus();
      // ⚠️ React ครอบ value descriptor ไว้ — ถ้า set ตรงๆ onChange จะไม่ทำงาน
      //    ต้องเรียก native setter แล้ว dispatch event เอง
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )?.set;
      setter?.call(input, String(barcode).trim());
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        } as KeyboardEventInit)
      );
    };

    window.addEventListener(SCAN_EVENT, handler);
    return () => window.removeEventListener(SCAN_EVENT, handler);
  }, []);
}
