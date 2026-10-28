# 招标代理机构随机抽签

集中采购场景下随机选择招标代理机构的页面。深海军蓝、暖白与香槟金配色，抽签以滚动窗帘呈现，落定后醒目展示中选机构。候选名单保存在 `companies.json`，页面上的「修改名单」会直接写回该文件。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.js` | 零依赖 Node 服务，提供页面并读写名单文件 |
| `index.html` | 页面结构、样式、动画与抽签逻辑 |
| `companies.json` | 招标机构名单 |
| `README.md` | 本文件 |

服务端只做两件事：返回 `index.html`，以及通过 `GET /api/companies`、`PUT /api/companies` 读写名单。抽签过程完全在浏览器里完成，不经过服务端。

## 运行

需要 Node.js 18 或以上，无需安装任何依赖。

```bash
cd tender-draw
node server.js
```

打开 <http://127.0.0.1:3000/>。

内网供其他电脑访问时，把监听地址放开：

```bash
HOST=0.0.0.0 PORT=8080 node server.js
```

Windows PowerShell 下：

```powershell
$env:HOST="0.0.0.0"; $env:PORT="8080"; node server.js
```

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址，内网访问设为 `0.0.0.0` |
| `COMPANIES_FILE` | `./companies.json` | 名单文件路径，可指向外部挂载目录 |

长期运行可交给 systemd 或 pm2 托管，例如：

```ini
[Unit]
Description=Tender Draw
After=network.target

[Service]
WorkingDirectory=/srv/tender-draw
ExecStart=/usr/bin/node /srv/tender-draw/server.js
Environment=PORT=8080
Environment=HOST=0.0.0.0
Restart=always

[Install]
WantedBy=multi-user.target
```

## 修改名单

两种方式，改的都是同一个文件。

**页面上改。** 点名单右上角的「修改名单」，改完保存立即生效，并写回 `companies.json`。支持添加、删除；名称为空或重复会当场提示。

**直接改文件。** 编辑 `companies.json` 后刷新页面即可，无需重启服务。文件支持三种写法：

```json
{ "companies": ["中招国际招标有限公司", "国信招标集团股份有限公司"] }
```

```json
["中招国际招标有限公司", "国信招标集团股份有限公司"]
```

```json
{ "companies": [{ "name": "中招国际招标有限公司" }] }
```

保存时会沿用文件原有结构，只替换 `companies` 并刷新 `updatedAt`，文件里其他字段（例如 `_note`）不会被清掉。

注意事项：

- 运行服务的账号需要对 `companies.json` 有写权限，否则页面会提示保存失败。
- 多位同事同时修改时以最后一次保存为准；改完刷新页面即可看到最新名单。
- 机构数量不限，重复名称自动去重，空名称会被忽略。

## 配色

固定使用墨金一套：深海军蓝底 `#07121E`，暖白文字，香槟金 `#C9A468` 作强调色。不提供切换入口，部署到哪里都是同一副样子。

## 抽签逻辑

- 名单在页面加载时读取，数量不写死在代码里。
- 中选者由浏览器的 `crypto.getRandomValues` 产生，采用拒绝采样取模，避免取模偏差。
- 滚动动画只负责呈现：末行就是已经确定的中选机构，动画过程中不会改变结果。
- 动画只改变 `transform` 与 `opacity`；系统开启「减少动态效果」时直接落定，不播放滚动。

## 只读演示（GitHub Pages）

仓库开启 GitHub Pages 后，`tender-draw/` 可以直接在浏览器里看：

```
https://peanut-rice.github.io/workspace/tender-draw/
```

同一份 `index.html` 会自动识别运行环境：

- 有 Node 服务（`api/companies` 可用）：走接口读写，顶部显示「修改名单」；
- 纯静态托管：自动改读同目录的 `companies.json`，只读展示，隐藏「修改名单」。

Pages 上没有后端，所以改名单要么改文件后重新提交，要么按上面的方式用 Node 服务运行。

## 兼容性与界面

- Chrome、Edge、Safari 近期版本；桌面与手机浏览器都可直接使用。
- 手机上抽签台与按钮在首屏，名单排在其后，不需要先滚动。
- 页面不引用 CDN、在线字体或任何外部资源，图标为内联 SVG；无 cookie、无第三方请求，可在内网离线运行。
- 界面面向业务人员，不展示文件名、接口等技术细节；技术信息只出现在服务端日志与浏览器控制台。
