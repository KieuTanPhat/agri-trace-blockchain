import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { redactDiagnostic } from './hybrid-browser-login.mjs';

test('browser diagnostics remove fixture credentials, bearer tokens and account email', () => {
  const secret = 'test-secret-password';
  const redacted = redactDiagnostic('test-secret-password user@example.test Bearer abc.def.ghi eyJabc.def.ghi', [secret]);
  assert.ok(!redacted.includes(secret));
  assert.ok(!redacted.includes('user@example.test'));
  assert.ok(!redacted.includes('abc.def.ghi'));
});

test('published Playwright traces exclude HTTP payloads, cookies, credentials and resources', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'agritrace-trace-test-'));
  const raw = path.join(folder, 'raw.zip');
  const safe = path.join(folder, 'safe.zip');
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const secret = 'fixture-password';
  execFileSync(python, ['-c', `import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1],'w') as z:
 z.writestr('0.trace',json.dumps({'type':'before','params':{'value':'fixture-password'},'url':'http://local/login?password=fixture-password'})+'\\n')
 z.writestr('0.network',json.dumps({'type':'resource-snapshot','snapshot':{'request':{'method':'POST','url':'http://local/api/auth/login','postData':{'text':'fixture-password'},'headers':[{'name':'Cookie','value':'private-cookie'}]},'response':{'status':201,'headers':[{'name':'Set-Cookie','value':'private-cookie'}],'content':{'_sha1':'secret-resource'}}}})+'\\n')
 z.writestr('resources/secret-resource','fixture-password private-cookie')
`, raw]);
  execFileSync(python, [fileURLToPath(new URL('./sanitize-browser-trace.py', import.meta.url)), raw, safe],
    { input: JSON.stringify([secret]) });
  const output = execFileSync(python, ['-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 print(z.namelist())
 for name in z.namelist(): print(z.read(name).decode())
`, safe], { encoding: 'utf8' });
  assert.ok(output.includes('0.trace'));
  assert.ok(output.includes('0.network'));
  assert.ok(output.includes('201'));
  for (const privateValue of [secret, 'private-cookie', 'secret-resource', 'password='])
    assert.ok(!output.includes(privateValue), privateValue);
});
