#!/usr/bin/env python3
"""
spellcheck_server.py : บริการตรวจสะกดบนเครื่อง สำหรับปลั๊กอิน AI Proofreader (ตัวตรวจเสริม ไม่ใช้ LLM)

ติดตั้ง:   pip install pythainlp pyspellchecker
รัน:       python spellcheck_server.py            (ค่าเริ่มต้น 127.0.0.1:8765)
           python spellcheck_server.py --port 9000

ปลั๊กอินเรียก:
  GET  /health   -> {"ok": true, "pythainlp": "...", "english": true}
  POST /check    {"text": "...", "th": true, "en": true}
                 -> {"errors": [{"original": "...", "suggestion": "...", "issue": "..."}]}

หลักการ (ภาษาไทย): ตัดคำด้วย newmm -> หาโทเคนที่ไม่อยู่ในพจนานุกรม -> ลองรวมกับโทเคนข้างเคียง (ซ้าย/ขวา ไม่เกิน 2 โทเคน)
แล้วถามตัวแนะนำคำสะกด (spell) เลือกช่วงที่แก้ได้ด้วยระยะแก้ไขน้อยที่สุด (การแทนที่ตัวอักษรได้คะแนนดีกว่าการลบ/เพิ่ม ถ้าเท่ากันเลือกช่วงที่ยาวกว่า)
รายงานเฉพาะกรณีที่ "มีคำแนะนำ" เพื่อลดคำเตือนจากชื่อเฉพาะ
หลักการ (ภาษาอังกฤษ): pyspellchecker  (ข้ามคำขึ้นต้นตัวใหญ่กลางประโยค ตัวย่อ และคำที่ตัวใหญ่ปนกลางคำ)
"""
import argparse
import json
import re
import sys
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import pythainlp
    from pythainlp.corpus import thai_words
    from pythainlp.spell import spell as th_spell
    from pythainlp.tokenize import word_tokenize
except ImportError:
    print("ต้องติดตั้ง pythainlp ก่อน:  pip install pythainlp", file=sys.stderr)
    raise

try:
    from spellchecker import SpellChecker
    EN = SpellChecker()
except Exception:  # ไม่มี pyspellchecker -> ปิดส่วนอังกฤษ
    EN = None

THAI_RE = re.compile(r"[\u0E01-\u0E7F]")
THAI_DIGITS = re.compile(r"^[\u0E50-\u0E59]+$")
LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z']*")
MAX_SPAN_CHARS = 16
MAX_OOV_PER_REQUEST = 300

WORDS = thai_words()  # frozenset ของคำไทย


@lru_cache(maxsize=20000)
def spell_cached(word):
    try:
        return tuple(th_spell(word))
    except Exception:
        return ()


def edit_distance(a, b):
    """Damerau-Levenshtein (ค่าน้อย ใช้กับคำสั้น ๆ)"""
    la, lb = len(a), len(b)
    d = [[0] * (lb + 1) for _ in range(la + 1)]
    for i in range(la + 1):
        d[i][0] = i
    for j in range(lb + 1):
        d[0][j] = j
    for i in range(1, la + 1):
        for j in range(1, lb + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[la][lb]


def is_oov(tok):
    if not tok.strip() or not THAI_RE.search(tok):
        return False
    bare = tok.replace("ๆ", "").replace("ฯ", "")
    if not bare or bare in WORDS or THAI_DIGITS.match(bare) or bare == "ณ":
        return False
    if re.search(r"[A-Za-z0-9]", bare):
        return False
    return True


def check_thai(text):
    toks = word_tokenize(text, engine="newmm", keep_whitespace=True)
    out, seen = [], set()
    handled = 0
    for i, tok in enumerate(toks):
        if not is_oov(tok):
            continue
        handled += 1
        if handled > MAX_OOV_PER_REQUEST:
            break
        best = None  # (distance, -len, span, suggestion)
        for l in range(0, 3):
            for r in range(0, 3):
                lo, hi = i - l, i + r
                if lo < 0 or hi >= len(toks):
                    continue
                part = toks[lo:hi + 1]
                if any((not t.strip()) or (not THAI_RE.search(t)) for t in part):
                    continue
                span = "".join(part)
                if len(span) > MAX_SPAN_CHARS or span in WORDS:
                    continue
                cands = spell_cached(span)
                if not cands:
                    continue
                sug = cands[0]
                if sug == span or sug not in WORDS:
                    continue
                dist = edit_distance(span, sug)
                if dist > 2:
                    continue
                # ชอบการแก้แบบแทนที่ตัวอักษร (ความยาวเท่าเดิม) มากกว่าการลบ/เพิ่มตัวอักษร ลดการเดาแก้แบบตัดเศษทิ้ง
                key = (dist + (0.5 if len(sug) != len(span) else 0), -len(span))
                if best is None or key < best[0]:
                    best = (key, span, sug)
        if best:
            _, span, sug = best
            if (span, sug) not in seen:
                seen.add((span, sug))
                out.append({"original": span, "suggestion": sug, "issue": "สะกดผิด? (PyThaiNLP)"})
    return out


def sentence_start(text, i):
    j = i - 1
    while j >= 0 and text[j] in ' \t"\u201c\u2018\'([':
        j -= 1
    return j < 0 or text[j] in ".!?:\r\n\u2028"


def check_english(text):
    if EN is None:
        return []
    out, seen = [], set()
    for m in LATIN_WORD.finditer(text):
        w = m.group(0)
        if len(w) < 3 or any(c.isupper() for c in w[1:]):
            continue
        if w[0].isupper() and not sentence_start(text, m.start()):
            continue
        base = re.sub(r"'s$", "", w)
        if not base or base.lower() in EN:
            continue
        corr = EN.correction(base.lower())
        if corr and corr != base.lower():
            if base[0].isupper():
                corr = corr.capitalize()
            if (w, corr) not in seen:
                seen.add((w, corr))
                out.append({"original": w, "suggestion": corr, "issue": "สะกดผิด? (English)"})
    return out


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204, {})

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"ok": True, "pythainlp": pythainlp.__version__, "english": EN is not None})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/check"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            data = json.loads(self.rfile.read(n).decode("utf-8"))
            text = str(data.get("text", ""))
            errors = []
            if data.get("th", True):
                errors += check_thai(text)
            if data.get("en", True):
                errors += check_english(text)
            self._send(200, {"errors": errors})
        except Exception as e:  # noqa
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[spellcheck] " + (fmt % args) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    print(f"spellcheck service on http://{a.host}:{a.port}  (English: {'on' if EN else 'off - pip install pyspellchecker'})")
    ThreadingHTTPServer((a.host, a.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
