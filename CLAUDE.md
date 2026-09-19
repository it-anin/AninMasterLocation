# AninMaster Location

ระบบค้นหาตำแหน่งจัดเก็บสินค้าในคลัง — พนักงานสแกนบาร์โค้ดที่กล่องด้วยเครื่อง PDA
แล้วเห็นตำแหน่งจัดเก็บทันที พร้อมหน้าจัดการข้อมูลบนเบราว์เซอร์

---

## กฎเหล็ก (ห้ามฝ่าฝืน)

1. **ห้ามสร้าง/แก้ตารางใน schema `public` ของ Supabase เด็ดขาด**
   `public` คือฐานข้อมูล POS ตัวจริงที่ใช้งานอยู่ (products, product_master, customer_history,
   dl_medicines, ss_orders, app_page_settings) โปรเจกต์นี้อยู่ใน schema `anin_loc` เท่านั้น
   ทุก SQL ต้อง qualify ด้วย `anin_loc.` และ client ต้องตั้ง `db: { schema: 'anin_loc' }`
   **ห้ามใช้ migration tool ที่ generate DDL ให้อัตโนมัติ** (drizzle-kit, prisma migrate)
   เพราะอาจ generate `DROP TABLE` ใส่ตาราง POS — รัน SQL มือผ่าน Supabase SQL Editor เท่านั้น

2. **ห้าม commit `.env`, ไฟล์ CSV, หรือ APK** — มีใน `.gitignore` แล้ว

3. **`SUPABASE_SERVICE_KEY` ห้ามขึ้นต้นด้วย `VITE_`** เพราะ Vite จะฝังลง bundle
   ให้ทุกคนที่เปิดเว็บเห็น key ที่ข้ามผ่าน RLS ได้ทั้งหมด

4. **ห้ามกรองบาร์โค้ดด้วยเกณฑ์ความยาว** ใน `scripts/import-catalog.mjs`
   มี 410 บาร์โค้ดที่สั้นกว่า 6 ตัวอักษรแต่เป็นสินค้าจริง (รหัส `A001`, `S00126`, `D0037`)
   และ 296 ตัวในนั้นไม่มีบาร์โค้ดอื่นเลย — กรองทิ้งเมื่อไหร่ = สแกนสินค้าพวกนี้ไม่เจอตลอดไป

5. **ชื่อ CustomEvent ต้องตรงกัน 2 ที่** — `SCAN_EVENT` ใน `MainActivity.kt`
   และ `SCAN_EVENT` ใน `src/lib/useScanner.ts` ปัจจุบันคือ `loc-scan`
   ถ้าแก้ที่เดียวแล้วลืมอีกที่ สแกนจะไม่มีอะไรเกิดขึ้นเลยโดยไม่มี error

6. **regex แยกโซน/ชั้น ต้องตรงกัน 2 ที่** — generated column ใน `0001_schema.sql`
   และ `parseLocation()` ใน `src/lib/queries.ts` ปัจจุบันคือ `^\s*([A-Za-z]+)\s*[-_ ]?\s*(\d+)`
   ถ้าแก้ไม่พร้อมกัน ผังจะไฮไลท์คนละช่องกับที่ฐานข้อมูลเก็บไว้

---

## สถาปัตยกรรม

**Native WebView Shell + เว็บแอปตัวเดียวกับ Desktop** (ยกแบบมาจากโปรเจกต์ WH-Branch)

```
เครื่อง PDA (KTE iTCAN IT68)
   └─ ยิงบาร์โค้ด → broadcast intent "com.kte.scan.result" extra "code"
        └─ MainActivity.kt (BroadcastReceiver)
             └─ escape string → evaluateJavascript
                  └─ CustomEvent 'loc-scan' เข้า WebView
                       └─ เว็บแอปบน Vercel (?android=1) → query Supabase
```

แอป Android เป็น WebView เปล่าที่โหลดเว็บตัวเดียวกับที่ desktop ใช้
ต่างกันแค่ query param `?android=1` ที่บอกให้สลับ layout

| แก้ไฟล์ | ต้อง build APK ใหม่? |
|---|---|
| `src/**` (React/TS/CSS) | ❌ ไม่ต้อง — Vercel auto-deploy แล้ว WebView โหลดใหม่ตอนเปิดแอป |
| `android/**` | ✅ ต้อง — native code |

---

## โครงสร้างข้อมูล

**ที่มา:** CSV export จาก ProMaxx — `run-upload-stock/R05.106.CSV` (UTF-8 with BOM)

**ข้อเท็จจริงสำคัญ:** บาร์โค้ด 10,864 ตัวไม่ซ้ำเลย แต่ map ไปยัง item เพียง 7,959 ตัว
เพราะสินค้าตัวเดียวกันมีบาร์โค้ดแยกตามหน่วย (แผง/กล่อง) จึงแยกเป็น 2 ตาราง 1:N

| ตาราง | grain | จำนวนจริง |
|---|---|---|
| `anin_loc.items` | 1 แถวต่อ 1 สินค้า | 7,958 |
| `anin_loc.barcodes` | 1 แถวต่อ 1 บาร์โค้ด | 10,863 |
| `anin_loc.item_locations` | 1 แถวต่อ 1 สินค้า | เริ่มจาก 0 — ต้องกรอกเอง |
| `anin_loc.location_history` | ประวัติ | เขียนโดย trigger |

**Location ผูกกับ `item_id` ไม่ใช่ barcode** — ยิงบาร์โค้ดไหนของสินค้าตัวเดียวกันก็ได้ตำแหน่งเดียวกัน

---

## หน้าจอ PDA — แผนผังคลัง

หน้าสแกนแสดงผลเป็น**แผนผัง** (แถว = โซน · ช่อง = ชั้น) ไฮไลท์ช่องที่สินค้าอยู่
แทนที่จะโชว์แค่ตัวเลข เพื่อให้พนักงานใหม่ไม่ต้องจำว่า A-03 อยู่แถวไหนของคลัง

**ผังสร้างจากข้อมูลจริง ไม่ต้องตั้งค่าล่วงหน้า** — view `v_warehouse_map` รวมโซน/ชั้น
จากตำแหน่งที่กรอกเข้ามาแล้วทั้งหมด ยิ่งกรอกมากผังยิ่งสมบูรณ์ขึ้นเอง

`location` **ยังเป็นข้อความอิสระเหมือนเดิม** พนักงานพิมพ์อะไรก็ได้
คอลัมน์ `zone` / `aisle` เป็น GENERATED ที่ Postgres แยกให้เอง ไม่ต้องกรอกเพิ่ม

| พิมพ์ว่า | แยกได้เป็น | หน้าจอแสดง |
|---|---|---|
| `A-03`, `A03`, `a-3`, `B 11`, `C_02`, `AA-12` | โซน + ชั้น | **แผนผัง** |
| `A-03-2` | โซน A ชั้น 3 (เอา 2 ระดับแรก) | **แผนผัง** (ช่องไฮไลท์โชว์รหัสเต็ม) |
| `ตู้เย็น`, `หน้าร้าน`, `ชั้น 3` | แยกไม่ได้ | **รหัสตัวใหญ่** แทนผัง |

การ fallback ไปแสดงรหัสตัวใหญ่**ไม่ใช่ error** — เป็นพฤติกรรมที่ตั้งใจ
ระบบจะ fallback ด้วยเมื่อทั้งคลังมีอยู่ตำแหน่งเดียว เพราะตารางช่องเดียวไม่มีประโยชน์

> 10,864 − 1 = 10,863 เพราะตัดแถว barcode `'D'` (item 900268 ชื่อสินค้าเสีย ไม่มีบาร์โค้ดอื่น)
> การตัดแถวนั้นทำให้ item หายไป 1 ตัวด้วย: 7,959 − 1 = 7,958

---

## การติดตั้งครั้งแรก

```bash
npm install
cp .env.example .env        # แล้วเติมค่าจาก Supabase Dashboard → Settings → API
```

**บน Supabase:**
1. SQL Editor → รัน `supabase/migrations/0001_schema.sql`
2. SQL Editor → รัน `supabase/migrations/0002_rls.sql`
3. **Settings → API → Exposed schemas → เพิ่ม `anin_loc`** ← ลืมบ่อยที่สุด
   ถ้าไม่ทำจะเจอ `The schema must be one of the following: public`

**นำเข้าข้อมูล:**
```bash
npm run import:dry     # ตรวจไฟล์ก่อน ไม่เขียน DB
npm run import         # เขียนจริง
```

รันซ้ำได้ปลอดภัย — สคริปต์แตะแค่ `items` และ `barcodes` ไม่แตะ `item_locations`
ดังนั้นตำแหน่งที่กรอกไว้แล้วไม่หายเมื่อ ERP ส่งไฟล์ใหม่มา

---

## คำสั่ง

```bash
npm run dev          # dev server — เปิด http://localhost:5173/?android=1 เพื่อดูโหมด PDA
npm run build        # type-check + build
npm run import       # นำเข้า CSV
npm run import:dry   # ตรวจ CSV อย่างเดียว
```

---

## การทดสอบ

**บนเบราว์เซอร์ (ไม่ต้องมีเครื่อง PDA):**
- เปิด `?android=1` แล้ว DevTools → device toolbar → 480×800
- พิมพ์บาร์โค้ดในช่องแล้วกด Enter (จำลอง keyboard-wedge)
- หรือใน Console: `window.dispatchEvent(new CustomEvent('loc-scan',{detail:'8851467011175'}))`
- ทดสอบ multi-UOM: ยิง `90015710` แล้ว `8851881102251` → ต้องได้ตำแหน่งเดียวกัน (item 900157)

**บนเครื่องจริง:**
```bash
adb logcat -c && adb logcat | grep -i "AninLoc\|kte\|scan"
adb shell am broadcast -a com.kte.scan.result --es code 8851467011175 --es code_src EAN13
```
debug ฝั่งเว็บ: Chrome บน PC → `chrome://inspect` → เลือก WebView ของ `co.anin.loc`

| อาการ | สาเหตุ |
|---|---|
| logcat ไม่มี log ตอนยิง | เครื่องตั้งโหมด HID ไม่ใช่ Broadcast → แก้ที่ Scanner Settings ของเครื่อง |
| logcat มี broadcast แต่แอปเงียบ | ลืม `RECEIVER_EXPORTED` (Android 13+) — ไม่มี error ให้เห็น |
| แอปรับได้แต่จอไม่ขึ้น | ชื่อ CustomEvent ไม่ตรงกัน 2 ฝั่ง |
| ขึ้น "ไม่พบสินค้า" ทั้งที่มี | firmware ต่อ `\r\n` ท้ายมา → `trimEnd` ใน MainActivity จัดการแล้ว |
| `am broadcast` ได้ผล แต่ยิงจริงไม่ได้ | ปัญหาที่การตั้งค่าเครื่อง ไม่ใช่โค้ด |

---

## ความปลอดภัย

ระบบใช้ login แบบ **รหัสร่วม** ตรวจฝั่ง client เท่านั้น ไม่มี identity รายคนระดับฐานข้อมูล
RLS เปิดอยู่แต่ policy อนุญาต `anon` ทำได้ทุกอย่าง

**ความเสี่ยงที่ยอมรับ:** ใครที่รู้ URL + anon key เข้าถึงข้อมูลได้โดยตรงแม้ไม่รู้รหัสหน้าเว็บ
ยอมรับได้เพราะเป็นข้อมูลตำแหน่งสินค้าภายในคลัง ไม่ใช่ข้อมูลส่วนบุคคล

ชื่อผู้ใช้ที่กรอกตอน login ถูกบันทึกใน `location_history.changed_by` เพื่อให้สาวกลับได้ว่าใครย้ายของ
แต่เป็นการกรอกเอง ไม่ได้ยืนยันตัวตนจริง

ถ้าภายหลังต้องการความเข้มงวดขึ้น → ย้ายไป Supabase Auth แล้วเปลี่ยน `to anon`
เป็น `to authenticated` ใน `0002_rls.sql`

---

## อ้างอิง

- `WH-Branch/docs/pda-architecture.md` — เอกสารต้นแบบ pattern PDA พร้อมกับดักทั้งหมด
- `WH-Branch/android/` — ต้นฉบับ WebView shell ที่ fork มา
- `run-upload-stock/upload-customer-history.mjs` — ต้นแบบสคริปต์ import
