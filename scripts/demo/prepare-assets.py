"""Download reviewed, freely licensed photographs and retain attribution/hash metadata."""
import hashlib
import json
from pathlib import Path
import urllib.request

TARGET = Path(__file__).with_name('assets')
PHOTOS = [
    ('greenhouse', '1708796705570-33fd29ef67d0', 'wei', 'a-large-greenhouse-filled-with-lots-of-green-plants-eoj6t-cMtNs'),
    ('tomatoField', '1706359939227-eed750ff020f', 'Veronica Chalyj', 'tomatoes-growing-in-a-greenhouse-on-a-sunny-day-AyAUGDAay_Q'),
    ('tomato1', '1467020323552-36f7bf0e30e6', 'Thomas Martinsen', 'closeup-photo-of-red-tomatoes-iASD5_HpTZc'),
    ('tomato2', '1706359939227-eed750ff020f', 'Veronica Chalyj', 'tomatoes-growing-in-a-greenhouse-on-a-sunny-day-AyAUGDAay_Q'),
    ('tomato3', '1737963195345-77ac9aad9e59', 'Wanasanan Phonnaun', 'a-basket-filled-with-lots-of-ripe-tomatoes-qxqg-z4-w1M'),
    ('berry1', '1467825487722-2a7c4cd62e75', 'Clem Onojeghuo', 'selective-focus-photo-of-strawberries-in-clear-plastic-containers-eCre0iMGtEA'),
    ('berry2', '1529082790703-f8a22cd2c208', 'Monika Grabkowska', 'strawberry-lot-on-basket-B3ZHo7aoJEc'),
    ('berry3', '1768204042020-b3c0b924e423', 'Lee Milo', 'basket-of-fresh-strawberries-at-a-farm-QlhZbEejRfI'),
    ('logistics', '1778015862504-b877b548266e', 'Troy Mortier', 'truck-and-trailers-parked-in-front-of-a-warehouse-xkAIwD0hsbg'),
]

def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    manifest = {'license': 'Unsplash License', 'licenseUrl': 'https://unsplash.com/license',
                'reviewedAt': '2026-10-20', 'usage': 'Stock photographs illustrating fictional local demo entities; not actual certification evidence.', 'photos': []}
    for key, photo, author, slug in PHOTOS:
        source = 'https://unsplash.com/photos/' + slug
        image_url = f'https://images.unsplash.com/photo-{photo}?auto=format&fit=max&w=1200&q=78&fm=jpg'
        dest = TARGET / f'{key}.jpg'
        if not dest.exists():
            request = urllib.request.Request(image_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(request, timeout=60) as response:
                assert response.headers.get_content_type() == 'image/jpeg'
                content = response.read()
            assert content[:2] == b'\xff\xd8' and 10000 < len(content) < 5_000_000
            dest.write_bytes(content)
        content = dest.read_bytes()
        manifest['photos'].append({'key': key, 'file': dest.name, 'author': author, 'source': source,
                                   'download': image_url, 'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content)})
        print(f'{key}: {len(content)} bytes')
    (TARGET / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

if __name__ == '__main__':
    main()
