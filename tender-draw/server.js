'use strict';

/**
 * 集中采购招标代理机构随机抽签 · 服务端
 *
 * 职责只有两个：
 *   1. 提供 index.html
 *   2. 读写 companies.json（GET 读取，PUT 保存）
 *
 * 抽签本身在页面里完成，服务端不参与。仅使用 Node.js 内置模块，无第三方依赖。
 *
 * 环境变量：
 *   PORT            端口，默认 3000
 *   HOST            监听地址，默认 127.0.0.1（供内网访问时设为 0.0.0.0）
 *   COMPANIES_FILE  名单文件路径，默认 ./companies.json
 */

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const ROOT = __dirname;
const INDEX_FILE = path.join(ROOT, 'index.html');
const DATA_FILE = process.env.COMPANIES_FILE
  ? path.resolve(process.env.COMPANIES_FILE)
  : path.join(ROOT, 'companies.json');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_ITEMS = 50;
const MAX_NAME_LENGTH = 40;

/* ------------------------------------------------------------------ *
 * 名单读写
 * ------------------------------------------------------------------ */

function cleanName(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ');
}

/** 统一成字符串数组：支持 ["甲","乙"] 与 { companies: [...] } 两种写法 */
function extractList(data) {
  const list = Array.isArray(data)
    ? data
    : data && Array.isArray(data.companies)
      ? data.companies
      : null;

  if (!list) return null;

  const seen = new Set();
  const out = [];

  for (const item of list) {
    const name = cleanName(typeof item === 'string' ? item : item && item.name);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }

  return out;
}

async function readRaw() {
  try {
    return await fsp.readFile(DATA_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new HttpError(500, '未找到名单文件 companies.json');
    }
    throw err;
  }
}

async function readRoster() {
  const raw = (await readRaw()).replace(/^\uFEFF/, '');

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new HttpError(500, '名单文件不是合法的 JSON，请联系系统管理员');
  }

  const companies = extractList(data);
  if (!companies) {
    throw new HttpError(500, '名单文件格式无法识别，请联系系统管理员');
  }

  return {
    companies,
    updatedAt: data && data.updatedAt ? String(data.updatedAt) : null
  };
}

/** 保存时沿用文件原有结构，只替换 companies 并刷新 updatedAt */
async function writeRoster(companies) {
  let current = null;

  try {
    const raw = (await readRaw()).replace(/^\uFEFF/, '');
    current = JSON.parse(raw);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    current = null;
  }

  const updatedAt = new Date().toISOString();
  const payload = Array.isArray(current)
    ? companies
    : Object.assign({}, current && typeof current === 'object' ? current : {}, {
        companies,
        updatedAt
      });

  const body = JSON.stringify(payload, null, 2) + '\n';
  const temp = `${DATA_FILE}.${process.pid}.tmp`;

  await fsp.writeFile(temp, body, 'utf8');
  await fsp.rename(temp, DATA_FILE);

  return updatedAt;
}

/** 串行化写入，避免两次保存交叉写坏文件 */
let writeQueue = Promise.resolve();

function withWriteLock(task) {
  const result = writeQueue.then(task, task);
  writeQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, payload, extraHeaders) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, '提交的内容过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function validateSubmission(payload) {
  const list = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.companies)
      ? payload.companies
      : null;

  if (!list) {
    throw new HttpError(400, '提交的内容格式不正确');
  }

  if (list.length > MAX_ITEMS) {
    throw new HttpError(400, `机构数量不能超过 ${MAX_ITEMS} 家`);
  }

  const seen = new Set();
  const companies = [];

  for (const item of list) {
    const name = cleanName(typeof item === 'string' ? item : item && item.name);

    if (!name) {
      throw new HttpError(400, '机构名称不能为空');
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new HttpError(400, `机构名称不能超过 ${MAX_NAME_LENGTH} 个字`);
    }
    if (seen.has(name)) {
      throw new HttpError(400, '机构名称重复了');
    }

    seen.add(name);
    companies.push(name);
  }

  if (companies.length === 0) {
    throw new HttpError(400, '至少需要保留一家机构');
  }

  return companies;
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

async function handleCompanies(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    const { companies, updatedAt } = await readRoster();
    sendJson(res, 200, { companies, updatedAt, count: companies.length });
    return;
  }

  if (req.method === 'PUT' || req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '');
    if (!contentType.includes('application/json')) {
      throw new HttpError(415, '提交的内容必须是 JSON');
    }

    const body = await readBody(req);

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (err) {
      throw new HttpError(400, '提交的内容不是合法的 JSON');
    }

    const companies = validateSubmission(payload);
    const updatedAt = await withWriteLock(() => writeRoster(companies));

    console.log(`[名单] ${new Date().toISOString()} 已保存 ${companies.length} 家：${companies.join('、')}`);
    sendJson(res, 200, { companies, updatedAt, count: companies.length });
    return;
  }

  throw new HttpError(405, '该接口仅支持 GET 与 PUT');
}

async function serveIndex(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, '不支持的请求方法');
  }

  const body = await fsp.readFile(INDEX_FILE).catch(() => {
    throw new HttpError(500, '未找到 index.html');
  });

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let status = 500;
  let route = '/';

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    route = url.pathname;

    if (route === '/api/companies') {
      await handleCompanies(req, res);
      status = 200;
    } else if (route === '/' || route === '/index.html') {
      await serveIndex(req, res);
      status = 200;
    } else {
      throw new HttpError(404, '页面不存在');
    }
  } catch (err) {
    const known = err instanceof HttpError;
    status = known ? err.status : 500;
    const message = known ? err.message : '服务器内部错误';

    if (!known) console.error('[错误]', err);

    if (!res.headersSent) {
      if (route.startsWith('/api/')) {
        sendJson(res, status, { error: message });
      } else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
      }
    } else if (!res.writableEnded) {
      res.end();
    }
  } finally {
    console.log(`${req.method} ${route} → ${status} (${Date.now() - started}ms)`);
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  集中采购招标代理机构随机抽签');
  console.log(`  访问地址  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`  名单文件  ${DATA_FILE}`);
  console.log('  页面上的「修改名单」会直接写入该文件');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，请用 PORT 环境变量指定另一个端口。`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
