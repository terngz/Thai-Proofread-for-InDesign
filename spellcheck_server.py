#!/usr/bin/env python3
import argparse
import json
import math
import os
import re
import sys
import time
from collections import defaultdict
from functools import lru_cache
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import pythainlp
    from pythainlp.corpus import thai_words
    from pythainlp.spell import NorvigSpellChecker
    from pythainlp.tokenize import word_tokenize
    from pythainlp.util import Trie
except ImportError:
    print("pythainlp is required: pip install pythainlp pyspellchecker", file=sys.stderr)
    raise

try:
    from spellchecker import SpellChecker
    EN = SpellChecker(language="en")
except Exception:
    EN = None

VERSION = "2.0"
MAX_BODY = 2 * 1024 * 1024
MAX_WINDOW_CHARS = 14
MAX_UNKNOWN_SPANS = 300
TIME_BUDGET_SEC = 20
REPEAT_SKIP = 3
MIN_CAND_FREQ = 20

THAI_RUN = re.compile(r"[\u0E01-\u0E3A\u0E40-\u0E4E]+")
HIDDEN = re.compile(r"[\u200B-\u200D\u2060\uFEFF\u00AD]")
SKIP_ZONES = re.compile(r"https?://\S+|www\.\S+|\b[\w.+-]+@[\w-]+\.[\w.-]+|[A-Za-z]:\\\S+|(?<!\w)#\w+")
EN_WORD = re.compile(r"(?<![A-Za-z0-9_])[A-Za-z]+(?:['\u2019][A-Za-z]+)*(?![A-Za-z0-9_])")
THAI_TITLES = {"คุณ", "นาย", "นาง", "นางสาว", "ดร", "ครู", "พระ", "หมอ", "นพ", "พญ", "ศ", "รศ", "ผศ", "อ"}
EN_CONTRACTION = re.compile(r"(?:['\u2019](?:s|re|ve|ll|d|m)|n['\u2019]t)$", re.I)
EN_CONTRACTION_WHOLE = {"can't", "won't", "shan't", "ain't"}

TONES = set("\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E")
VOWELS = set("\u0E30\u0E31\u0E32\u0E33\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E3A\u0E40\u0E41\u0E42\u0E43\u0E44")
CONFUSABLE = {}
for grp in ("ศษส", "ทธฑฒ", "ถฐ", "ดฎ", "ตฏ", "นณ", "พภ", "ชฌ", "ซส", "รล", "ใไ", "เแ", "ขค", "ผพ"):
    for a in grp:
        for b in grp:
            if a != b:
                CONFUSABLE[(a, b)] = 0.5

DTP_TERMS = (
    "kerning tracking leading typeface bleed bleeds preflight overprint ligature ligatures glyph glyphs "
    "opentype truetype cmyk indd idml hyperlink hyperlinks pictogram baseline stylesheet stylesheets "
    "pagination sidebar workflow plugin plugins metadata onscreen online offline login logout setup backup "
    "email emails website websites username app apps"
).split()
BRIT_IRREGULAR = (
    "grey programme cheque tyre kerb plough mould sceptic jewellery aluminium ageing whilst amongst learnt spelt"
).split()
BRIT_SUFFIX = [
    ("isations", "izations"), ("isation", "ization"), ("ising", "izing"), ("ised", "ized"), ("ises", "izes"),
    ("ise", "ize"), ("ysing", "yzing"), ("ysed", "yzed"), ("yse", "yze"), ("ouring", "oring"), ("oured", "ored"),
    ("ours", "ors"), ("our", "or"), ("tres", "ters"), ("tre", "ter"), ("ences", "enses"), ("ence", "ense"),
    ("ogues", "ogs"), ("ogue", "og"), ("elling", "eling"), ("elled", "eled"), ("eller", "eler"),
    ("lling", "ling"), ("lled", "led"), ("ller", "ler"),
]


def script_dir():
    return os.path.dirname(os.path.abspath(__file__))


def load_user_words(path):
    th, en = set(), set()
    if not path or not os.path.isfile(path):
        return th, en
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.strip()
            if not w or w.startswith("#"):
                continue
            (th if re.search(r"[\u0E01-\u0E7F]", w) else en).add(w)
    return th, en


class ThaiEngine:
    def __init__(self, user_words):
        self.words = set(thai_words()) | set(user_words)
        self.trie = Trie(self.words)
        nv = NorvigSpellChecker()
        freq = {w: f for w, f in nv.dictionary() if f >= MIN_CAND_FREQ}
        for w in user_words:
            freq[w] = max(freq.get(w, 0), 1000)
        self.freq = freq
        self.head2, self.tail2, self.ends, self.by_len = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
        for w in freq:
            if len(w) < 2:
                continue
            self.head2[w[:2]].append(w)
            self.tail2[w[-2:]].append(w)
            self.ends[(w[0], w[-1])].append(w)
            self.by_len[len(w)].append(w)

    def tokenize(self, run):
        return word_tokenize(run, engine="newmm", custom_dict=self.trie, keep_whitespace=False)

    def known(self, tok):
        bare = tok.replace("\u0E46", "").replace("\u0E2F", "")
        return not bare or bare in self.words or bare == "\u0E13"

    @staticmethod
    def limit(n):
        return 1.0 if n <= 6 else (1.5 if n <= 10 else 2.0)

    @staticmethod
    def gap(ch):
        return 0.4 if ch in TONES else (0.8 if ch in VOWELS else 1.0)

    @classmethod
    def sub(cls, a, b):
        if a == b:
            return 0.0
        if a in TONES and b in TONES:
            return 0.4
        return CONFUSABLE.get((a, b), 1.0)

    @classmethod
    def wdist(cls, a, b, limit):
        la, lb = len(a), len(b)
        prev2 = None
        prev = [0.0] * (lb + 1)
        for j in range(1, lb + 1):
            prev[j] = prev[j - 1] + cls.gap(b[j - 1])
        for i in range(1, la + 1):
            cur = [prev[0] + cls.gap(a[i - 1])] + [0.0] * lb
            for j in range(1, lb + 1):
                v = min(prev[j] + cls.gap(a[i - 1]), cur[j - 1] + cls.gap(b[j - 1]), prev[j - 1] + cls.sub(a[i - 1], b[j - 1]))
                if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                    v = min(v, prev2[j - 2] + 0.6)
                cur[j] = v
            if min(cur) > limit:
                return limit + 1
            prev2, prev = prev, cur
        return prev[lb]

    def pool(self, w):
        n = len(w)
        if n <= 3:
            out = []
            for k in (n - 1, n, n + 1):
                out.extend(self.by_len.get(k, ()))
            return out
        seen = set()
        for src in (self.head2.get(w[:2], ()), self.tail2.get(w[-2:], ()), self.ends.get((w[0], w[-1]), ())):
            seen.update(src)
        return seen

    @lru_cache(maxsize=30000)
    def best(self, w):
        n = len(w)
        if n < 2 or n > MAX_WINDOW_CHARS:
            return None
        lim = self.limit(n)
        chars = set(w)
        top = None
        for c in self.pool(w):
            if c == w or abs(len(c) - n) > 2:
                continue
            cs = set(c)
            if min(len(chars), len(cs)) - len(chars & cs) > 2:
                continue
            d = self.wdist(w, c, lim)
            if d > lim:
                continue
            score = d - 0.1 * math.log10(self.freq[c])
            if top is None or score < top[0]:
                top = (score, d, c)
        return None if top is None else (top[2], top[1])

    def check(self, text, deadline):
        text = HIDDEN.sub("", text)
        out, seen = [], set()
        spans_done = 0
        for m in THAI_RUN.finditer(text):
            run = m.group(0)
            toks = self.tokenize(run)
            unk = [not self.known(t) for t in toks]
            i = 0
            while i < len(toks):
                if not unk[i]:
                    i += 1
                    continue
                j = i
                while j < len(toks) and unk[j]:
                    j += 1
                spans_done += 1
                if spans_done > MAX_UNKNOWN_SPANS or time.time() > deadline:
                    return out
                core = "".join(toks[i:j])
                if len(core) >= 2 and not (i > 0 and toks[i - 1] in THAI_TITLES) and text.count(core) < REPEAT_SKIP:
                    hit = self.pick(toks, i, j)
                    if hit and hit[0] not in seen:
                        seen.add(hit[0])
                        out.append({"original": hit[0], "suggestion": hit[1], "issue": "Spelling? (PyThaiNLP)"})
                i = j
        return out

    def pick(self, toks, a, b):
        core = "".join(toks[a:b])
        fragment = len(core) <= 2
        best = None
        for left in range(0, 3):
            for right in range(0, 2):
                if a - left < 0 or b + right > len(toks):
                    continue
                if fragment and left == 0 and right == 0:
                    continue
                win = "".join(toks[a - left:b + right])
                if len(win) > MAX_WINDOW_CHARS:
                    continue
                r = self.best(win)
                if not r:
                    continue
                key = (round(r[1], 2), -len(win))
                if best is None or key < best[0]:
                    best = (key, win, r[0])
        if best is None:
            return None
        return best[1], best[2]


class EnglishEngine:
    def __init__(self, user_words):
        self.ok = EN is not None
        if not self.ok:
            return
        EN.word_frequency.load_words(DTP_TERMS + BRIT_IRREGULAR + list(user_words))

    def is_known(self, w):
        return bool(EN.known([w]))

    def british_ok(self, w):
        for suf, rep in BRIT_SUFFIX:
            if w.endswith(suf) and self.is_known(w[:-len(suf)] + rep):
                return True
        return any(self.is_known(w.replace(x, "e", 1)) for x in ("ae", "oe") if x in w)

    @lru_cache(maxsize=20000)
    def suggest(self, w):
        n = len(w)
        if n > 16:
            return None
        cands = EN.known(EN.edit_distance_1(w))
        if not cands and n <= 9:
            cands = EN.known(EN.edit_distance_2(w))
        if not cands:
            return None
        return max(cands, key=lambda c: EN.word_frequency[c])

    @staticmethod
    def sentence_start(text, pos):
        i = pos - 1
        while i >= 0 and text[i] in " \t\"\u201C\u2018'([":
            i -= 1
        return i < 0 or text[i] in ".!?:\u2022\u2026\n\r"

    def check(self, text, deadline):
        if not self.ok:
            return []
        masked = SKIP_ZONES.sub(lambda m: " " * len(m.group(0)), text)
        out, seen = [], set()
        for m in EN_WORD.finditer(masked):
            if time.time() > deadline:
                break
            w = m.group(0)
            if len(w) < 3 or w.isupper() or any(c.isupper() for c in w[1:]):
                continue
            low = w.lower().replace("\u2019", "'")
            if low in EN_CONTRACTION_WHOLE:
                continue
            base = EN_CONTRACTION.sub("", low)
            if not base or self.is_known(low) or self.is_known(base) or self.british_ok(base):
                continue
            if w[0].isupper() and not self.sentence_start(masked, m.start()):
                continue
            sug = self.suggest(base)
            if not sug or sug == base:
                continue
            if w[0].isupper():
                sug = sug.capitalize()
            if (w, sug) not in seen:
                seen.add((w, sug))
                out.append({"original": w, "suggestion": sug, "issue": "Spelling? (English)"})
        return out


TH = None
ENG = None


def build_engines(dict_path):
    global TH, ENG
    t0 = time.time()
    user_th, user_en = load_user_words(dict_path)
    TH = ThaiEngine(user_th)
    ENG = EnglishEngine(user_en)
    TH.check("\u0E17\u0E14\u0E2A\u0E2D\u0E1A\u0E23\u0E30\u0E1A\u0E1A\u0E40\u0E1E\u0E37\u0E2D\u0E19", time.time() + 5)
    ENG.check("warm up test", time.time() + 5)
    return time.time() - t0, len(user_th) + len(user_en)


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, obj=None):
        body = b"" if obj is None else json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if code != 204:
            self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def do_GET(self):
        if self.path.startswith("/health"):
            self._send(200, {"ok": True, "version": VERSION, "pythainlp": pythainlp.__version__, "english": bool(ENG and ENG.ok)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if not self.path.startswith("/check"):
            return self._send(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self._send(400, {"error": "bad length"})
        if n <= 0 or n > MAX_BODY:
            return self._send(413 if n > MAX_BODY else 400, {"error": "bad body size"})
        try:
            data = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return self._send(400, {"error": "bad json"})
        try:
            text = str(data.get("text", ""))
            deadline = time.time() + TIME_BUDGET_SEC
            errors = []
            if data.get("th", True):
                errors += TH.check(text, deadline)
            if data.get("en", True):
                errors += ENG.check(text, deadline)
            self._send(200, {"errors": errors})
        except Exception as e:
            self._send(500, {"error": str(e)})

    def log_message(self, fmt, *args):
        sys.stderr.write("[spellcheck] " + (fmt % args) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--dict", default=os.path.join(script_dir(), "user_words.txt"))
    a = ap.parse_args()
    print("loading dictionaries...", flush=True)
    secs, extra = build_engines(a.dict)
    try:
        srv = ThreadingHTTPServer((a.host, a.port), Handler)
    except OSError as e:
        print(f"cannot bind {a.host}:{a.port} - {e}", file=sys.stderr)
        sys.exit(1)
    print(f"spellcheck service v{VERSION} ready on http://{a.host}:{a.port}  "
          f"(English: {'on' if ENG.ok else 'off - pip install pyspellchecker'}, user words: {extra}, loaded in {secs:.1f}s)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()