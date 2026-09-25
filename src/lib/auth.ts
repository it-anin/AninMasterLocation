/**
 * ล็อกอินแบบรหัสร่วม ตามแบบ WH-Branch — รหัสที่กรอกเป็นตัวกำหนดบทบาท
 *
 *   admin   ทุกเมนู · แก้ตำแหน่งได้ทั้ง Desktop และ PDA
 *   packing ดูตำแหน่งอย่างเดียว · Desktop เห็นแค่แท็บค้นหาตำแหน่ง
 *
 * ⚠️ รหัสและบทบาทถูกตรวจฝั่ง client เท่านั้น ไม่ได้ป้องกันระดับฐานข้อมูล
 *    - รหัสอยู่ใน bundle ใครเปิด source ของหน้าเว็บก็เห็น
 *    - บทบาทเก็บใน localStorage แก้เองใน DevTools ได้
 *    - ใครที่รู้ URL + anon key ยังเขียนข้อมูลได้โดยตรง (ดู 0002_rls.sql)
 *    ยอมรับได้เพราะเป็นข้อมูลตำแหน่งสินค้าภายในคลัง — การซ่อนเมนูกันพนักงานแก้ผิดโดยไม่ตั้งใจ
 *    ไม่ได้กันคนที่ตั้งใจจะแก้
 */

export type Role = 'admin' | 'packing';

/** เปลี่ยนรหัส = แก้ที่นี่แล้ว push (Vercel deploy เอง) — ห้ามให้ 2 บทบาทใช้รหัสเดียวกัน */
const PASSCODES: Record<string, Role> = {
  '0000': 'admin',
  '1234': 'packing',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  packing: 'Packing',
};

const KEY_AUTH = 'aninloc:auth';
const KEY_ROLE = 'aninloc:role';
/** ชื่อผู้ใช้จากหน้าล็อกอินแบบเก่า — ไม่ใช้แล้ว เก็บชื่อ key ไว้ลบทิ้งตอนล็อกอิน/ออก */
const KEY_STAFF_OLD = 'aninloc:staff';

/** รหัสถูก → บทบาท · ผิด → null */
export function roleForPasscode(input: string): Role | null {
  return PASSCODES[input.trim()] ?? null;
}

export function login(role: Role) {
  try {
    localStorage.setItem(KEY_AUTH, '1');
    localStorage.setItem(KEY_ROLE, role);
    localStorage.removeItem(KEY_STAFF_OLD);
  } catch {
    // localStorage ใช้ไม่ได้ (private mode) — ยังใช้งานต่อได้ในรอบนี้
  }
}

export function logout() {
  try {
    localStorage.removeItem(KEY_AUTH);
    localStorage.removeItem(KEY_ROLE);
    localStorage.removeItem(KEY_STAFF_OLD);
  } catch {
    /* ignore */
  }
}

/**
 * บทบาทของคนที่ล็อกอินอยู่ · null = ยังไม่ล็อกอิน
 *
 * เครื่องที่ล็อกอินค้างไว้ก่อนมีระบบบทบาทจะไม่มี KEY_ROLE → ได้ null → ต้องล็อกอินใหม่ครั้งเดียว
 * ห้ามเดาเป็น admin — PDA ที่ packing ใช้อยู่จะได้สิทธิ์แก้ไปเฉยๆ
 */
export function getRole(): Role | null {
  try {
    if (localStorage.getItem(KEY_AUTH) !== '1') return null;
    const role = localStorage.getItem(KEY_ROLE);
    return role === 'admin' || role === 'packing' ? role : null;
  } catch {
    return null;
  }
}

/**
 * ชื่อที่บันทึกลงประวัติ (updated_by / changed_by / deleted_by) = ชื่อบทบาท
 *
 * ไม่มีช่องกรอกชื่อแล้ว — รหัสบอกบทบาทอยู่แล้ว
 * ⚠️ ประวัติจึงบอกได้แค่ว่า "Admin" แก้ ไม่รู้ว่าเป็นใคร (แก้จาก Google Sheet ยังได้อีเมลเหมือนเดิม)
 */
export function getStaff(): string {
  const role = getRole();
  return role ? ROLE_LABEL[role] : '';
}
