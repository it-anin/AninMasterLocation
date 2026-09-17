import { useEffect, useRef, useState } from 'react';
import { listLocations } from '../lib/queries';

interface Props {
  itemId: string;
  itemName: string;
  current: string | null;
  currentNote?: string | null;
  onClose: () => void;
  onSaved: (location: string, note: string | null) => Promise<void>;
}

/** ค่า location ที่เคยใช้ — โหลดครั้งเดียวต่อ session ไม่ต้อง query ทุกครั้งที่เปิด dialog */
let cachedLocations: string[] | null = null;

export function EditLocationDialog({
  itemId,
  itemName,
  current,
  currentNote,
  onClose,
  onSaved,
}: Props) {
  const [value, setValue] = useState(current ?? '');
  const [note, setNote] = useState(currentNote ?? '');
  const [options, setOptions] = useState<string[]>(cachedLocations ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();

    if (cachedLocations) return;
    listLocations()
      .then((l) => {
        cachedLocations = l;
        setOptions(l);
      })
      .catch(() => {
        // autocomplete ใช้ไม่ได้ก็ยังพิมพ์เองได้ ไม่ต้องแจ้ง error
      });
  }, []);

  async function handleSave() {
    const loc = value.trim();
    if (!loc) {
      setError('กรุณากรอกตำแหน่งจัดเก็บ');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSaved(loc, note.trim() || null);
      // เพิ่มค่าใหม่เข้า cache ให้ autocomplete รอบหน้าเห็นทันที
      if (cachedLocations && !cachedLocations.includes(loc)) {
        cachedLocations = [...cachedLocations, loc].sort((a, b) => a.localeCompare(b, 'th'));
      }
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !saving) {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="dialog-title">กำหนดตำแหน่งจัดเก็บ</div>
        <div className="dialog-sub">
          {itemName}
          <br />
          <span className="meta">{itemId}</span>
        </div>

        <label className="field-label">ตำแหน่ง</label>
        <input
          ref={inputRef}
          className="field"
          list="known-locations"
          value={value}
          placeholder="เช่น A-01-03"
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
        />
        <datalist id="known-locations">
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>

        <label className="field-label">หมายเหตุ (ไม่บังคับ)</label>
        <input
          className="field"
          value={note}
          placeholder="เช่น ชั้นล่างสุด"
          autoComplete="off"
          onChange={(e) => setNote(e.target.value)}
        />

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}
