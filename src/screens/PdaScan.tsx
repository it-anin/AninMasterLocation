import { useCallback, useEffect, useRef, useState } from 'react';
import { useScanner } from '../lib/useScanner';
import {
  lookupBarcode,
  loadWarehouseMap,
  parseLocation,
  saveLocation,
  searchName,
  searchSku,
  type LookupResult,
  type MapCell,
} from '../lib/queries';
import { getStaff } from '../lib/auth';
import { EditLocationDialog } from '../components/EditLocationDialog';
import { LocationResult } from '../components/LocationResult';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; barcode: string }
  | { kind: 'found'; data: LookupResult }
  | { kind: 'notfound'; barcode: string }
  | { kind: 'error'; message: string }
  /** by = ค้นเจอด้วยอะไร — ใช้เลือกข้อความแนะนำตอนผลเต็มหน้า */
  | { kind: 'results'; q: string; rows: LookupResult[]; by: 'sku' | 'name' };

/** จำนวนผลค้นหาสูงสุดที่แสดง — ต้องตรงกับค่าที่ส่งให้ searchSku / searchName */
const SEARCH_LIMIT = 25;

/**
 * หน้าสแกนบน PDA
 *
 * canEdit = false (packing) → ดูตำแหน่งอย่างเดียว ไม่มีปุ่มแก้
 * canEdit = true  (admin)   → แก้ในเครื่องได้ · โหมด Google Sheet ขึ้นข้อความให้ไปแก้ที่ชีตแทน
 */
export function PdaScan({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
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

  /**
   * ช่องเดียวรับทั้งบาร์โค้ด SKU และชื่อสินค้า — ระบบเดาเอง
   *
   * ลองหาบาร์โค้ดก่อนเสมอ เพราะเป็นงานหลักและต้องเร็วที่สุด
   * ไม่เจอค่อยหา SKU แล้วค่อยหาชื่อ — แยกด้วยรูปแบบไม่ได้ เพราะ SKU กับบาร์โค้ดสั้นๆ
   * หน้าตาเหมือนกัน (SKU 6 หลัก เช่น 900157 · บาร์โค้ดก็มีแบบสั้นเช่น 30031812)
   * ชื่อค้นเป็นขั้นสุดท้าย — ยิงบาร์โค้ดไม่เสียเวลาเพิ่ม และ SKU ที่พิมพ์ไม่ครบยังได้ผลเหมือนเดิม
   */
  const handleScan = useCallback(
    async (raw: string) => {
      const q = raw.trim();
      if (!q) return;

      setState({ kind: 'loading', barcode: q });
      if (inputRef.current) inputRef.current.value = '';

      try {
        // 1. บาร์โค้ดก่อน
        const data = await lookupBarcode(q);
        if (data) {
          setState({ kind: 'found', data });
          beep(data.location ? 'ok' : 'warn');
          focusInput();
          return;
        }

        // 2. ไม่เจอ → ลองเป็น SKU · ยังไม่เจออีก → ลองเป็นชื่อสินค้า
        let by: 'sku' | 'name' = 'sku';
        let rows = await searchSku(q, SEARCH_LIMIT);
        if (rows.length === 0) {
          by = 'name';
          rows = await searchName(q, SEARCH_LIMIT);
        }

        if (rows.length === 1) {
          setState({ kind: 'found', data: rows[0] });
          beep(rows[0].location ? 'ok' : 'warn');
        } else if (rows.length > 1) {
          setState({ kind: 'results', q, rows, by });
        } else {
          setState({ kind: 'notfound', barcode: q });
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

  /** เลือกสินค้าจากผลค้นหา — ข้อมูลครบอยู่แล้วจาก searchSku ไม่ต้อง query ซ้ำ */
  const pickResult = useCallback((row: LookupResult) => {
    setState({ kind: 'found', data: row });
    beep(row.location ? 'ok' : 'warn');
  }, []);

  // ปิดตัวสแกนตอนเปิดหน้าแก้ตำแหน่ง ไม่งั้นการพิมพ์จะถูกดักเป็นบาร์โค้ด
  useScanner(handleScan, !editing);

  useEffect(() => {
    focusInput();
  }, [focusInput]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // ไม่ปล่อย Enter ลอยขึ้นไปถึง keyboard-wedge ของ useScanner (ฟังที่ window)
      // ไม่งั้นค้นซ้อน 2 ชุด: ชุดจากข้อความในช่อง + ชุดจากตัวอักษรท้ายๆ ที่ wedge เก็บไว้
      // พิมพ์ชื่อสินค้าแล้วเว้นจังหวะกลางคำ (> 150ms) ผลที่ขึ้นจะเป็นของชุดที่ตอบกลับทีหลัง
      // ไม่ใช่สิ่งที่พิมพ์ — ส่วน wedge ตอนช่องไม่ได้ focus ยังทำงานตามเดิม
      e.stopPropagation();
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
        placeholder="Barcode, SKU หรือชื่อสินค้า"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        data-android-barcode="true"
        onKeyDown={onKeyDown}
      />

      <div className="result-area">
        {state.kind === 'idle' && (
          <div className="hint">
            ยิงบาร์โค้ด หรือพิมพ์ SKU / ชื่อสินค้า แล้วกด Enter
            <br />
            (พิมพ์ไม่ครบก็ได้ เช่น 1000 หรือ vitamin)
          </div>
        )}

        {state.kind === 'loading' && <div className="hint">กำลังค้นหา {state.barcode}…</div>}

        {state.kind === 'results' && (
          <div className="card">
            {state.rows.length === 0 ? (
              <>
                <div className="card-title">ไม่พบสินค้า</div>
                <div className="card-sub">ไม่มี SKU ที่ขึ้นต้นด้วย "{state.q}"</div>
              </>
            ) : (
              <>
                <div className="res-head">
                  {/* ค้นจำกัด 25 แถว — ถ้าเต็มแปลว่าอาจมีมากกว่านี้
                      บอกให้พิมพ์เพิ่ม ดีกว่าโชว์ตัวเลขที่ไม่ใช่ทั้งหมดจริง */}
                  {state.rows.length >= SEARCH_LIMIT
                    ? `แสดง ${SEARCH_LIMIT} รายการแรก — พิมพ์${
                        state.by === 'name' ? 'ชื่อ' : ' SKU '
                      }ให้ยาวขึ้นเพื่อแคบผลลัพธ์`
                    : `พบ ${state.rows.length} รายการ — แตะเพื่อดูตำแหน่ง`}
                </div>
                {state.rows.map((r) => (
                  <button
                    key={r.item_id}
                    type="button"
                    className="res-row"
                    onClick={() => pickResult(r)}
                  >
                    <span className="res-text">
                      <span className="res-sku">{r.item_id}</span>
                      <span className="res-name">{r.name}</span>
                    </span>
                    <span className={r.location ? 'res-loc' : 'res-loc res-loc-none'}>
                      {r.location ?? 'ยังไม่ระบุ'}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

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
              ไม่มีบาร์โค้ด SKU หรือชื่อสินค้านี้ในระบบ — บาร์โค้ดใหม่เพิ่มได้จากหน้าจัดการบนคอมพิวเตอร์
            </div>
          </div>
        )}

        {found && (
          <LocationResult
            found={found}
            mapCells={mapCells}
            onEdit={canEdit ? () => setEditing(true) : undefined}
          />
        )}
      </div>

      {canEdit && editing && found && (
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
            // ⚠️ zone/aisle/slot เป็น generated column ฝั่ง DB — ต้องคำนวณซ้ำฝั่งนี้ด้วย
            //    ไม่งั้นผังจะไฮไลท์ช่องเก่าจนกว่าจะสแกนใหม่
            const parsed = parseLocation(loc);
            setState({
              kind: 'found',
              data: {
                ...found,
                location: loc,
                zone: parsed.zone,
                aisle: parsed.aisle,
                slot: parsed.slot,
                note: note ?? null,
                updated_by: getStaff(),
              },
            });
            setEditing(false);
            refreshMap(); // ตำแหน่งใหม่อาจเป็นโซน/ชั้นที่ยังไม่เคยมีในผัง
            focusInput();
          }}
        />
      )}
    </div>
  );
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
