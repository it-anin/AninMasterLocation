import { useCallback, useEffect, useState } from 'react';
import {
  searchItems,
  saveLocation,
  deleteLocation,
  deleteItem,
  getProgress,
  type SearchRow,
} from '../lib/queries';
import { getStaff } from '../lib/auth';
import { EditLocationDialog } from '../components/EditLocationDialog';

const PAGE_SIZE = 50;

export function ProductTable() {
  const [q, setQ] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SearchRow | null>(null);
  const [progress, setProgress] = useState<{ filled: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await searchItems({
        q,
        onlyMissing,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setRows(data);
      setTotal(data[0]?.total_count ?? 0);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
    setLoading(false);
  }, [q, onlyMissing, page]);

  // debounce การพิมพ์ค้นหา ไม่ยิง query ทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    getProgress().then(setProgress).catch(() => setProgress(null));
  }, [rows]);

  useEffect(() => {
    setPage(0);
  }, [q, onlyMissing]);

  async function handleClearLocation(row: SearchRow) {
    if (!confirm(`ลบตำแหน่งของ "${row.name}" ?`)) return;
    try {
      await deleteLocation(row.item_id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  async function handleDeleteItem(row: SearchRow) {
    if (
      !confirm(
        `ลบสินค้า "${row.name}" ออกจากระบบ?\n\n` +
          `บาร์โค้ด ${row.barcodes.length} รายการและตำแหน่งจัดเก็บจะถูกลบไปด้วย\n` +
          `การลบนี้ย้อนกลับไม่ได้`
      )
    )
      return;
    try {
      await deleteItem(row.item_id);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="desktop">
      <div className="toolbar">
        <input
          className="search"
          value={q}
          placeholder="ค้นหา ชื่อสินค้า / บาร์โค้ด / รหัสสินค้า / ตำแหน่ง"
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={onlyMissing}
            onChange={(e) => setOnlyMissing(e.target.checked)}
          />
          เฉพาะที่ยังไม่มีตำแหน่ง
        </label>
        {progress && (
          <div className="progress">
            กรอกแล้ว <b>{progress.filled.toLocaleString()}</b> /{' '}
            {progress.total.toLocaleString()} (
            {progress.total ? Math.round((progress.filled / progress.total) * 100) : 0}%)
          </div>
        )}
      </div>

      {error && <div className="banner-error">{error}</div>}

      <table className="table">
        <thead>
          <tr>
            <th>ชื่อสินค้า</th>
            <th>รหัส</th>
            <th>บาร์โค้ด</th>
            <th>ตำแหน่ง</th>
            <th>แก้ไขโดย</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr>
              <td colSpan={6} className="empty">
                กำลังโหลด…
              </td>
            </tr>
          )}
          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                ไม่พบข้อมูล
              </td>
            </tr>
          )}
          {!loading &&
            rows.map((r) => (
              <tr key={r.item_id}>
                <td>
                  <div className="cell-name">{r.name}</div>
                  {r.category && <div className="cell-sub">{r.category}</div>}
                </td>
                <td className="mono">{r.item_id}</td>
                <td className="mono cell-barcodes">
                  {r.barcodes.slice(0, 3).map((b) => (
                    <div key={b}>{b}</div>
                  ))}
                  {r.barcodes.length > 3 && (
                    <div className="cell-sub">+{r.barcodes.length - 3} รายการ</div>
                  )}
                </td>
                <td>
                  {r.location ? (
                    <span className="loc-chip">{r.location}</span>
                  ) : (
                    <span className="loc-chip loc-chip-none">ยังไม่ระบุ</span>
                  )}
                  {r.note && <div className="cell-sub">{r.note}</div>}
                </td>
                <td className="cell-sub">{r.updated_by ?? '—'}</td>
                <td className="actions">
                  <button className="btn btn-sm" onClick={() => setEditing(r)}>
                    แก้ไข
                  </button>
                  {r.location && (
                    <button className="btn btn-sm" onClick={() => handleClearLocation(r)}>
                      ลบตำแหน่ง
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => handleDeleteItem(r)}>
                    ลบสินค้า
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>

      <div className="pager">
        <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ← ก่อนหน้า
        </button>
        <span>
          หน้า {page + 1} / {pages} ({total.toLocaleString()} รายการ)
        </span>
        <button
          className="btn btn-sm"
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
        >
          ถัดไป →
        </button>
      </div>

      {editing && (
        <EditLocationDialog
          itemId={editing.item_id}
          itemName={editing.name}
          current={editing.location}
          currentNote={editing.note}
          onClose={() => setEditing(null)}
          onSaved={async (loc, note) => {
            await saveLocation(editing.item_id, loc, getStaff() || 'ไม่ระบุ', note);
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
