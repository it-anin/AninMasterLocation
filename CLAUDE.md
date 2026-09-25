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
   **และห้ามใส่ใน Apps Script ของ Google Sheet** (`sheet/Code.gs` ใช้ anon key เท่านั้น)
   ใครที่เปิด Apps Script ได้จะเห็น key และ key นี้เข้าถึงฐาน POS ใน `public` ได้ด้วย

4. **ห้ามกรองบาร์โค้ด/SKU ด้วยเกณฑ์ความยาวหรือ "ต้องเป็นตัวเลข"**
   มี 410 บาร์โค้ดที่สั้นกว่า 6 ตัวอักษรแต่เป็นสินค้าจริง (รหัส `A001`, `S00126`, `D0037`)
   และ 296 ตัวในนั้นไม่มีบาร์โค้ดอื่นเลย — กรองทิ้งเมื่อไหร่ = สแกนสินค้าพวกนี้ไม่เจอตลอดไป

   เรื่องเดียวกันกับ **SKU**: 6,309 ตัวเป็นเลข 6 หลัก แต่อีก **1,649 ตัวมีตัวอักษรปน**
   ช่องค้นหาจึงรับทุกรูปแบบ ห้ามบังคับให้พิมพ์ได้แต่ตัวเลข

5. **ชื่อ CustomEvent ต้องตรงกัน 2 ที่** — `SCAN_EVENT` ใน `MainActivity.kt`
   และ `SCAN_EVENT` ใน `src/lib/useScanner.ts` ปัจจุบันคือ `loc-scan`
   ถ้าแก้ที่เดียวแล้วลืมอีกที่ สแกนจะไม่มีอะไรเกิดขึ้นเลยโดยไม่มี error

6. **regex แยก โซน/เชลฟ์/ชั้น ต้องตรงกัน 2 ที่** — generated column ใน
   `0004_shelf_slot.sql` และ `parseLocation()` ใน `src/lib/queries.ts`
   ถ้าแก้ไม่พร้อมกัน ผังจะไฮไลท์คนละที่กับที่ฐานข้อมูลเก็บไว้

   ตรวจว่าตรงกันได้ด้วยการรันทั้งสองฝั่งกับค่าจริงใน `Location-WH.csv`
   (414 ค่าไม่ซ้ำ) แล้วเทียบผล — ตอนเขียนครั้งล่าสุดตรงกันทุกค่า
   จุดที่พลาดง่าย: `L1`, `A123` ต้องได้ null **ทั้ง 3 คอลัมน์** ไม่ใช่ได้ zone แต่ aisle เป็น null

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
| `src/**` (React/TS/CSS) | ❌ ไม่ต้อง — push ขึ้น `master` แล้ว Vercel deploy เอง WebView โหลดใหม่ตอนเปิดแอป |
| `android/**` | ✅ ต้อง — native code |
| `sheet/**` | ❌ ไม่ต้อง — แต่ต้องวางโค้ดทับใน Apps Script editor ของชีตเอง (ไม่ deploy อัตโนมัติ) |

### Build APK — ไม่ต้องใช้ Android Studio ก็ได้

Build จริงๆ คือ Gradle ตัวเดียวกันไม่ว่าเรียกจากที่ไหน **ไม่จำเป็นต้องเปิด Android Studio** เพื่อ build APK ธรรมดา:

```bash
cd android
./gradlew assembleDebug
# ได้ไฟล์ที่ android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

**จำเป็นต้องเปิด Android Studio เมื่อ:**
- แก้โค้ด Kotlin ที่ต้องการ autocomplete/IntelliSense (VSCode มี extension แต่ไม่ดีเท่า)
- debug บนเครื่องจริงแบบ breakpoint/Logcat/Layout Inspector
- จัดการ Android SDK / AVD (SDK Manager ในตัว ติดตั้งง่ายกว่าจัดการเอง)
- อ่าน error message ที่ตีความยาก (บาง error กด "Fix with AI" ได้ในตัว)

**ไม่จำเป็นต้องเปิด Android Studio เมื่อ:**
- แค่ต้องการ build APK ไฟล์ใหม่หลังแก้ `MainActivity.kt` เสร็จแล้ว
- ติดตั้ง APK ลงเครื่อง PDA (`adb install -r`)
- เช็คว่าโค้ด compile ผ่านไหม (`./gradlew compileDebugKotlin`)

> ⚠️ **Gradle wrapper ต้องตรงรุ่นกับ Android Gradle Plugin (AGP)** — โปรเจกต์นี้ใช้ AGP 8.2.2
> คู่กับ **Gradle 8.2** (ตั้งไว้ใน `gradle/wrapper/gradle-wrapper.properties`)
> เคย auto-upgrade เป็น Gradle 9.3.0 มาแล้วครั้งหนึ่งและพังทันที ด้วย error
> `Cannot mutate the dependencies of configuration ... after the configuration was resolved`
> (Gradle 9 เข้มงวดเรื่อง configuration resolution กว่า AGP 8.2.2 ที่ออกมาก่อนจะรองรับ)
> ถ้าเจอ error แบบนี้อีก ให้เช็ค `distributionUrl` ใน `gradle-wrapper.properties` ก่อนอย่างอื่น

---

## Deploy (Vercel)

| | ค่า |
|---|---|
| โปรเจกต์ | `anin-masterlocation` ใน team **it-anin's projects** · ต่อ GitHub `it-anin/AninMasterLocation` แล้ว |
| URL | https://anin-masterlocation.vercel.app — ต้องตรงกับ `WEBAPP_URL` ใน `MainActivity.kt` |
| Env (Production) | `VITE_SUPABASE_URL` · `VITE_SUPABASE_ANON_KEY` · `VITE_APP_PASSCODE` · `VITE_LOCATION_SHEET_URL` |

- **push ขึ้น `master` = deploy อัตโนมัติ**
- ตัวแปร `VITE_*` ถูกฝังตอน build — แก้ค่าแล้วต้อง redeploy
  (build ก่อนใส่ env = หน้าขาวเปล่า error `supabaseUrl is required` — เคยเกิดตอนสร้างโปรเจกต์ใหม่)
- **ห้ามใส่ `SUPABASE_SERVICE_KEY` ใน Vercel** — เว็บไม่ได้ใช้ ใช้แค่สคริปต์ import บนเครื่อง
- `VITE_LOCATION_SHEET_URL` มีค่า = โหมด Google Sheet (ปุ่มแก้ตำแหน่งในเว็บหายไป)

> ย้ายจากโปรเจกต์ `aninmasterlocation` (ลบแล้ว) เมื่อ 2026-09-25 — URL เดิม `aninmasterlocation.vercel.app` ใช้ไม่ได้แล้ว
> PDA ที่ยังติดตั้ง APK ตัวเก่าจะเปิดไม่ขึ้น ต้องติดตั้ง APK ใหม่ทุกเครื่อง
> และห้ามปล่อยให้เหลือ APK ตัวเก่า — ชื่อโดเมนเดิมว่างอยู่ ถ้ามีคนอื่นจดไป แอปเก่าจะเปิดเว็บของคนนั้น

**deploy มือด้วย Vercel CLI** (สำรอง ถ้าการต่อ GitHub มีปัญหา) — deploy เฉพาะโค้ดที่ commit แล้ว:
```bash
rm -rf /tmp/aninloc-deploy && mkdir -p /tmp/aninloc-deploy
git archive HEAD | tar -x -C /tmp/aninloc-deploy
cp -r .vercel /tmp/aninloc-deploy/
cd /tmp/aninloc-deploy && vercel deploy --prod --yes
```
**อย่ารัน `vercel --prod` ตรงจากโฟลเดอร์โปรเจกต์** — ไม่แน่ว่า CLI จะข้ามไฟล์ตาม `.gitignore`
อาจอัปโหลด `.env` (มี service key) และไฟล์ CSV ขึ้นไปด้วย
`.vercel/` ได้จาก `vercel link --project anin-masterlocation` (ไม่ขึ้น git)

---

## แก้ตำแหน่งผ่าน Google Sheet

เมื่อตั้ง `VITE_LOCATION_SHEET_URL` แล้ว **Google Sheet คือที่แก้ตำแหน่งที่เดียว**
ปุ่มแก้ตำแหน่งในเว็บและ PDA ถูกซ่อน (ปล่อยค่าว่าง = กลับไปแก้ในเว็บแบบเดิม)

```
แก้ในชีต ─┬─ ทันที (onEditInstallable)  → ส่งแถวที่แก้ ─┐
          └─ ทุก 10 นาที (reconcile)    → ส่งทั้งชีต  ─┴→ anin_loc.sheet_apply() → item_locations
```

**ทางเดียว ชีต → DB** ไม่มีการดึงตำแหน่งจาก DB กลับไปทับชีต
ชีตจึงชนะเสมอ: **ค่าที่แก้ใน DB ตรงๆ หรือจาก `import:locations` จะถูก reconcile เขียนทับกลับ**

การป้องกันที่ต้องรักษาไว้ถ้าแก้ `sheet/Code.gs` (ทุกข้อมาจากปัญหาจริงของสเปรดชีต):
- ตั้ง format ข้อความ (`@`) **ก่อน** เขียนข้อมูล — ไม่งั้น 0 นำหน้าหาย · `3-1` เป็นวันที่
- ช่องตำแหน่งที่ `getValues()` ได้ไม่ใช่ string = ชีตแปลงไปแล้ว → ไม่ส่ง
- เพดาน: แก้ครั้งเดียว ≤ 200 · reconcile ≤ 50 — กันเลือกทั้งคอลัมน์แล้วกด Delete / sort คอลัมน์เดียว
- ลบทั้งแถวในชีต = รายงานอย่างเดียว ไม่ลบใน DB
- ตรวจหัวตารางตรงกับ `HEADERS` ก่อนอ่าน/เขียนทุกครั้ง (`layoutProblem_`) — ไม่ตรง = หยุดซิงก์ทั้งหมด
  กันแทรก/ย้ายคอลัมน์ และวางโค้ดใหม่ทับชีตโครงเก่า (ไม่งั้นหมายเหตุ/หมวดถูกส่งเข้าระบบเป็นตำแหน่ง)
  ย้ายคอลัมน์ = แก้ `COL`/`HEADERS`/`WIDTHS` แล้วสร้างแท็บใหม่ตาม README หัวข้อ "เปลี่ยนโครงคอลัมน์"
- `sheet_apply` คืน jsonb ก้อนเดียว ไม่ใช่ table — PostgREST ตัดผลที่ 1,000 แถว

วิธีติดตั้งและข้อจำกัด → [sheet/README.md](sheet/README.md)

---

## โครงสร้างข้อมูล

**ที่มา:** CSV export จาก ProMaxx — `run-upload-stock/R05.106.CSV` (UTF-8 with BOM)

**ข้อเท็จจริงสำคัญ:** บาร์โค้ด 10,864 ตัวไม่ซ้ำเลย แต่ map ไปยัง item เพียง 7,959 ตัว
เพราะสินค้าตัวเดียวกันมีบาร์โค้ดแยกตามหน่วย (แผง/กล่อง) จึงแยกเป็น 2 ตาราง 1:N

| ตาราง | grain | จำนวนจริง |
|---|---|---|
| `anin_loc.items` | 1 แถวต่อ 1 สินค้า | 7,958 |
| `anin_loc.barcodes` | 1 แถวต่อ 1 บาร์โค้ด | 10,863 |
| `anin_loc.item_locations` | 1 แถวต่อ 1 สินค้า | 6,646 (แยกรหัสได้ 2,819) |
| `anin_loc.location_history` | ประวัติ | เขียนโดย trigger |

**Location ผูกกับ `item_id` ไม่ใช่ barcode** — ยิงบาร์โค้ดไหนของสินค้าตัวเดียวกันก็ได้ตำแหน่งเดียวกัน

> 10,864 − 1 = 10,863 เพราะตัดแถว barcode `'D'` (item 900268 ชื่อสินค้าเสีย ไม่มีบาร์โค้ดอื่น)
> การตัดแถวนั้นทำให้ item หายไป 1 ตัวด้วย: 7,959 − 1 = 7,958

**ตำแหน่งนำเข้าจาก `Location-WH.csv`** ด้วย `npm run import:locations`
CSV มี 10,370 แถว แต่ item_id ไม่ซ้ำแค่ 6,649 (สินค้าเดียวกันซ้ำตามบาร์โค้ด)
เข้า DB ได้ 6,646 — หาย 3 เพราะ item_id ไม่มีใน `items` โดน FK กรอง

---

## รหัสตำแหน่ง — โซน · เชลฟ์ · ชั้น

รหัสจริงในคลังเป็นแบบ `<โซน><เชลฟ์><ชั้น>` เช่น **J61 = โซน J เชลฟ์ 6 ชั้น 1**

```
J 6 1
│ │ └── ชั้น  (slot)  นับจากล่างขึ้นบน 1-7
│ └──── เชลฟ์ (aisle) ตัวชั้นวาง ซ้าย-ขวา 1-6
└────── โซน   (zone)  A-K
```

> ⚠️ `aisle` เป็นชื่อคอลัมน์เดิมตั้งแต่ตอนที่ยังไม่มีชั้น **ความหมายจริงคือ "เชลฟ์"**
> ไม่ได้แปลว่าทางเดิน เปลี่ยนชื่อไม่ได้เพราะผูกกับ DB แล้ว

`location` **ยังเป็นข้อความอิสระ** พนักงานพิมพ์อะไรก็ได้
คอลัมน์ `zone` / `aisle` / `slot` เป็น GENERATED ที่ Postgres แยกให้เอง

| พิมพ์ว่า | แยกได้เป็น | หน้าจอแสดง | จำนวนจริง |
|---|---|---|---|
| `J61`, `A14`, `C32` | โซน + เชลฟ์ + ชั้น | **ผังคลัง + ภาพชั้นวาง** | 2,819 |
| `A-03`, `B 11`, `C_02` | โซน + เชลฟ์ (ไม่มีชั้น) | **ผังคลัง** | 0 |
| `PRE`, `COOL`, `DELETE` | แยกไม่ได้ | **รหัสตัวใหญ่** | 4,421 |
| `L1`, `L2` (เลขหลักเดียว) | แยกไม่ได้ | **รหัสตัวใหญ่** | 267 |
| `กล่อง`, `โหล`, `แผง` | แยกไม่ได้ (เป็นหน่วยนับ) | **รหัสตัวใหญ่** | 17 |

การ fallback ไปแสดงรหัสตัวใหญ่**ไม่ใช่ error** — เป็นพฤติกรรมที่ตั้งใจ

---

## หน้าจอ PDA

ช่องกรอกเดียวรับทั้ง **บาร์โค้ด** และ **SKU** — ระบบเดาเอง
หาบาร์โค้ดก่อน (งานหลัก ต้องเร็ว) ไม่เจอค่อยหา SKU แบบขึ้นต้นด้วย
เจอ SKU ตัวเดียว → เข้าหน้าผลลัพธ์เลย · เจอหลายตัว → แสดงรายการให้เลือก

แยกด้วยรูปแบบไม่ได้ เพราะ SKU 6 หลัก กับบาร์โค้ดสั้นๆ หน้าตาเหมือนกัน
(บางค่าเป็นทั้งสองอย่าง เช่น `900157` — ไม่มีปัญหาเพราะชี้ไปสินค้าตัวเดียวกัน)

**PDA ดูตำแหน่งอย่างเดียว ไม่มีปุ่มแก้ไข** — พนักงานหน้างานไม่มีสิทธิ์แก้ตำแหน่ง
แก้ได้ที่หน้าจัดการบน desktop หรือ Google Sheet เท่านั้น (`PdaScan` ไม่ส่ง `onEdit` ให้ `LocationResult`)
⚠️ เป็นการซ่อนที่หน้าจอเท่านั้น — anon key ยังเขียน DB ได้ (ดูหัวข้อความปลอดภัย)

**โหมด PDA บังคับธีมสว่างเสมอ** ไม่ตามการตั้งค่าเครื่อง — คลังแสงจ้า จอมืดอ่านไม่ออก
(`forceLightOnPda()` ใน `useScanner.ts` ตั้งก่อน React render แรก กันจอกะพริบ)

### ผลลัพธ์แสดง 2 ขั้น

**ขั้น 1 · ผังคลัง** ([WarehouseFloorPlan.tsx](src/components/WarehouseFloorPlan.tsx))
วาด **เส้นทางเดินจากประตู + ไอคอนคนเดินตามเส้น** ไปยังโซน แล้วป้ายโซนเด้งขึ้น

> ⚠️ เคยใช้วิธี "เจาะกรอบครอบตัวชั้นวาง" แล้วไม่เคยพอดีสักที
> เพราะชั้นวางในภาพเป็น perspective **ขอบบน-ล่างเอียงไม่เท่ากันทุกโซน**
> (A เอียง 77px · K เอียงกลับทาง 73px) — อย่าย้อนกลับไปทำแบบนั้นอีก
> วิธีปัจจุบันรู้แค่ขอบซ้าย-ขวา (`ZONE_X`) ซึ่งวัดแม่น จึงไม่มีปัญหา

**ขั้น 2 · ภาพชั้นวางมองจากด้านหน้า** ([ShelfFront.tsx](src/components/ShelfFront.tsx))
ไฮไลท์เชลฟ์/ชั้นที่ของอยู่ บนภาพถ่ายชั้นวางจริง

### ⚠️ กฎการอ่านผังที่ไม่ตรงไปตรงมา

| เรื่อง | รายละเอียด |
|---|---|
| **โซน B, D, F, H, J นับเชลฟ์จากขวา** | ชั้นวางอยู่อีกฝั่งทางเดิน เชลฟ์ 1 = ขวาสุด (`MIRRORED_ZONES`) |
| **โซน A ใช้ชั้นวาง 2 ขนาด** | เชลฟ์ 1-2 = ชั้นเตี้ย (`rack-zone-a.png`) · เชลฟ์ 3-4 = ชั้นสูง (`rack-front.png`) |
| **ชั้นที่เกินจำนวนช่องในภาพ** | วาดเป็น "แถบเหนือชั้นวาง" แทน (ภาพหลักมี 6 ช่อง แต่โซนใช้ถึงชั้น 7) |

จำนวนเชลฟ์/ชั้นจริงต่อโซนอยู่ใน `ZONE_LAYOUT` — นับจากรหัสที่ใช้จริงใน CSV ไม่ได้กะเอา

รายละเอียดคำศัพท์ทั้งหมด → [docs/คำศัพท์.md](docs/คำศัพท์.md)

### พิกัดในภาพวัดจากพิกเซลจริง

ทุกค่าใน `WarehouseFloorPlan.tsx` และ `ShelfFront.tsx` ได้จากการไล่พิกเซล
ไม่ได้กะด้วยตา **เปลี่ยนภาพใหม่ต้องวัดใหม่ทั้งหมด** — วิธีวัดอยู่ใน `mockups/README.md`

จุดที่พลาดง่าย: ขอบชั้นต้องใช้ **ช่องว่างระหว่างแผ่นไม้** ไม่ใช่กึ่งกลางแผ่น
ไม่งั้นกรอบชั้นบนสุดจะลอยเหนือหลังคาชั้นวาง

---

## การติดตั้งครั้งแรก

```bash
npm install
cp .env.example .env        # แล้วเติมค่าจาก Supabase Dashboard → Settings → API
```

**บน Supabase — รันตามลำดับใน SQL Editor:**

| ไฟล์ | ทำอะไร |
|---|---|
| `0001_schema.sql` | สร้างตาราง + view |
| `0002_rls.sql` | เปิด RLS + grant ให้ `anon` |
| `0003_service_role_grants.sql` | grant ให้ `service_role` (สคริปต์ import ใช้) |
| `0004_shelf_slot.sql` | แยก เชลฟ์/ชั้น — นิยาม `zone`/`aisle`/`slot` ใหม่ |
| `0005_search_by_zone.sql` | กรองรายการตามโซนในหน้าจัดการ |
| `0006_sheet_sync.sql` | `sheet_apply()` สำหรับ Google Sheet + ประวัติบันทึก `source = 'sheet'` |
| `0007_deleted_items.sql` | `delete_item()` + ตาราง `deleted_items` — สินค้าที่ลบแล้ว import ไม่เพิ่มกลับ |

จากนั้น **Settings → API → Exposed schemas → เพิ่ม `anin_loc`** ← ลืมบ่อยที่สุด
ถ้าไม่ทำจะเจอ `The schema must be one of the following: public`

> ⚠️ `0004` ต้อง **drop view ก่อน drop column** (Postgres error 2BP01) และต้อง
> **grant สิทธิ์คืนหลังสร้าง view ใหม่** เพราะ `DROP VIEW` ลบ grant ทิ้งไปด้วย
> ลืมข้อหลัง = หน้าสแกนพังทันทีด้วย `permission denied for view`

**นำเข้าข้อมูล:**
```bash
npm run import:dry              # ตรวจ catalog ก่อน ไม่เขียน DB
npm run import                  # items + barcodes
npm run import:locations:dry    # ตรวจไฟล์ตำแหน่ง
npm run import:locations        # เขียน item_locations
```

**นำเข้า catalog จากคอมเครื่องไหนก็ได้:** เว็บ (desktop) → แท็บ **นำเข้าสินค้า** → เลือก `R05.106.CSV`
ทำงานเหมือน `npm run import` ทุกอย่าง แต่ใช้ anon key ของเว็บ ไม่ต้องมี Node / `.env` / service key บนเครื่อง
แสดงสรุปแบบ `import:dry` ก่อนกดยืนยัน · ปฏิเสธไฟล์ที่ผ่าน Excel มาแล้ว (0 นำหน้าหาย / `8.85E+12`) และไฟล์ที่ไม่ใช่ UTF-8
⚠️ **กฎการอ่าน R05.106 อยู่ 2 ที่ ต้องตรงกัน** — `buildRecords()` ใน `scripts/import-catalog.mjs`
และ `prepareCatalog()` ใน `src/lib/catalogImport.ts` (ตรวจ: ตัวเลขหน้าสรุปในเว็บต้องเท่ากับ `npm run import:dry`)

`import` รันซ้ำได้ปลอดภัย — แตะแค่ `items`/`barcodes` ไม่แตะ `item_locations`
แต่ **`import:locations` เขียนทับ** ถ้ารันหลังพนักงานเริ่มแก้ตำแหน่งในเว็บแล้ว
ค่าที่แก้จะถูกเขียนทับด้วยค่าจากไฟล์ — ใช้ seed ชุดแรกเท่านั้น
**หลังเปิดใช้ Google Sheet แล้วห้ามรันอีก** — reconcile จะเขียนค่าจากชีตทับกลับ

หลัง `npm run import` มีสินค้าใหม่ → ในชีตกดเมนู **📦 ตำแหน่ง → อัปเดตจากระบบ**
ไม่งั้นสินค้าใหม่ไม่มีแถวให้กรอกตำแหน่ง

**สินค้าที่กด "ลบสินค้า" ในหน้าจัดการ `import` จะข้ามไป** แม้ยังอยู่ใน `R05.106.CSV`
ปุ่มลบเรียก `anin_loc.delete_item()` ซึ่งจดรหัสลง `anin_loc.deleted_items` แล้ว `import` ข้ามรหัสในตารางนั้น
**ห้ามลบ `items` ตรงด้วย `.delete()`** — ไม่ได้จดรหัส สินค้าจะกลับมาตอน import รอบหน้า
`import` อ่าน `deleted_items` ไม่ได้ (เช่น ยังไม่รัน `0007`) = หยุดทันที ไม่ import ต่อ
เอาสินค้ากลับ: `delete from anin_loc.deleted_items where item_id = '...'` แล้ว `npm run import`
(กลับมาแค่ชื่อ/บาร์โค้ด ตำแหน่งเดิมหายไปแล้ว)

---

## คำสั่ง

```bash
npm run dev                   # dev server — ?android=1 เพื่อดูโหมด PDA
npm run build                 # type-check + build
npm run import                # นำเข้า catalog (items + barcodes)
npm run import:dry            # ตรวจ catalog อย่างเดียว
npm run import:locations      # นำเข้าตำแหน่ง
npm run import:locations:dry  # ตรวจไฟล์ตำแหน่งอย่างเดียว
```

---

## การทดสอบ

**บนเบราว์เซอร์ (ไม่ต้องมีเครื่อง PDA):**
- เปิด `?android=1` แล้ว DevTools → device toolbar → 480×800
- พิมพ์บาร์โค้ดในช่องแล้วกด Enter (จำลอง keyboard-wedge)
- หรือใน Console: `window.dispatchEvent(new CustomEvent('loc-scan',{detail:'8851467011175'}))`

**ค่าทดสอบที่ครอบคลุมกรณีสำคัญ:**

| ยิง/พิมพ์ | ควรได้ | ทดสอบอะไร |
|---|---|---|
| `90015710` แล้ว `8851881102251` | ตำแหน่งเดียวกัน (item 900157 → J11) | multi-UOM |
| `8851467011175` | J61 — โซน J เชลฟ์ 6 ชั้น 1 | บาร์โค้ดปกติ |
| `1000` | รายการ SKU ให้เลือก | ค้น SKU แบบขึ้นต้นด้วย |
| `S00126` | เข้าผลลัพธ์เลย (loc = `OFF`) | SKU มีตัวอักษร + fallback |
| `A11` / `A14` | โซน A ชั้นเตี้ย ซ้าย/แถบบน | ชั้นวางคนละขนาด |
| `B12` เทียบ `C12` | อยู่คนละฝั่งของภาพ | โซนกลับด้าน |

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

**Google Sheet:** ใครมีสิทธิ์ Editor ในชีต = แก้ตำแหน่งในระบบได้ — คุมสิทธิ์ที่ปุ่ม Share ของชีต
ชื่อคนแก้ได้เป็นอีเมลจริงเฉพาะบัญชี Google Workspace โดเมนเดียวกัน ไม่งั้นบันทึกเป็น `google-sheet`

---

## โครงสร้างไฟล์

```
src/
  App.tsx                    แถบหัวจอ (โลโก้ + ชื่อ + ปุ่มออก) · สลับ PDA/Desktop
  screens/
    PdaScan.tsx              หน้าสแกน — ช่องเดียวรับทั้งบาร์โค้ดและ SKU
    ProductTable.tsx         หน้าจัดการบน Desktop
    CatalogImport.tsx        แท็บนำเข้าสินค้า (R05.106.CSV) — โหลดเมื่อเปิดแท็บเท่านั้น
    Login.tsx                login รหัสร่วม
  components/
    WarehouseFloorPlan.tsx   ผังคลัง + เส้นทางเดิน + คนเดิน  ← ขั้น 1
    FloorPlanZoomDialog.tsx  ภาพผังขยายเต็มจอ (แตะที่ไหนก็ปิด)
    ShelfFront.tsx           ภาพชั้นวางมองจากด้านหน้า        ← ขั้น 2
    WarehouseMap.tsx         ตารางย่อ (ใช้กับโซนที่ไม่มีในภาพ)
    WarehouseMiniMap.tsx     ผังย่อ (โซนนอกห้องหลัก L, M, N, O)
    EditLocationDialog.tsx   แก้ไขตำแหน่ง
  lib/
    queries.ts               query ทั้งหมด + parseLocation()
    catalogImport.ts         อ่าน/ตรวจ R05.106.CSV + upsert — กฎต้องตรงกับ scripts/import-catalog.mjs
    useScanner.ts            รับ scan event + บังคับธีมสว่างบน PDA
    auth.ts / supabase.ts
  assets/
    warehouse-wh.jpg         ผังคลังมองจากบน 1280×417
    rack-front.png           ชั้นวางหลัก 850×395 (6 ชั้น 6 ช่อง)
    rack-zone-a.png          ชั้นเตี้ยโซน A 770×395 (2 ช่อง)
    anin-logo.png            โลโก้ 200×63

sheet/                       Google Sheet — ที่แก้ตำแหน่งที่เดียว (วางโค้ดใน Apps Script เอง)
  Code.gs                    ซิงก์ชีต → DB ผ่าน sheet_apply() + เพดานความปลอดภัย
  README.md                  วิธีติดตั้ง · ความหมายสถานะ · ข้อจำกัด

docs/คำศัพท์.md              คำศัพท์ที่ใช้ร่วมกัน — อ่านก่อนคุยเรื่องผัง
mockups/                     แบบหน้าจอที่ทำไว้เทียบ (ไม่ได้ใช้ใน production)
  zone/ zone-anim/ zone-anim2/   30 แบบการไฮไลท์โซน
```

---

## อ้างอิง

- [docs/คำศัพท์.md](docs/คำศัพท์.md) — โซน/เชลฟ์/ชั้น คืออะไร · กฎที่ไม่ตรงไปตรงมา
- `mockups/README.md` — วิธีวัดพิกัดเมื่อเปลี่ยนภาพชั้นวาง
- `WH-Branch/docs/pda-architecture.md` — เอกสารต้นแบบ pattern PDA พร้อมกับดักทั้งหมด
- `WH-Branch/android/` — ต้นฉบับ WebView shell ที่ fork มา
- `run-upload-stock/upload-customer-history.mjs` — ต้นแบบสคริปต์ import
