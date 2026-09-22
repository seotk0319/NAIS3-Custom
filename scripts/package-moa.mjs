import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import assert from 'node:assert/strict'
import JSZip from 'jszip'

const root = fileURLToPath(new URL('../', import.meta.url))
const extension = path.join(root, 'integrations/moa/extension')
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'))
const guide = await readFile(path.join(root, 'MOA-START-HERE.md'), 'utf8')
const files = ['manifest.json', 'api-worker.js', 'bootstrap.js', 'session-bridge.js', 'popup.html', 'popup.js', 'popup.css', ...['model','client','sessions','special','renewal'].map(n => `lib/${n}.mjs`)]
assert.ok((await readFile(path.join(extension, 'api-worker.js'), 'utf8')).includes(`VERSION='${manifest.version}'`))
assert.equal(await readFile(path.join(extension, 'lib/model.mjs'), 'utf8'), await readFile(path.join(root, 'src/main/notifications/core/api/model.mjs'), 'utf8'), 'App and extension normalization must match')
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
let body = '', list = null, section = false
const closeList = () => { if (list) body += `</${list}>`; list = null }
for (const line of guide.split(/\r?\n/)) {
  if (!line.trim()) { closeList(); continue }
  const h = /^(#{1,3}) (.+)$/.exec(line)
  if (h) {
    closeList()
    if (h[1].length === 2) { if(section) body += '</section>'; body += '<section>'; section = true }
    body += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`
  } else {
    const ordered = /^\d+\. (.+)$/.exec(line), unordered = /^- (.+)$/.exec(line)
    if (ordered || unordered) {
      const tag = ordered ? 'ol' : 'ul'
      if (list !== tag) { closeList(); body += `<${tag}>`; list = tag }
      body += `<li>${inline((ordered || unordered)[1])}</li>`
    } else { closeList(); body += `<p>${inline(line)}</p>` }
  }
}
closeList(); if (section) body += '</section>'
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NAIS + 모아 · 처음 설치하기</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#202b42;font:17px/1.85 "Malgun Gothic",sans-serif}main{max-width:870px;margin:auto;padding:48px 24px 72px}h1{font-size:36px;letter-spacing:-1.4px;line-height:1.3;margin:12px 0 20px}h2{font-size:24px;line-height:1.4;color:#2548b0;margin:0 0 20px}h3{font-size:18px;margin-top:28px}section{background:#fff;border:1px solid #e0e5f0;border-radius:18px;padding:30px;margin-top:24px;break-inside:avoid}p{margin:12px 0}li{padding:5px 0}strong{color:#173a93}a{color:#2451d6;text-underline-offset:4px}ol{padding-left:28px}ol li::marker{font-weight:bold;color:#2451d6}ul{padding-left:24px}.badge{font-size:13px;letter-spacing:2px;color:#5b6d94}footer{font-size:13px;color:#667085;margin-top:30px}@media(max-width:550px){main{padding:24px 16px}h1{font-size:29px}section{padding:22px 18px}}@media print{body{background:#fff;font-size:12px}main{padding:0}section{padding:16px;margin-top:12px}h1{font-size:26px}h2{font-size:19px}}
</style></head><body><main><div class="badge">NAIS CUSTOM + MOA / START HERE</div>${body}<footer>설명서는 인터넷 없이 열 수 있어요. 다운로드 링크만 인터넷 연결이 필요해요.</footer></main></body></html>`
await writeFile(path.join(extension, 'guide.html'), html)
await mkdir(path.join(root, 'dist'), {recursive:true})
await writeFile(path.join(root, 'dist/MOA-START-HERE.html'), html)
await writeFile(path.join(root, 'dist/MOA-START-HERE.md'), guide)
const zip = new JSZip()
for (const file of files) zip.file(`moa-extension/${file}`, await readFile(path.join(extension, file)))
zip.file('moa-extension/guide.html', html)
zip.file('MOA-START-HERE.html', html)
zip.file('MOA-START-HERE.md', guide)
zip.file('LICENSE', await readFile(path.join(root, 'LICENSE')))
const payload = await zip.generateAsync({type:'nodebuffer', compression:'DEFLATE'})
const check = await JSZip.loadAsync(payload)
assert.equal(JSON.parse(await check.file('moa-extension/manifest.json').async('string')).version, manifest.version)
assert.equal(Object.values(check.files).filter(f => !f.dir).length, files.length + 4)
const output = path.join(root, `dist/moa-extension-${manifest.version}.zip`)
await writeFile(output, payload)
console.log(JSON.stringify({output, version:manifest.version, files:Object.keys(check.files), bytes:payload.length}, null, 2))
