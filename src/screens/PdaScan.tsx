import { useCallback, useEffect, useRef, useState } from 'react';
import { useScanner } from '../lib/useScanner';
import {
  lookupBarcode,
  loadWarehouseMap,
  parseLocation,
  saveLocation,
  type LookupResult,
  type MapCell,
} from '../lib/queries';
import { getStaff } from '../lib/auth';
import { EditLocationDialog } from '../components/EditLocationDialog';
import { WarehouseMap } from '../components/WarehouseMap';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; barcode: string }
  | { kind: 'found'; data: LookupResult }
  | { kind: 'notfound'; barcode: string }
  | { kind: 'error'; message: string };

interface RecentEntry {
  barcode: string;
  name: string;
  location: string | null;
}

export function PdaScan() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [mapCells, setMapCells] = useState<MapCell[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // โหลดผังคลังครั้งเดียวตอนเปิดหน้า แล้วรีเฟรชเมื่อมีการกรอกตำแหน่งใหม่
  const refreshMap = useCallback(() => {
    loadWarehouseMap()
      .then(setMapCells)
      .catch(() => {
        // ผังโหลดไม่ได้ก็ยังใช้งานได้ — จะ fallback ไปแสดงรหัสตัวใหญ่
      });
  }, []);

  useEffect(refreshMap, [refreshMap]);

  const focusInput = useCallback(() => {
    // หน่วงนิดเดียวให้ DOM อัปเดตเสร็จก่อน ไม่งั้น focus ไม่ติดบางจังหวะ
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleScan = useCallback(
    async (raw: string) => {
      const barcode = raw.trim();
      if (!barcode) return;

      setState({ kind: 'loading', barcode });
      if (inputRef.current) inputRef.current.value = '';

      try {
        const data = await lookupBarcode(barcode);
        if (data) {
          setState({ kind: 'found', data });
          setRecent((prev) =>
            [
              { barcode, name: data.name, location: data.location },
              ...prev.filter((r) => r.barcode !== barcode),
            ].slice(0, 8)
          );
          beep(data.location ? 'ok' : 'warn');
        } else {
          setState({ kind: 'notfound', barcode });
          beep('error');
        }
      } catch (e) {
        setState({ kind: 'error', message: (e as Error).message });
        beep('error');
      }
      focusInput();
    },
    [focusInput]
  );

  useScanner(handleScan, !editing);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // อ่านจาก DOM ตรงๆ ไม่ผ่าน React state — state update เป็น async
      // อาจ stale ไม่ทันตอนสแกนรัวๆ
      handleScan(e.currentTarget.value);
    }
  }

  const found = state.kind === 'found' ? state.data : null;

  return (
    <div className="pda">
      <input
        ref={inputRef}
        className="scan-input"
        placeholder="ยิงบาร์โค้ดได้เลย"
        inputMode="none"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        data-android-barcode="true"
        onKeyDown={onKeyDown}
      />

      <div className="result-area">
        {state.kind === 'idle' && (
          <div className="hint">พร้อมสแกน — เล็งบาร์โค้ดที่กล่องสินค้าแล้วกดปุ่มยิง</div>
        )}

        {state.kind === 'loading' && <div className="hint">กำลังค้นหา {state.barcode}…</div>}

        {state.kind === 'error' && (
          <div className="card card-error">
            <div className="card-title">เกิดข้อผิดพลาด</div>
            <div className="card-sub">{state.message}</div>
          </div>
        )}

        {state.kind === 'notfound' && (
          <div className="card card-error">
            <div className="card-title">ไม่พบสินค้า</div>
            <div className="barcode-line">{state.barcode}</div>
            <div className="card-sub">
              บาร์โค้ดนี้ยังไม่มีในระบบ — เพิ่มได้จากหน้าจัดการบนคอมพิวเตอร์
            </div>
          </div>
        )}

        {found && (
          <div className={`card ${found.location ? 'card-ok' : 'card-warn'}`}>
            {found.location ? (
              // แผนผังใช้ได้ต่อเมื่อรหัสแยกโซน/ชั้นออก (เช่น A-03)
              // ถ้าเป็นข้อความอิสระ (เช่น "ตู้เย็น") ให้แสดงรหัสตัวใหญ่แทน
              canMap(found, mapCells) ? (
                <>
                  <div className="loc-label">
                    โซน {found.zone} — ชั้นที่ {found.aisle}
                  </div>
                  <WarehouseMap
                    cells={mapCells}
                    activeZone={found.zone}
                    activeAisle={found.aisle}
                    activeLabel={found.location}
                  />
                </>
              ) : (
                <>
                  <div className="loc-label">ตำแหน่งจัดเก็บ</div>
                  <div className="loc-value">{found.location}</div>
                </>
              )
            ) : (
              <div className="loc-missing">ยังไม่ได้ระบุตำแหน่ง</div>
            )}

            <div className="item-name">{found.name}</div>

            {found.note && <div className="note">📝 {found.note}</div>}

            <div className="meta">
              {found.item_id}
              {found.unit ? ` · ${found.unit}` : ''}
            </div>
            <div className="barcode-line">{found.barcode}</div>

            {found.updated_by && (
              <div className="meta-small">
                แก้ไขล่าสุด: {found.updated_by}
                {found.location_updated_at
                  ? ` · ${new Date(found.location_updated_at).toLocaleDateString('th-TH')}`
                  : ''}
              </div>
            )}

            <button className="btn btn-primary" onClick={() => setEditing(true)}>
              {found.location ? '✏️ แก้ไขตำแหน่ง' : '➕ กำหนดตำแหน่ง'}
            </button>
          </div>
        )}
      </div>

      {recent.length > 0 && (
        <div className="recent">
          <div className="recent-title">ล่าสุด</div>
          {recent.map((r) => (
            <div key={r.barcode} className="recent-row">
              <span className="recent-name">{r.name}</span>
              <span className={r.location ? 'recent-loc' : 'recent-loc recent-loc-none'}>
                {r.location ?? 'ยังไม่ระบุ'}
              </span>
            </div>
          ))}
        </div>
      )}

      {editing && found && (
        <EditLocationDialog
          itemId={found.item_id}
          itemName={found.name}
          current={found.location}
          currentNote={found.note}
          onClose={() => {
            setEditing(false);
            focusInput();
          }}
          onSaved={async (loc, note) => {
            await saveLocation(found.item_id, loc, getStaff() || 'ไม่ระบุ', note);
            // ⚠️ zone/aisle เป็น generated column ฝั่ง DB — ต้องคำนวณซ้ำฝั่งนี้ด้วย
            //    ไม่งั้นผังจะไฮไลท์ช่องเก่าจนกว่าจะสแกนใหม่
            const parsed = parseLocation(loc);
            setState({
              kind: 'found',
              data: {
                ...found,
                location: loc,
                zone: parsed.zone,
                aisle: parsed.aisle,
                note: note ?? null,
                updated_by: getStaff(),
              },
            });
            setRecent((prev) =>
              prev.map((r) => (r.barcode === found.barcode ? { ...r, location: loc } : r))
            );
            setEditing(false);
            refreshMap(); // ตำแหน่งใหม่อาจเป็นโซน/ชั้นที่ยังไม่เคยมีในผัง
            focusInput();
          }}
        />
      )}
    </div>
  );
}

/**
 * ตัดสินว่าจะวาดผังหรือแสดงรหัสตัวใหญ่แทน
 *
 * ต้องครบ 2 อย่าง:
 *  1. รหัสแยกโซน/ชั้นออกได้ (zone + aisle ไม่ null)
 *  2. มีผังให้วาดจริง — ถ้าทั้งคลังมีอยู่ตำแหน่งเดียว ตารางช่องเดียวไม่มีประโยชน์
 *     สู้แสดงรหัสตัวใหญ่ชัดๆ ดีกว่า
 */
function canMap(found: LookupResult, cells: MapCell[]): found is LookupResult & {
  zone: string;
  aisle: number;
} {
  if (!found.zone || found.aisle == null) return false;
  const zones = new Set(cells.map((c) => c.zone));
  zones.add(found.zone);
  return cells.length >= 2 || zones.size >= 2;
}

/** เสียงตอบรับ — พนักงานไม่ต้องจ้องจอตอนสแกนต่อเนื่อง */
function beep(kind: 'ok' | 'warn' | 'error') {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.value = kind === 'ok' ? 880 : kind === 'warn' ? 620 : 300;
    gain.gain.value = 0.08;
    osc.start();
    osc.stop(ctx.currentTime + (kind === 'error' ? 0.25 : 0.1));
    osc.onended = () => ctx.close();
  } catch {
    // เครื่องปิดเสียง หรือ browser ไม่อนุญาต — ไม่ใช่เรื่องคอขาดบาดตาย
  }

  try {
    if (kind !== 'ok') navigator.vibrate?.(kind === 'error' ? [80, 60, 80] : 60);
  } catch {
    /* ignore */
  }
}
