"""Build a single, offline HTML file from its editable components."""
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parents[2]

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'web/public/EMBER_Presentation.html')
    args = parser.parse_args()
    source = ROOT/'web/public/ember'
    html = (source/'presentation.template.html').read_text(encoding='utf-8')
    for key, name in [('__SNAPSHOT__', 'snapshot.json'), ('__SUPPORT__', 'support.js'), ('__SHADER__', 'flame.frag')]:
        content = (source/name).read_text(encoding='utf-8').replace('</script', '<\\/script')
        html = html.replace(key, content)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html, encoding='utf-8')
    print(f'Built {args.output} ({args.output.stat().st_size:,} bytes)')

if __name__ == '__main__':
    main()
