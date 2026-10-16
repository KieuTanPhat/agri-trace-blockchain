"""Publish only trace structure and DOM snapshots; never HTTP bodies, cookies or source files."""
import json, re, sys, zipfile
from urllib.parse import urlsplit
secrets = sorted(filter(None, json.load(sys.stdin)), key=len, reverse=True)
def text(value):
    for secret in secrets:
        value = value.replace(secret, '[REDACTED]')
    value = re.sub(r'eyJ[A-Za-z0-9_.-]+', '[REDACTED-JWT]', value)
    value = re.sub(r'Bearer\s+\S+', 'Bearer [REDACTED]', value, flags=re.I)
    return re.sub(r'[\w.+-]+@[\w.-]+\.[a-z]+', '[REDACTED-EMAIL]', value, flags=re.I)
private_keys = {'headers', 'cookies', 'postData', 'postDataSha1', 'authorization', 'storageState',
                'localStorage', 'sessionStorage', 'value', 'body', 'responseBody', 'requestBody'}
def clean(value, key=''):
    if key in private_keys:
        return '[REDACTED]'
    if isinstance(value, dict):
        return {k: clean(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, str):
        if key in {'url', 'documentURL', 'baseURI'}:
            parsed = urlsplit(value)
            if parsed.scheme in {'http', 'https'}:
                return parsed.scheme + '://' + parsed.netloc + parsed.path
        return text(value)
    return value
with zipfile.ZipFile(sys.argv[1]) as source, zipfile.ZipFile(sys.argv[2], 'w', zipfile.ZIP_DEFLATED) as target:
    for name in source.namelist():
        if not name.endswith(('.trace', '.network', '.stacks')):
            continue
        lines = []
        for line in source.read(name).decode('utf-8').splitlines():
            event = json.loads(line)
            if name.endswith('.network'):
                snap = event.get('snapshot', {})
                request = snap.get('request', {})
                response = snap.get('response', {})
                # HAR bodies and header values are excluded, including referenced resources.
                event = {'type': event.get('type'), 'snapshot': {
                    '_monotonicTime': snap.get('_monotonicTime'),
                    'startedDateTime': snap.get('startedDateTime'), 'time': snap.get('time'),
                    'request': {'method': request.get('method'), 'url': request.get('url'), 'headers': [], 'cookies': []},
                    'response': {'status': response.get('status'), 'statusText': response.get('statusText'), 'headers': [], 'cookies': [], 'content': {}},
                    'timings': snap.get('timings', {})}}
                # The constructed empty headers/cookies are safe and preserve trace viewer shape.
                event['snapshot']['request']['url'] = clean(request.get('url', ''), 'url')
            else:
                event = clean(event)
            lines.append(json.dumps(event, separators=(',', ':')))
        target.writestr(name, '\n'.join(lines) + '\n')
