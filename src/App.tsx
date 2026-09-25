import { lazy, Suspense, useState } from 'react';
import aninLogo from './assets/anin-logo.png';
import { isAndroidMode, useScanFallback } from './lib/useScanner';
import { getStaff, isLoggedIn, logout } from './lib/auth';
import { isConfigured } from './lib/supabase';
import { Login } from './screens/Login';
import { PdaScan } from './screens/PdaScan';
import { ProductTable } from './screens/ProductTable';
import { DesktopSearch } from './screens/DesktopSearch';

// โหลดเมื่อเปิดแท็บเท่านั้น — PDA โหลด bundle เดียวกันทุกครั้งที่เปิดแอป ไม่ต้องพก papaparse ไปด้วย
const CatalogImport = lazy(() =>
  import('./screens/CatalogImport').then((m) => ({ default: m.CatalogImport }))
);

/** หน้าบน Desktop — PDA ไม่มีแท็บ เพราะมีหน้าเดียว */
type Tab = 'search' | 'manage' | 'import';

export default function App() {
  const [authed, setAuthed] = useState(isLoggedIn());
  const [tab, setTab] = useState<Tab>('search');

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
        <span className="brand">
          {/* โลโก้เป็นคำว่า ANIN อยู่แล้ว ใส่ alt="" ไม่ให้ screen reader อ่านซ้ำกับข้อความข้างๆ */}
          <img className="brand-logo" src={aninLogo} alt="" />
          Master Location
        </span>
        {/* แท็บเฉพาะบน Desktop — โหมด PDA มีหน้าเดียว ไม่ต้องเลือก */}
        {!isAndroidMode && (
          <nav className="tabs-nav">
            <button
              className={tab === 'search' ? 'tab-btn tab-btn-on' : 'tab-btn'}
              onClick={() => setTab('search')}
            >
              ค้นหาตำแหน่ง
            </button>
            <button
              className={tab === 'manage' ? 'tab-btn tab-btn-on' : 'tab-btn'}
              onClick={() => setTab('manage')}
            >
              จัดการข้อมูล
            </button>
            <button
              className={tab === 'import' ? 'tab-btn tab-btn-on' : 'tab-btn'}
              onClick={() => setTab('import')}
            >
              นำเข้าสินค้า
            </button>
          </nav>
        )}

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

      <main>
        {isAndroidMode ? (
          <PdaScan />
        ) : tab === 'search' ? (
          <DesktopSearch />
        ) : tab === 'manage' ? (
          <ProductTable />
        ) : (
          <Suspense fallback={<div className="hint">กำลังโหลด…</div>}>
            <CatalogImport />
          </Suspense>
        )}
      </main>
    </div>
  );
}
