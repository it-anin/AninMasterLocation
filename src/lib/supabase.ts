import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

/**
 * ลิงก์ Google Sheet ที่ใช้แก้ตำแหน่ง — ตั้งค่าเมื่อไหร่ = ปิดการแก้ตำแหน่งในเว็บและ PDA
 * ให้ Sheet เป็นที่แก้ที่เดียว (sync ทางเดียว Sheet → DB ผ่าน sheet/Code.gs)
 * ปล่อยว่าง = แก้ในเว็บแบบเดิม
 */
export const LOCATION_SHEET_URL =
  (import.meta.env.VITE_LOCATION_SHEET_URL as string | undefined)?.trim() || null;

if (!isConfigured) {
  console.error(
    'ยังไม่ได้ตั้งค่า VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — คัดลอก .env.example เป็น .env แล้วเติมค่า'
  );
}

export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'anon', {
  // ⚠️ ต้องชี้ schema anin_loc — schema public คือฐานข้อมูล POS ตัวจริง ห้ามแตะ
  db: { schema: 'anin_loc' },
  auth: { persistSession: false },
});
