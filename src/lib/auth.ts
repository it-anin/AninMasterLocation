/**
 * ล็อกอินแบบรหัสร่วม ตามแบบ WH-Branch
 *
 * ⚠️ รหัสถูกตรวจฝั่ง client เท่านั้น ไม่ได้ป้องกันระดับฐานข้อมูล
 *    ใครที่รู้ URL + anon key ยังเข้าถึงข้อมูลได้โดยตรง (ดู 0002_rls.sql)
 *    ยอมรับได้เพราะเป็นข้อมูลตำแหน่งสินค้าภายในคลัง
 */

const KEY_AUTH = 'aninloc:auth';
const KEY_STAFF = 'aninloc:staff';

const PASSCODE = (import.meta.env.VITE_APP_PASSCODE as string | undefined)?.trim();

export function checkPasscode(input: string): boolean {
  const typed = input.trim();
  if (!typed) return false;
  // ถ้ายังไม่ตั้ง VITE_APP_PASSCODE ให้ผ่านได้ทุกค่า (โหมด dev)
  if (!PASSCODE) return true;
  return typed === PASSCODE;
}

export function login(staffName: string) {
  try {
    localStorage.setItem(KEY_AUTH, '1');
    localStorage.setItem(KEY_STAFF, staffName.trim());
  } catch {
    // localStorage ใช้ไม่ได้ (private mode) — ยังใช้งานต่อได้ในรอบนี้
  }
}

export function logout() {
  try {
    localStorage.removeItem(KEY_AUTH);
    localStorage.removeItem(KEY_STAFF);
  } catch {
    /* ignore */
  }
}

export function isLoggedIn(): boolean {
  try {
    return localStorage.getItem(KEY_AUTH) === '1' && Boolean(getStaff());
  } catch {
    return false;
  }
}

export function getStaff(): string {
  try {
    return localStorage.getItem(KEY_STAFF) ?? '';
  } catch {
    return '';
  }
}
