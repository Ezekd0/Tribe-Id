"""Download the asset URLs returned by the previous Figma design-context calls."""
import concurrent.futures, json, pathlib, urllib.request
source = json.loads(pathlib.Path('.cache/figma-assets.json').read_text())
directory = pathlib.Path('apps/web/public/assets/figma')
def download(item):
    filename, metadata = item
    with urllib.request.urlopen(metadata['url'], timeout=30) as response:
        data = response.read()
        content_type = response.headers.get('content-type', '')
    if not data or 'text/html' in content_type: raise ValueError(f'Invalid asset: {filename}')
    (directory / filename).write_bytes(data)
    return {'file': filename, 'nodes': metadata['nodes'], 'bytes': len(data)}
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
    results = list(executor.map(download, source.items()))
pathlib.Path('docs/FIGMA_ASSETS.json').write_text(json.dumps(results, indent=2) + '\n')
print(f'Downloaded {len(results)} Figma assets.')
