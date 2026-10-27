# Thai AI Proofreader

ปลั๊กอินพิสูจน์อักษรภาษาไทยและอังกฤษสำหรับ **Adobe InDesign** ตรวจคำผิดในเอกสาร แล้วกดไปยังจุดที่ผิดหรือแก้ได้ทันทีจากแผงของปลั๊กอิน
A Thai and English proofreading plugin for **Adobe InDesign**. Detect errors in your document, navigate directly to problem spots, or apply instant fixes right from the panel.

[![Get it on Adobe Exchange](https://img.shields.io/badge/Adobe%20Exchange-Download%20Plugin-red?style=for-the-badge&logo=adobe)](https://adobe.com/go/cc_plugins_discover_plugin?pluginId=a0699c84&workflow=share)

---

## English

Choose between two proofreading engines:

| Engine | Supported Languages | Key Highlights | Requirements |
|---|---|---|---|
| **PyThaiNLP** | `[TH/EN]` Thai & English | Offline, fast, private (data stays on your machine) | Run `spellcheck_server.py` via Python |
| **AI Engine** | `[TH/EN]` Thai & English | Highly context-aware, catches mixed-language errors | Local AI (LM Studio / Ollama) or Cloud API |

> The plugin performs **proofreading only**: it pinpoints spelling mistakes and typos without altering writing style or rewriting text.

### Features

- **Flexible Scope**: Check **Selection** (frame / text / table), **Current Page**, or **Entire Document**.
- **Card-Based Results**: Displays issue type, original word → suggested correction, reason, and **page number** ordered chronologically.
- **Go to**: Selects the word in InDesign and scrolls directly to that page (click again to navigate duplicate occurrences).
- **Fix**: Applies the correction immediately inside the document.
- **Done**: Hides the card. **Ignore**: Remembers the word and bypasses future alerts.
- **Clear All Results**: Resets all current issues and prepares for a fresh check.
- **Clear Ignored Words**: Resets the list of ignored terms.
- Progress bar, token/speed analytics, and an interactive activity log.
- Follows InDesign's UI theme (Dark / Light).

#### Issue Categories

| Tag | Source |
|---|---|
| **Rule** | Built-in automated rules (fast & precise) |
| **Spelling** | PyThaiNLP / pyspellchecker local service |
| **AI** | Selected AI Model |

#### Automated Rules Checked

- Repeated vowels/tone marks, double `เ` (likely intended as `แ`).
- Misplaced stacked vowels/tone marks, floating vowels without a leading consonant.
- Nikhahit + sara aa (should be sara am `ำ`).
- Latin/English characters inserted inside Thai words.
- Unexpected and invisible characters (displayed as `U+XXXX` hex codes).
- Excessive repeated consonants, duplicate consecutive English words.
- Spacing rules for repetition marks (`ๆ`) and double spaces (toggleable under "Check rules").

---

### Installation

1. Get and install **Thai AI Proofreader** directly from the [Adobe Exchange Marketplace](https://adobe.com/go/cc_plugins_discover_plugin?pluginId=a0699c84&workflow=share).
2. Launch (or restart) InDesign, then open **Thai AI Proofreader** from the InDesign Plugins menu.
3. Select your primary proofreading engine and configure settings as detailed below.
---

### How to Use

1. Choose your **Main Checker** (PyThaiNLP or AI Engine).
2. Configure **Check Rules** and **Check Scope**.
3. Click **Check** (you can click **Stop** at any time during execution).
4. Process each issue card: **Go to** / **Fix** / **Done** / **Ignore**.
5. Run a new check or click **Clear all results** to wipe past output.

> If text inside InDesign is edited manually after a check, card positions may offset. The plugin will display "The text in the document has changed" and request a new check.

---

### PyThaiNLP Mode

1. Install Python v3.13 or later (download from python.org).
2. Install required packages (one-time setup):

   ```bash
   pip install pythainlp pyspellchecker
   ```

3. Save `spellcheck_server.py` to any directory on your system and launch the service via Terminal/PowerShell (keep the terminal window running during use):

   ```bash
   python "C:\{your save path}\spellcheck_server.py"
   ```

   *Alternatively, click **Save spellcheck_server.py**, then click **Save Spellcheck Launcher** in the same folder. Double-click the launcher script to start the server automatically without opening a command prompt manually.*

4. When `spellcheck service on http://127.0.0.1:8765` appears, the server is ready.
5. In the plugin panel, click **Test** next to the Service URL.

You can change the port using your own desired number by `spellcheck_server.py --port XXXX` and update the plugin URL to match.

---

### AI Engine Mode

#### Supported Providers
LM Studio, Ollama (Local) · OpenAI (ChatGPT) · Anthropic (Claude) · Google Gemini · OpenRouter · Groq · Mistral · DeepSeek · xAI (Grok) · Together AI · Other (OpenAI-compatible) and more

#### Connection Setup
1. Open the **AI Model** section and click **Settings** next to "Profile".
2. Select your **Provider** to auto-fill default Base URLs and recommended configurations.
3. Input your **API key** (for Cloud services) and select or type your desired model name.
4. Click **Save**, **Test Connection**, and **Test Model**.
5. Create multiple profiles via **Add new profile** (remove via **Delete profile**).

#### Parameters

| Setting | Description |
|---|---|
| MAX TOKENS | Maximum completion tokens per request. |
| TEMP | Temperature setting (lower values recommended for proofreading). |
| THINKING / REASONING | Off / Low / Medium / High / Model Default (proofreading does not require deep reasoning; Off/Low yields faster responses). |
| BUDGET | Extended thinking budget (Claude only). |
| TIMEOUT / RETRY | Wait limit and retry attempts for temporary network hiccups. |
| PARALLEL | Concurrent requests executed in parallel. |
| CHUNK | Character count split per request batch. |
| Use `/api/v0` endpoint | LM Studio specific: view real tokens/sec and Time-To-First-Token (TTFT). |

---

## ภาษาไทย (Thai)

เลือกเครื่องมือตรวจได้ 2 แบบ:

| เครื่องมือ | ขอบเขตภาษา | จุดเด่น | สิ่งที่ต้องมี |
|---|---|---|---|
| **PyThaiNLP** | `[TH/EN]` ไทย และ อังกฤษ | ออฟไลน์ เร็ว ข้อความไม่ออกจากเครื่อง | รันบริการ `spellcheck_server.py` ด้วย Python |
| **AI Engine** | `[TH/EN]` ไทย และ อังกฤษ | ตรวจตามบริบทได้แม่นยำ จับคำแทรกสองภาษาได้ | Local AI (LM Studio / Ollama) หรือ Cloud API |

> ปลั๊กอินทำหน้าที่ **พิสูจน์อักษรเท่านั้น** ชี้เฉพาะจุดที่สะกดผิดหรือพิมพ์ผิด ไม่ปรับสำนวนและไม่เรียบเรียงใหม่

### ฟีเจอร์

- เลือกขอบเขตการตรวจ: **ตามที่เลือก** (กรอบ / ข้อความ / ตาราง), **ทั้งหน้าปัจจุบัน** หรือ **ทั้งเอกสาร**
- ผลการตรวจเป็นการ์ด แสดงประเภท, คำผิด → คำที่แนะนำ, เหตุผล และ **เลขหน้า** เรียงตามหน้าในเอกสาร
- **ไปที่จุดนี้**: เลือกคำใน InDesign และเลื่อนไปหน้านั้น (ถ้าคำซ้ำหลายจุด กดซ้ำเพื่อไปจุดถัดไป)
- **แก้เลย**: แก้ข้อความในเอกสารทันที
- **แก้แล้ว**: ซ่อนการ์ดนั้น, **ละเว้น**: จดจำคำนั้นไว้ ไม่แจ้งอีก
- **ล้างการตรวจทั้งหมด**: รีเซ็ตผลที่เจอทั้งหมด พร้อมรอตรวจรอบใหม่
- **ล้างรายการคำที่ละเว้น**: เคลียร์คำที่เคยกดละเว้นไว้
- แถบ progress, สถิติ token / ความเร็ว และบันทึกการทำงาน
- ธีมสีตาม InDesign (Dark / Light)

#### ประเภทของผลการตรวจ

| ป้าย | ที่มา |
|---|---|
| **กฎ** | กฎอัตโนมัติในปลั๊กอิน (ตรวจได้เร็วและแม่น) |
| **สะกด** | บริการ PyThaiNLP / pyspellchecker |
| **AI** | โมเดล AI |

#### กฎอัตโนมัติที่ตรวจ

- สระ / วรรณยุกต์ซ้ำติดกัน, `เ` สองตัว (น่าจะเป็น `แ`)
- สระ / วรรณยุกต์ซ้อนกันผิดตำแหน่ง, สระลอยไม่มีพยัญชนะนำ
- นิคหิต + สระอา (ควรเป็นสระอำ)
- ตัวอักษรอังกฤษแทรกกลางคำไทย
- อักขระแปลกปลอมและอักขระล่องหน (แสดงเป็นรหัส `U+XXXX`)
- พยัญชนะซ้ำเกิน, คำอังกฤษซ้ำติดกัน
- เว้นวรรคไม้ยมก (ๆ) และเว้นวรรคซ้อน (เปิด/ปิดได้ที่ "ตัวเลือกกฎการตรวจ")

---

### การติดตั้ง

1. ดาวน์โหลดและติดตั้งส่วนขยาย **Thai AI Proofreader** ผ่านทาง [Adobe Exchange Marketplace](https://adobe.com/go/cc_plugins_discover_plugin?pluginId=a0699c84&workflow=share)
2. เปิด (หรือรีสตาร์ท) InDesign แล้วเปิดแผง **Thai AI Proofreader** จากเมนูปลั๊กอินของ InDesign
3. เลือกเครื่องมือตรวจหลักในแผง และตั้งค่าตามหัวข้อด้านล่าง

---

### วิธีใช้

1. เลือก **เครื่องมือตรวจหลัก** (PyThaiNLP หรือ AI Engine) ระบบจะแสดงข้อความเตือนขอบเขตภาษาที่รองรับ
2. เลือก **ตัวเลือกกฎการตรวจ** และ **ขอบเขตการตรวจ**
3. กด **ตรวจคำผิด** (กด **หยุด** ได้ระหว่างตรวจ)
4. จัดการแต่ละการ์ด: ไปที่จุดนี้ / แก้เลย / แก้แล้ว / ละเว้น
5. ตรวจรอบใหม่ได้เลย หรือกด **ล้างการตรวจทั้งหมด** เพื่อเคลียร์ผลก่อน

> ถ้าแก้ข้อความในเอกสารเองหลังตรวจ ตำแหน่งในการ์ดอาจไม่ตรง ปลั๊กอินจะแจ้งว่า "ข้อความในเอกสารเปลี่ยนไปแล้ว" ให้กดตรวจใหม่

---

### โหมด PyThaiNLP

1. ติดตั้ง Python v3.13 ขึ้นไป (ดาวน์โหลดจาก python.org)
2. ติดตั้งแพ็กเกจ (ครั้งเดียว)

   ```bash
   pip install pythainlp pyspellchecker
   ```

3. บันทึกไฟล์ `spellcheck_server.py` ไว้ในโฟลเดอร์ใดก็ได้ แล้วรันบริการด้วย Terminal/Powershell (เปิดหน้าต่างค้างไว้ระหว่างใช้งาน)

   ```bash
   python "C:\{your save path}\spellcheck_server.py"
   ```

   *หรือกด **บันทึก spellcheck_server.py** แล้วเลือกจุดที่ต้องการบันทึก จากนั้นกด **บันทึก Server Launcher** ไว้ที่เดียวกัน แล้วดับเบิลคลิกไฟล์ Server Launcher เพื่อรันแทนการพิมพ์คำสั่งเอง*

4. เห็นข้อความ `spellcheck service on http://127.0.0.1:8765` แสดงว่าพร้อม
5. ในแผง กด **ทดสอบ** ข้าง URL บริการ

เปลี่ยนพอร์ตให้เป็นเลขที่ต้องการได้ด้วย `spellcheck_server.py --port XXXX` แล้วแก้ URL ในแผงให้ตรงกัน

---

### โหมด AI Engine

#### ผู้ให้บริการที่รองรับ
LM Studio, Ollama (Local) · OpenAI (ChatGPT) · Anthropic (Claude) · Google Gemini · OpenRouter · Groq · Mistral · DeepSeek · xAI (Grok) · Together AI · อื่น ๆ (OpenAI-compatible)

#### ตั้งค่าการเชื่อมต่อ
1. เปิดส่วน **โมเดล AI** กด **ตั้งค่า** ข้างช่อง "โปรไฟล์"
2. เลือก **ผู้ให้บริการ** ระบบเติม Base URL และค่าเริ่มต้นให้
3. ใส่ **API key** (เฉพาะ Cloud) และเลือก / พิมพ์ชื่อโมเดล
4. กด **บันทึก**, **ทดสอบการเชื่อมต่อ** และ **ทดสอบโมเดล**
5. สร้างหลายโปรไฟล์ได้ที่ **เพิ่มโปรไฟล์ใหม่** (ลบด้วย **ลบโปรไฟล์** กดยืนยันอีกครั้ง)

#### พารามิเตอร์

| ค่า | ความหมาย |
|---|---|
| MAX TOKENS | จำนวน token ตอบสูงสุดต่อ request |
| TEMP | อุณหภูมิ (งานพิสูจน์อักษรแนะนำค่าต่ำ) |
| THINKING / REASONING | ปิด / ต่ำ / กลาง / สูง / ค่าเริ่มต้นของโมเดล (งานนี้ไม่ต้องคิดลึก ปิดหรือต่ำจะเร็วกว่า) |
| BUDGET | งบ thinking (เฉพาะ Claude) |
| TIMEOUT / RETRY | เวลารอและจำนวนครั้งที่ลองใหม่เมื่อล้มเหลวชั่วคราว |
| พร้อมกัน | จำนวน request ที่ส่งพร้อมกัน |
| CHUNK | จำนวนตัวอักษรต่อ request |
| ใช้ endpoint `/api/v0` | เฉพาะ LM Studio: ดู tok/s จริงและ TTFT |

---

## Troubleshooting / การแก้ปัญหาเบื้องต้น

| Issue / อาการ | Resolution / วิธีแก้ |
|---|---|
| **"PyThaiNLP service is not running"** | Start `spellcheck_server.py` in your terminal and click **Test** / รัน `spellcheck_server.py` แล้วกด **ทดสอบ** |
| **Cannot connect to AI** | Check Base URL, ensure local server (LM Studio / Ollama) is online, or check internet / ตรวจ Base URL และอินเทอร์เน็ต |
| **401 / 403 Errors** | Invalid, expired, or unauthorized API key / API key ไม่ถูกต้อง หมดอายุ หรือไม่มีสิทธิ์ |
| **404 Errors** | Verify Base URL and model identifier string / ตรวจ Base URL และชื่อโมเดล |
| **429 Rate Limited** | Quota exceeded; lower "PARALLEL" or increase "RETRY" / ถูกจำกัดอัตรา ลดค่า "พร้อมกัน" หรือเพิ่ม RETRY |
| **Non-JSON Model Reply** | Switch models or lower THINKING levels / ลองโมเดลอื่น หรือลด THINKING |

---

## License & Open Source Attributions / ใบอนุญาตสิทธิ์

This software incorporates third-party open-source components governed by their respective licenses:

| Component / ส่วนประกอบ | Role / การใช้งาน | License / ใบอนุญาต | Attribution / ประกาศลิขสิทธิ์ |
|---|---|---|---|
| [PyThaiNLP](https://github.com/PyThaiNLP/pythainlp) | Thai NLP & spellchecking backend | [Apache-2.0](http://www.apache.org/licenses/LICENSE-2.0) | Copyright (c) 2016-Present PyThaiNLP Project & Contributors |
| [pyspellchecker](https://github.com/barrust/pyspellchecker) | English spellchecking backend | [MIT](https://opensource.org/licenses/MIT) | Copyright (c) Tyler Barrus |

### Notice under Apache License 2.0 (PyThaiNLP)
Licensed under the Apache License, Version 2.0 (the "License"); you may not use PyThaiNLP files except in compliance with the License. You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0). Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

---

## AI & Automated Processing Disclaimer / ข้อปฏิเสธความรับผิดชอบ

- **Automated Processing**: This plugin utilizes Natural Language Processing (NLP) and AI models for automated spellchecking. Suggestions are generated automatically and may occasionally be contextually inaccurate.
- **No Warranty**: The plugin is provided **"AS IS"**, without warranty of any kind, express or implied. Users are advised to review and verify all corrections before publishing or official use.
- **Data Privacy**: When using **Cloud APIs**, text from your document is transmitted externally to the selected provider. If working on confidential documents, use **PyThaiNLP mode** or a **Local AI** (LM Studio / Ollama) to ensure data remains strictly on your machine.

---

**Trademarks:** Adobe and InDesign are registered trademarks of Adobe Inc. OpenAI, ChatGPT, Claude, Anthropic, Gemini, Google, Mistral, DeepSeek, Grok, Groq, OpenRouter, Together AI, LM Studio, and Ollama are trademarks of their respective owners. This plugin is an independent product and is not affiliated with, endorsed, or sponsored by any of these trademark holders.

---

©2026 Konnext Group. All rights reserved.
