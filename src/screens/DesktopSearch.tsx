import { useCallback, useEffect, useRef, useState } from 'react';
import {
  lookupBarcode,
  loadWarehouseMap,
  parseLocation,
  saveLocation,
  searchSku,
  type LookupResult,
  type MapCell,
} from '../lib/queries';
import { getStaff } from '../lib/auth';
import { EditLocationDialog } from '../components/EditLocationDialog';
import { LocationResult } from '../components/LocationResult';

/**
 * หน้าค้นหาบน Desktop — ให้เห็นผังคลังและภาพชั้นวางเหมือนหน้า PDA
 *
 * ใช้ LocationResult ตัวเดียวกับหน้า PDA จึงแสดงผลเหมือนกันเป๊ะ
 * ต่างกันแค่ layout: จอกว้างจัดเป็น 2 คอลัมน์ (รายการซ้าย · ผลลัพธ์ขวา)
 *
 * ⚠️ ไม่ได้ผูกกับตัวสแกน (useScanner) เพราะหน้านี้ใช้บนคอมพิวเตอร์
 *    ถ้าต่อเครื่องสแกนแบบ USB ก็ยังใช้ได้ เพราะมันพิมพ์ลงช่องแล้วกด Enter เอง
 *
 * canEdit = false (packing) → ไม่มีปุ่มแก้ตำแหน่ง ดูอย่างเดียว
 */

const SEARCH_LIMIT = 25;

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; q: string }
  | { kind: 'found'; data: LookupResult }
  | { kind: 'notfound'; q: string }
  | { kind: 'error'; message: string }
  | { kind: 'results'; q: string; rows: LookupResult[] };

export function DesktopSearch({ canEdit }: { canEdit: boolean }) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [editing, setEditing] = useState(false);
  const [mapCells, setMapCells] = useState<MapCell[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshMap = useCallback(() => {
    loadWarehouseMap()
      .then(setMapCells)
      .catch(() => {
        // ผังโหลดไม่ได้ก็ยังใช้งานได้ — จะ fallback ไปแสดงรหัสตัวใหญ่
      });
  }, []);

  useEffect(refreshMap, [refreshMap]);
  useEffect(() => inputRef.current?.focus(), []);

  /** ลอจิกเดียวกับหน้า PDA — หาบาร์โค้ดก่อน ไม่เจอค่อยหา SKU */
  const handleSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) return;

    setState({ kind: 'loading', q });
    try {
      const data = await lookupBarcode(q);
      if (data) {
        setState({ kind: 'found', data });
        return;
      }
      const rows = await searchSku(q, SEARCH_LIMIT);
      if (rows.length === 1) setState({ kind: 'found', data: rows[0] });
      else if (rows.length > 1) setState({ kind: 'results', q, rows });
      else setState({ kind: 'notfound', q });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  }, []);

  const found = state.kind === 'found' ? state.data : null;

  return (
    <div className="dsearch">
      <div className="dsearch-bar">
        <input
          ref={inputRef}
          className="field dsearch-input"
          placeholder="ยิงบาร์โค้ด หรือพิมพ์ SKU แล้วกด Enter"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSearch(e.currentTarget.value);
            }
          }}
        />
        <button
          className="btn btn-primary"
          onClick={() => handleSearch(inputRef.current?.value ?? '')}
        >
          ค้นหา
        </button>
      </div>

      <div className="dsearch-body">
        {state.kind === 'idle' && (
          <div className="hint">
            ยิงบาร์โค้ด หรือพิมพ์ SKU แล้วกด Enter
            <br />
            (พิมพ์ SKU ไม่ครบก็ได้ เช่น 1000)
          </div>
        )}

        {state.kind === 'loading' && <div className="hint">กำลังค้นหา {state.q}…</div>}

        {state.kind === 'error' && (
          <div className="card card-error">
            <div className="card-title">เกิดข้อผิดพลาด</div>
            <div className="card-sub">{state.message}</div>
          </div>
        )}

        {state.kind === 'notfound' && (
          <div className="card card-error">
            <div className="card-title">ไม่พบสินค้า</div>
            <div className="barcode-line">{state.q}</div>
            <div className="card-sub">ไม่มีบาร์โค้ดหรือ SKU ที่ตรงกับที่ค้น</div>
          </div>
        )}

        {state.kind === 'results' && (
          <div className="card">
            <div className="res-head">
              {state.rows.length >= SEARCH_LIMIT
                ? `แสดง ${SEARCH_LIMIT} รายการแรก — พิมพ์ SKU ให้ยาวขึ้นเพื่อแคบผลลัพธ์`
                : `พบ ${state.rows.length} รายการ — คลิกเพื่อดูตำแหน่ง`}
            </div>
            {state.rows.map((r) => (
              <button
                key={r.item_id}
                type="button"
                className="res-row"
                onClick={() => setState({ kind: 'found', data: r })}
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
          onClose={() => setEditing(false)}
          onSaved={async (loc, note) => {
            await saveLocation(found.item_id, loc, getStaff() || 'ไม่ระบุ', note);
            // ⚠️ zone/aisle/slot เป็น generated column ฝั่ง DB — ต้องคำนวณซ้ำฝั่งนี้ด้วย
            //    ไม่งั้นผังจะไฮไลท์ที่เก่าจนกว่าจะค้นใหม่
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
            refreshMap(); // ตำแหน่งใหม่อาจเป็นโซน/เชลฟ์ที่ยังไม่เคยมีในผัง
          }}
        />
      )}
    </div>
  );
}
