"""Build the single-file 3D intro (public/intro.html) from intro-src/. Run: python3 scripts/build-intro.py"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'intro-src'
OUT = ROOT / 'public' / 'intro.html'

html = (SRC / 'presentation.template.html').read_text(encoding='utf-8')
for key, name in [('__SNAPSHOT__', 'snapshot.json'), ('__SUPPORT__', 'support.cjs'), ('__SHADER__', 'flame.frag')]:
    content = (SRC / name).read_text(encoding='utf-8').replace('</script', '<\\/script')
    html = html.replace(key, content)
OUT.write_text(html, encoding='utf-8')
print(f'Built {OUT} ({OUT.stat().st_size:,} bytes)')
