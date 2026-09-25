import { useState } from 'react';
import { login, roleForPasscode, type Role } from '../lib/auth';
import { isAndroidMode } from '../lib/useScanner';

export function Login({ onDone }: { onDone: (role: Role) => void }) {
  const [code, setCode] = useState('');
  const [staff, setStaff] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const role = roleForPasscode(code);
    if (!role) {
      setError('รหัสไม่ถูกต้อง');
      return;
    }
    if (!staff.trim()) {
      setError('กรุณากรอกชื่อผู้ใช้งาน');
      return;
    }
    login(staff, role);
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
          onChange={(e) => setCode(e.target.value)}
        />

        <label className="field-label">ชื่อผู้ใช้งาน</label>
        <input
          className="field"
          value={staff}
          placeholder="เช่น สมชาย"
          autoComplete="off"
          onChange={(e) => setStaff(e.target.value)}
        />

        {error && <div className="dialog-error">{error}</div>}

        <button className="btn btn-primary btn-block" type="submit">
          เข้าใช้งาน
        </button>

        <div className="login-note">ชื่อผู้ใช้งานจะถูกบันทึกไว้ในประวัติการแก้ไขตำแหน่ง</div>
      </form>
    </div>
  );
}
