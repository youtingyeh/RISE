"""Read-only check of the public course catalog; never logs returned course data."""
import base64
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request


def configuration(path):
    source = Path(path).read_text(encoding='utf-8')
    def literal(name):
        match = re.search(r'\b' + name + r'\s*:\s*([\"\'])(.*?)\1', source)
        if not match:
            raise ValueError('Missing public configuration field: ' + name)
        return match.group(2)
    url, key = literal('url').rstrip('/'), literal('publishableKey')
    if not re.fullmatch(r'https://[a-z0-9]+\.supabase\.co', url):
        raise ValueError('Expected a hosted Supabase HTTPS project URL')
    if not key.startswith('sb_publishable_'):
        try:
            payload = key.split('.')[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
            if claims.get('role') != 'anon':
                raise ValueError()
        except Exception:
            raise ValueError('Only a public publishable key or anon JWT is allowed') from None
    return url, key


def check(url, key):
    headers = {'apikey': key, 'Accept': 'application/json', 'User-Agent': 'RISE-readonly-healthcheck/1.0'}
    if not key.startswith('sb_publishable_'):
        headers['Authorization'] = 'Bearer ' + key
    request = urllib.request.Request(url + '/rest/v1/rpc/rise_course_catalog', headers=headers, method='GET')
    # Disallow redirects so credentials cannot be forwarded to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    with opener.open(request, timeout=20) as response:
        data = response.read(1048577)
        if len(data) > 1048576 or not isinstance(json.loads(data), list):
            raise ValueError('Unexpected catalog response')


def main():
    try:
        url, key = configuration(Path(__file__).resolve().parents[1] / 'auth-config.js')
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    for attempt in range(2):
        try:
            check(url, key)
            print('PASS: Supabase database public catalog responded. No records changed.')
            return 0
        except urllib.error.HTTPError as exc:
            print('Database check failed: HTTP ' + str(exc.code), file=sys.stderr)
            if exc.code < 500 and exc.code != 429:
                break
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            print('Database check failed: network timeout or invalid response.', file=sys.stderr)
        if attempt == 0:
            time.sleep(5)
    print('Check Supabase project status and that backend/course-assignments.sql is installed.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
