import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

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
