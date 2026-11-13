"""Fetch candidate recipe evidence for manual review; never invent ingredient conversions.
Run from any directory. Raw evidence stays outside the checkout; reviewed numeric
records are added to data/recipes.json before rerunning train-classifier.cjs.
"""
import argparse
import concurrent.futures
import hashlib
import json
from html.parser import HTMLParser
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

class LinkedData(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.parts = []
        self.documents = []
    def handle_starttag(self, tag, attrs):
        if tag == 'script':
            self.active = dict(attrs).get('type', '').lower() == 'application/ld+json'
            self.parts = []
    def handle_data(self, data):
        if self.active:
            self.parts.append(data)
    def handle_endtag(self, tag):
        if tag == 'script' and self.active:
            try:
                self.documents.append(json.loads(''.join(self.parts)))
            except json.JSONDecodeError:
                pass
            self.active = False

def fetch(candidate, directory):
    url = candidate['url']
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'RecipeResearch/1.0'})
        with urllib.request.urlopen(request, timeout=20) as response:
            content = response.read(8_000_001)
            if len(content) > 8_000_000:
                raise ValueError('Page exceeds 8 MB limit')
            text = content.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
            parser = LinkedData()
            parser.feed(text)
            key = hashlib.sha256(url.encode()).hexdigest()[:16]
            (directory / (key+'.html')).write_text(text)
            evidence = dict(candidate, final_url=response.url, linked_data=parser.documents,
                            review_required=True)
            (directory / (key+'.json')).write_text(json.dumps(evidence, ensure_ascii=False, indent=2))
        return dict(candidate, status='fetched-for-review', linked_data_documents=len(parser.documents))
    except (OSError, ValueError) as error:
        return dict(candidate, status='failed', error=str(error))

if __name__ == '__main__':
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--output', type=Path, default=Path('/workspace/recipe-source-cache'))
    args = cli.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    plan = json.loads((ROOT / 'data/collection-plan.json').read_text())
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(lambda item: fetch(item, args.output), plan['candidate_sources']))
    (args.output / 'collection-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    for result in results:
        print(json.dumps(result, ensure_ascii=False))
    if any(result['status'] == 'failed' for result in results):
        raise SystemExit(1)
