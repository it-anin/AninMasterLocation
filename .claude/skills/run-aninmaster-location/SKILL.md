---
name: run-aninmaster-location
description: Run and drive the AninMaster Location web app (Vite + React + Supabase warehouse-location lookup, PDA mode ?android=1 and Desktop mode) in headless Chrome. Start the dev server, log in, type a barcode / SKU / product name or fire the PDA scan event (loc-scan), read the result, take screenshots, smoke-test a change. Use when asked to run, start, screenshot, drive, smoke-test or verify a change in the real app. รันแอป ทดสอบช่องสแกน ถ่ายภาพหน้าจอ
---

AninMaster Location คือเว็บแอป Vite + React + TypeScript ที่ต่อ Supabase ตรง (ไม่มี backend ของตัวเอง)
PDA เปิดด้วย `?android=1` · Desktop เปิดตรงๆ — วิธีขับ: เปิด dev server (`npm run dev`) แล้วใช้
`.claude/skills/run-aninmaster-location/driver.mjs` ซึ่งขับ Chrome จริงผ่าน `playwright-core`
(ล็อกอิน → พิมพ์ / ยิงบาร์โค้ด → อ่านผล → ถ่ายภาพ)

Path ทั้งหมดเทียบกับรากโปรเจกต์ · คำสั่งเป็น bash (Windows ใช้ Git Bash)

> ⚠️ **ไม่มีฐานข้อมูลทดสอบ** — dev server และ driver ต่อ Supabase ตัวจริง (schema `anin_loc`) ที่พนักงานใช้อยู่
> driver ใช้รหัส `1234` (packing = ดูอย่างเดียว ไม่มีปุ่มแก้) เป็นค่าเริ่มต้น · อย่าใช้ `--code 0000` (admin)
> แล้วสั่งกดปุ่มแก้/บันทึก/ลบ · อย่ารัน `npm run import*` เพื่อทดสอบ

## Prerequisites

- Node ≥ 18.3 (driver ใช้ `parseArgs` ของ `node:util`) — ทดสอบจริงกับ v24.12.0 / npm 11.6.2 บน Windows 11 + Git Bash · Linux / macOS ยังไม่ได้ทดสอบ
- Google Chrome หรือ Edge ที่ลงไว้ในเครื่อง — driver ใช้ตัวนั้นเลย ไม่โหลดเบราว์เซอร์เพิ่ม
  (หาไม่เจอให้ตั้ง `CHROME_PATH=<path ของ chrome.exe>`)
- ไฟล์ `.env` ที่รากโปรเจกต์ มี `VITE_SUPABASE_URL` และ `VITE_SUPABASE_ANON_KEY` **ที่ไม่ว่าง**
  (คัดลอกจาก `.env.example` เติมค่าจาก Supabase → Settings → API)

## Setup (ครั้งเดียวหลัง clone)

```bash
npm install                                                   # แอป
npm install --prefix .claude/skills/run-aninmaster-location   # driver (playwright-core ของ skill เอง ไม่ปนกับ package.json ของแอป)
```

## Run (agent path)

**1. เปิด dev server** (ล็อกไปที่ `$TMPDIR` หรือ `/tmp`)

```bash
LOG=${TMPDIR:-/tmp}/aninloc-dev.log
npm run dev -- --port 5173 --strictPort > "$LOG" 2>&1 &
timeout 30 bash -c 'until curl -sf http://localhost:5173 >/dev/null; do sleep 1; done' && echo "dev server UP"
```

**2. ขับด้วย driver** — ล็อกอินให้เอง แล้วทำตาม step ทีละอัน

```bash
D=.claude/skills/run-aninmaster-location/driver.mjs
node $D "type:vitamin c"                      # PDA (480x800): พิมพ์ชื่อสินค้าลงช่อง + Enter
node $D --mode desktop "type:ยาแก้"           # Desktop (1280x800)
node $D "scan:8851467011175"                  # PDA: จำลองเครื่องสแกนยิงบาร์โค้ด (CustomEvent loc-scan)
node $D                                        # ไม่ใส่ step = ล็อกอิน + ถ่ายภาพหน้าแรก (smoke)
node $D --url https://anin-masterlocation.vercel.app "type:vitamin c"   # เว็บจริงบน Vercel (ไม่ต้องเปิด dev server)
node $D --help
```

ผลลัพธ์ของ `type:vitamin c` (ตัดให้สั้น):

```
เข้าระบบแล้ว · pda 480x800 · http://localhost:5173/?android=1 · 👤 Packing
▶ type:vitamin c
  ผล   : แสดง 25 รายการแรก — พิมพ์ชื่อให้ยาวขึ้นเพื่อแคบผลลัพธ์ | 900810 | Ampavit Vitamin B12 Inj. … | J26 | …
  query: 200 v_barcode_lookup barcode=eq.vitamin+c  ·  200 v_barcode_lookup item_id=like.vitamin+c%  ·  200 v_barcode_lookup name=ilike.%vitamin%&name=ilike.%c%
  ภาพ  : C:\Users\…\Temp\aninloc-shots\134556-01-type_vitamin_c.png
```

- **`query:` บอกว่าขั้นไหนตอบ** — แอปค้นตามลำดับ บาร์โค้ด → SKU ขึ้นต้นด้วย → ชื่อสินค้า และหยุดที่ขั้นแรกที่เจอ
  เจอที่บาร์โค้ด = 1 ชุด · ที่ SKU = 2 ชุด · ชื่อ (หรือไม่เจอเลย) = 3 ชุด
- **เปิดภาพดูทุกครั้ง** — หน้าขาว = ล้มเหลว ภาพอยู่ที่ `<tmp>/aninloc-shots/HHMMSS-NN-<step>.png` (เปลี่ยนด้วย `--out <dir>`)
- exit code: `0` ปกติ · `1` มี query ของ Supabase ตอบ ≥ 400 / หน้าเว็บ throw / ล็อกอินไม่ได้ · `2` สั่งผิด หรือยังไม่ติดตั้ง driver
- `เตือน :` คือ console error ที่ไม่ทำให้ fail (ดู Troubleshooting)

| step | ทำอะไร |
|---|---|
| `type:<ข้อความ>` | ล้างช่อง → พิมพ์ → Enter → รอผล → รายงาน |
| `keys:<ข้อความ>` | พิมพ์อย่างเดียว ไม่กด Enter |
| `press:<ปุ่ม>` | กดปุ่ม (เช่น `press:Enter`) → รอผล → รายงาน |
| `scan:<รหัส>` | ส่ง CustomEvent `loc-scan` (เฉพาะ `--mode pda`) |
| `click:<css>` | คลิกตัวเลือก CSS → รอผล → รายงาน |
| `focus` · `blur` | ย้าย focus เข้า/ออกจากช่องค้นหา |
| `wait:<ms>` · `shot:<ชื่อ>` | หน่วงเวลา · ถ่ายภาพเพิ่ม |

options: `--mode` (`pda` หรือ `desktop`) · `--url` · `--code` · `--delay <ms/ตัวอักษร>` · `--out` · `--max <ตัวอักษร>`

**3. ปิด dev server** (หา PID ที่ฟังพอร์ต · แฟล็กของ `taskkill` เขียนแบบ `//PID` `//F` `//T` ซึ่งใช้ได้ใน Git Bash)

```bash
pid=$(netstat -ano | grep -E ':5173 .*LISTENING' | awk '{print $5}' | head -1); taskkill //PID $pid //F //T
```

### สูตรตรวจ regression ที่ใช้ได้เลย

```bash
D=.claude/skills/run-aninmaster-location/driver.mjs

# พิมพ์ชื่อแล้วเว้นจังหวะกลางคำ → ต้องได้ query ชุดเดียว (3 บรรทัด ทุกบรรทัดมี "ascee+vitamin")
# ถ้ามี query ของ "vitamin" เดี่ยวๆ โผล่มาด้วย = Enter ลอยไปถึง keyboard-wedge ของ useScanner (ดู Gotchas)
node $D "keys:ascee" wait:400 "keys: vitamin" press:Enter

# โหมด HID: ช่องไม่ได้ focus แล้วเครื่องสแกนพิมพ์เลขรัวๆ + Enter → wedge ที่ window ต้องยังรับได้ (query 1 ชุด)
node $D blur "keys:8851467011175" press:Enter
```

## Run (human path)

```bash
npm run dev   # → เปิด http://localhost:5173/?android=1 (PDA) หรือ http://localhost:5173/ (Desktop) · ล็อกอิน 1234 / 0000 · Ctrl-C เพื่อหยุด
```

## Test / Build

โปรเจกต์ไม่มี test suite — `npm run build` (= `tsc -b && vite build`) คือการตรวจ type + build ที่มี
ฝั่ง Android (`android/`) ต้องใช้เครื่อง/emulator จริง ดู `CLAUDE.md` หัวข้อ "ทดสอบบนเครื่องจริง"

---

## Gotchas

- **ข้อมูลเปลี่ยนตลอด** (พนักงานแก้ผ่าน Google Sheet) — อย่าเทียบตำแหน่งแบบตายตัว ตารางทดสอบใน `CLAUDE.md` บอกว่า
  `8851467011175` → J61 แต่ตอนทดสอบ (2026-10-01) ได้ J62 (แก้ล่าสุด 24/9) ให้ดูโครงผลลัพธ์แทน: ผังคลังขึ้น · ไฮไลท์ชั้นถูกโซน
- **`scan:` จำลองฝั่งเว็บเท่านั้น** — ยิง `CustomEvent` เหมือนที่ `MainActivity.kt` ทำ ไม่ได้ทดสอบ BroadcastReceiver ฝั่ง Android
  (ต้องใช้เครื่องจริง + `adb shell am broadcast`) ชื่อ event driver อ่านจาก `SCAN_EVENT` ใน `src/lib/useScanner.ts` เอง
- **keyboard-wedge ซ้อนกับช่องกรอก (หน้า PDA)** — `useScanner` ฟัง `keydown` ที่ `window` ถ้าตัวอักษรห่างกัน < 150ms แล้วจบด้วย Enter
  จะส่งสิ่งที่เก็บไว้ไปค้นอีกชุด · `onKeyDown` ของช่องใน `PdaScan.tsx` จึงต้อง `e.stopPropagation()` ตอน Enter
  ไม่งั้นพิมพ์ชื่อแล้วเว้นจังหวะกลางคำ จะค้น 2 ชุดคู่กัน ผลที่ขึ้นเป็นของชุดที่ตอบกลับทีหลัง (สูตร regression ด้านบน)
- **driver ครอบคลุมหน้าค้นหาเท่านั้น** (PDA และแท็บ "ค้นหาตำแหน่ง" บน Desktop) — แท็บของ admin (จัดการข้อมูล / นำเข้าสินค้า)
  เขียนฐานจริง จึงไม่ได้ทำ step ให้

## Troubleshooting

- **`ไม่พบ playwright-core — รัน npm install --prefix …`**: ยังไม่ได้ทำ Setup ข้อ 2 → รันคำสั่งที่ driver พิมพ์บอก
- **`หน้าเว็บ error ตั้งแต่โหลด … supabaseUrl is required`**: `VITE_SUPABASE_URL` ถูกตั้งไว้แต่ **ว่าง**
  (เช่น `.env` มีบรรทัด `VITE_SUPABASE_URL=` ไม่มีค่า) หน้าจึงขาว → เติมค่าแล้วรัน dev server ใหม่
- **`ผิดพลาด: รหัสไม่ถูกต้อง: "…"`**: `--code` ต้องเป็น `1234` (packing) หรือ `0000` (admin) — อยู่ใน `PASSCODES` ของ `src/lib/auth.ts`
- **`เตือน : console.error: Failed to load resource … 404 [http://localhost:5173/favicon.ico]`**: ไม่ใช่บั๊ก —
  `index.html` ไม่ได้ประกาศ favicon เบราว์เซอร์เลยขอ `/favicon.ico` แล้วได้ 404 · ที่ต้องกังวลคือ `ผิดพลาด:` กับ query ที่ตอบ ≥ 400
