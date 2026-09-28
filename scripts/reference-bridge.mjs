import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';

const outputDir = '/tmp/oiioii-reference-capture';
const port = 5191;
const html = `<!doctype html><html lang="zh"><meta charset="utf-8"><title>本地项目数据接收</title><style>body{font:16px system-ui;margin:3rem;max-width:850px}textarea{width:100%;height:55vh}button{padding:.7rem 1.5rem}</style><h1>本地项目数据接收</h1><form method="post" action="/capture"><textarea name="payload" aria-label="项目数据 JSON"></textarea><p><button type="submit">保存到本地</button></p></form></html>`;
http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(html); return; }
  if (req.method === 'POST' && req.url === '/capture') {
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 3_000_000) {res.writeHead(413);res.end('too large');return;} }
    const json = JSON.parse(new URLSearchParams(body).get('payload') || '{}');
    await mkdir(outputDir, {recursive:true});
    await writeFile(`${outputDir}/project.json`, JSON.stringify(json, null, 2));
    res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); res.end(`<p>已保存到本地：${Array.isArray(json.shots) ? json.shots.length : 0} 个分镜。</p>`); return;
  }
  res.writeHead(404); res.end('not found');
}).listen(port, '127.0.0.1', () => console.log(`reference bridge on http://127.0.0.1:${port}`));
