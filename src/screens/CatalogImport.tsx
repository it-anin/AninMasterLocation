import { useEffect, useRef, useState } from 'react';
import { prepareCatalog, uploadCatalog, type CatalogPreview } from '../lib/catalogImport';
import { LOCATION_SHEET_URL } from '../lib/supabase';

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'preview'; p: CatalogPreview }
  | { kind: 'uploading'; p: CatalogPreview; done: number; total: number }
  | { kind: 'done'; p: CatalogPreview; items: number; barcodes: number }
  | { kind: 'error'; message: string; p?: CatalogPreview };

/** นำเข้าแคตตาล็อกจาก R05.106.CSV — ใช้แทน npm run import ได้จากคอมเครื่องไหนก็ได้ */
export function CatalogImport() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = state.kind === 'uploading';

  // ปิดแท็บกลางทาง = หยุดกลางชุด (ไม่เสียหาย แต่ข้อมูลไม่ครบจนกว่าจะนำเข้าใหม่)
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [uploading]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setState({ kind: 'reading' });
    try {
      setState({ kind: 'preview', p: await prepareCatalog(file) });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }

  async function onUpload(p: CatalogPreview) {
    try {
      const res = await uploadCatalog(p, (done, total) => setState({ kind: 'uploading', p, done, total }));
      setState({ kind: 'done', p, ...res });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message, p });
    }
  }

  function reset() {
    if (fileRef.current) fileRef.current.value = '';
    setState({ kind: 'idle' });
  }

  const p = 'p' in state ? state.p : undefined;

  return (
    <div className="desktop import-page">
      <h2 className="import-title">นำเข้าสินค้าจาก ProMaxx</h2>
      <p className="import-sub">
        เลือกไฟล์ <b>R05.106.CSV</b> ที่ export จาก ProMaxx — เพิ่มสินค้า/บาร์โค้ดใหม่ และอัปเดตชื่อ หมวด หน่วย
        <br />
        ไม่แตะตำแหน่งจัดเก็บ · ข้ามสินค้าที่เคยกด "ลบสินค้า" ไปแล้ว · นำเข้าซ้ำได้ ปลอดภัย
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        disabled={uploading || state.kind === 'reading'}
        onChange={(e) => onFile(e.target.files?.[0])}
      />

      {state.kind === 'reading' && <div className="hint">กำลังอ่านไฟล์…</div>}

      {state.kind === 'error' && <div className="banner-error import-gap">{state.message}</div>}

      {p && (
        <div className="card import-gap">
          <div className="import-file">📄 {p.fileName}</div>
          <table className="import-stats">
            <tbody>
              <tr><td>แถวในไฟล์</td><td>{p.csvRows.toLocaleString()}</td></tr>
              <tr><td>สินค้าที่จะนำเข้า</td><td><b>{p.items.length.toLocaleString()}</b> <span className="muted">(ในระบบตอนนี้ {p.itemsInDb.toLocaleString()})</span></td></tr>
              <tr><td>บาร์โค้ดที่จะนำเข้า</td><td><b>{p.barcodes.length.toLocaleString()}</b></td></tr>
              <tr>
                <td>ข้าม</td>
                <td>
                  {p.skipped.blank} ว่าง · {p.skipped.tooShort} สั้นเกิน · {p.skipped.dupBarcode} ซ้ำ ·{' '}
                  {p.skipped.noItemId} ไม่มีรหัส/ชื่อ
                </td>
              </tr>
              <tr>
                <td>ข้ามสินค้าที่ถูกลบ</td>
                <td>{p.deletedItems} สินค้า ({p.deletedBarcodes} บาร์โค้ด)</td>
              </tr>
              <tr>
                <td>บาร์โค้ดขึ้นต้นด้วย 0</td>
                <td>{p.leadingZero} <span className="muted">(ปกติประมาณ 126)</span></td>
              </tr>
              <tr>
                <td>บาร์โค้ดสั้นกว่า 6 ตัว</td>
                <td>{p.shortCodes} <span className="muted">(ปกติประมาณ 410 — สินค้ารหัสภายใน ต้องไม่หาย)</span></td>
              </tr>
            </tbody>
          </table>

          {state.kind === 'preview' && (
            <div className="import-actions">
              <button className="btn btn-primary" onClick={() => onUpload(p)}>
                นำเข้า {p.items.length.toLocaleString()} สินค้า
              </button>
              <button className="btn" onClick={reset}>ยกเลิก</button>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="import-actions">
              <button className="btn btn-primary" onClick={() => onUpload(p)}>นำเข้าใหม่</button>
              <button className="btn" onClick={reset}>เลือกไฟล์อื่น</button>
            </div>
          )}

          {state.kind === 'uploading' && (
            <div className="import-gap">
              <div className="import-bar">
                <div style={{ width: `${state.total ? (state.done / state.total) * 100 : 0}%` }} />
              </div>
              <div className="muted">
                กำลังนำเข้า {state.done.toLocaleString()} / {state.total.toLocaleString()} — อย่าปิดหน้านี้
              </div>
            </div>
          )}

          {state.kind === 'done' && (
            <div className="import-gap">
              <div className="import-ok">
                ✅ นำเข้าเสร็จ — ในระบบตอนนี้มีสินค้า {state.items.toLocaleString()} · บาร์โค้ด{' '}
                {state.barcodes.toLocaleString()}
              </div>
              <div className="import-next">
                <b>ขั้นต่อไป:</b> เปิด Google Sheet → เมนู <b>📦 ตำแหน่ง → อัปเดตจากระบบ</b>{' '}
                ไม่งั้นสินค้าใหม่จะไม่มีแถวให้กรอกตำแหน่ง
                {LOCATION_SHEET_URL && (
                  <>
                    {' '}
                    <a href={LOCATION_SHEET_URL} target="_blank" rel="noreferrer">เปิดชีต ↗</a>
                  </>
                )}
              </div>
              <button className="btn" onClick={reset}>นำเข้าไฟล์อื่น</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
