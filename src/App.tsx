import { useState } from 'react';
import { isAndroidMode, useScanFallback } from './lib/useScanner';
import { getStaff, isLoggedIn, logout } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Login } from './screens/Login';
import { PdaScan } from './screens/PdaScan';
import { ProductTable } from './screens/ProductTable';

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn());

  // listener ชั้น fallback สำหรับหน้าที่ไม่มี handler เฉพาะ
  useScanFallback();

  if (!isConfigured) {
    return (
      <div className="banner-error setup-note">
        ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูล
        <br />
        คัดลอกไฟล์ <code>.env.example</code> เป็น <code>.env</code> แล้วเติม{' '}
        <code>VITE_SUPABASE_URL</code> และ <code>VITE_SUPABASE_ANON_KEY</code>
      </div>
    );
  }

  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <div className={isAndroidMode ? 'app app-pda' : 'app'}>
      <header className="topbar">
        <span className="brand">📍 AninMaster Location</span>
        <span className="spacer" />
        <span className="staff">👤 {getStaff()}</span>
        <button
          className="btn btn-sm"
          onClick={() => {
            logout();
            setAuthed(false);
          }}
        >
          ออก
        </button>
      </header>

      <main>{isAndroidMode ? <PdaScan /> : <ProductTable />}</main>
    </div>
  );
}
