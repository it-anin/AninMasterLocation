import { useState } from 'react';
import { login, roleForPasscode, type Role } from '../lib/auth';
import { isAndroidMode } from '../lib/useScanner';

/** ช่องเดียว — รหัสบอกบทบาทอยู่แล้ว (admin / packing) ไม่ต้องกรอกชื่อ */
export function Login({ onDone }: { onDone: (role: Role) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const role = roleForPasscode(code);
    if (!role) {
      setError('รหัสไม่ถูกต้อง');
      return;
    }
    login(role);
    onDone(role);
  }

  return (
    <div className={isAndroidMode ? 'login login-pda' : 'login'}>
      <form className="login-box" onSubmit={submit}>
        <div className="login-title">AninMaster Location</div>
        <div className="login-sub">ระบบค้นหาตำแหน่งจัดเก็บสินค้า</div>

        <label className="field-label">รหัสเข้าใช้งาน</label>
        <input
          className="field"
          type="password"
          value={code}
          autoComplete="off"
          autoFocus
          onChange={(e) => setCode(e.target.value)}
        />

        {error && <div className="dialog-error">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit">
          เข้าใช้งาน
        </button>
      </form>
    </div>
  );
}
