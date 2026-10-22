/* =========================================================
 *  changelog.js : รายการ "มีอะไรใหม่" ที่แสดงในหน้า About
 *
 *  วิธีอัปเดตเมื่อออกเวอร์ชันใหม่
 *   1) เพิ่ม object ใหม่ไว้ "บนสุด" ของ CHANGELOG (เลข version ต้องตรงกับ manifest.json)
 *   2) ใส่ข้อความทั้ง th และ en  (new = ใหม่, better = ปรับปรุง, fixed = แก้ไข)
 *   3) เพิ่มรายการเดียวกันใน CHANGELOG.md ด้วย
 *  หน้า About จะแสดงรายการของเวอร์ชันที่ตรงกับ manifest
 *  ถ้าไม่เจอ จะแสดงรายการบนสุดแทน
 * ========================================================= */
"use strict";

const CHANGELOG = [
  {
    version: "1.2.5",
    th: {
      new: [
        "เพิ่มป้ายเตือนความถูกต้อง (Disclaimer Banner) ใต้สถานะการตรวจ เพื่อเตือนให้ผู้ใช้ตรวจสอบข้อความอีกครั้งเสมอ"
      ],
      better: [
        "ปรับปรุง System Instruction (Prompt) มาตรฐานให้มีความชัดเจนยิ่งขึ้น และเน้นย้ำการตรวจจับคำสะกดผิดทั้งไทยและอังกฤษอย่างเท่าเทียม",
        "ปรับ UI แสดงขอบเขตภาษาแบบ Dynamic (`[TH]` / `[TH/EN]`) ใต้ปุ่มสลับเครื่องมือ เพื่อลดความสับสนเรื่องภาษาที่รองรับ",
        "ตัดตัวเลือก 'ภาษาที่ตรวจ' และ 'ดักจับคำน่าสงสัย' ออกจาก UI เพื่อลดความซับซ้อนในการตั้งค่า"
      ],
      fixed: []
    },
    en: {
      new: [
        "Added a disclaimer warning banner below the search status to remind users to always review generated results."
      ],
      better: [
        "Refined built-in System Instructions (Prompt) for better clarity, ensuring equal proofreading focus on both Thai and embedded English words.",
        "Added dynamic language boundary indicators (`[TH]` / `[TH/EN]`) under the checker toggle to prevent language support confusion.",
        "Simplified UI by removing 'Languages to check' and 'Flag suspicious words' options."
      ],
      fixed: []
    }
  },

  {
    version: "1.2.0",
    th: {
      new: [
        "สลับภาษาหน้าจอได้ (TH / EN) ค่าเริ่มต้นเป็นไทย พรอมต์มาตรฐานจะสลับตามภาษาด้วย",
        "ปุ่ม \"ล้างการตรวจทั้งหมด\" เคลียร์ผลที่เจอ แล้วเริ่มตรวจรอบใหม่ได้ทันที",
        "โหมด PyThaiNLP: ถ้ายังไม่ได้รันบริการ Python จะแจ้งเตือนและหยุด ไม่ตรวจต่อด้วยคลังคำเพียงอย่างเดียว",
        "ปุ่ม ? และ i สลับกล่องกันได้ และคลิกที่อื่นเพื่อปิด",
        "หน้า About แสดงรายการ \"มีอะไรใหม่\""
      ],
      better: [
        "ปรับหน้าตาใหม่ให้เรียบง่ายและทันสมัย: ระยะห่างสม่ำเสมอ, ปุ่มสลับเครื่องมือตรวจ, การ์ดผลตรวจอ่านง่ายขึ้น, ย้ายบันทึกการทำงานไปไว้ล่างสุด",
        "แสดงผลการตรวจลื่นขึ้นเมื่อเอกสารยาว และสแกนคำน่าสงสัยเร็วขึ้น"
      ],
      fixed: [
        "ปุ่มเพิ่มโปรไฟล์ใหม่, ลบโปรไฟล์ และลบ key กดแล้วไม่ทำงาน",
        "เลือกโมเดลจากรายการแล้วไม่ถูกบันทึก (Cloud API ส่งคำขอโดยไม่มีชื่อโมเดล)",
        "เปลี่ยนผู้ให้บริการแล้ว URL / timeout / chunk ไม่เปลี่ยนตาม",
        "ปุ่ม i (About) ไม่ทำงาน และลิงก์คู่มือบน GitHub เปิดไม่ได้"
      ]
    },
    en: {
      new: [
        "Added a disclaimer warning banner below the search status to remind users to always review generated results."
      ],
      better: [
        "Refined built-in System Instructions (Prompt) for better clarity, ensuring equal proofreading focus on both Thai and embedded English words.",
        "Added dynamic language boundary indicators (`[TH]` / `[TH/EN]`) under the checker toggle to prevent language support confusion.",
        "Simplified UI by removing 'Languages to check' and 'Flag suspicious words' options.",
        "Improved PyThaiNLP URL loader to automatically sanitize and strip Markdown formatting, preventing duplicated URL strings."
      ],
      fixed: []
    }
  }
];
