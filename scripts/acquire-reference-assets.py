"""Copy the user's OiiOii project resources into the local studio."""

import concurrent.futures
import json
import re
import shutil
import subprocess
import urllib.parse
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / 'reference/project.json').read_text())
DEST = ROOT / 'data/uploads/reference'
DEST.mkdir(parents=True, exist_ok=True)
ZIP = Path('/Users/fy15/Downloads/凡骨逆天武侠剧本素材-资源-1.zip')


def name_for(index, ext):
    return DEST / f'{index:02d}.{ext}'


if ZIP.exists():
    with zipfile.ZipFile(ZIP) as archive:
        for info in archive.infolist():
            try:
                original = info.filename.encode('cp437').decode('utf-8')
            except UnicodeError:
                original = info.filename
            match = re.search(r'-(image|video)-(\d+)\.(jpg|mp4)$', original)
            if not match:
                continue
            index = int(match.group(2))
            target = name_for(index, match.group(3))
            if target.exists() and target.stat().st_size == info.file_size:
                continue
            with archive.open(info) as source, target.open('wb') as output:
                shutil.copyfileobj(source, output)


def acquire(row):
    index = row['index']
    src = row['src']
    uri = urllib.parse.parse_qs(urllib.parse.urlparse(src).query).get('uri', [''])[0]
    if not uri.startswith(('hogi://image/', 'hogi://video/')):
        return {'index': index, 'error': 'resource URI unavailable'}
    ext = 'mp4' if uri.startswith('hogi://video/') else 'jpg'
    target = name_for(index, ext)
    if not target.exists() or target.stat().st_size < 10_000:
        url = 'https://api.oiioii.tv/res/read_file?uri=' + urllib.parse.quote(uri, safe='')
        temp = target.with_suffix(target.suffix + '.part')
        result = subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '120', '-o', str(temp), url], capture_output=True, text=True)
        if result.returncode:
            temp.unlink(missing_ok=True)
            return {'index': index, 'error': result.stderr.strip()[-240:]}
        temp.replace(target)
    return {'index': index, 'label': row['label'], 'kind': 'video' if ext == 'mp4' else 'image', 'uri': uri, 'localUrl': f'/uploads/reference/{target.name}', 'bytes': target.stat().st_size}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    results = sorted(pool.map(acquire, DATA['resources']), key=lambda row: row['index'])
(ROOT / 'reference/assets.json').write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
print(f"Copied {sum('localUrl' in row for row in results)}/{len(results)} resources")
for row in results:
    if 'error' in row:
        print(f"{row['index']}: {row['error']}")
