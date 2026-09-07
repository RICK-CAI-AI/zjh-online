# 部署到免费云平台（Render）· 好友点链接即玩

目标：把牌局变成一个公网 HTTPS 网址（如 `https://zjh-online.onrender.com`），发给
好友，他们手机/电脑点开就能玩，**不用装任何 App、不用加网络**。

部署物只需要 3 个文件：`server.js`、`package.json`、`public/index.html`
（其余都是本机测试/穿透用的，不用传）。

---

## 路径一：不用装 Git（纯网页操作，约 8 分钟）

### 1. 建 GitHub 仓库（存代码用，免费）
1. 打开 https://github.com → 注册/登录（可用邮箱，或用 Google/GitHub 账号）
2. 右上角 **＋ → New repository**
3. Repository name 填 `zjh-online`，选 **Public**（必须 Public，Render 免费版才能连）
4. 不要勾任何初始化选项 → **Create repository**

### 2. 上传这 3 个文件
在新建的空仓库页面，点 **"uploading an existing file"** 链接，然后：
- 把本项目的 `server.js` 拖进去
- 把 `package.json` 拖进去
- 把 `public` 文件夹整个拖进去（会保留 `public/index.html` 结构）
> 也可以直接在文件管理器里选中这三个，一起拖到网页上传区。
- 页面底部点 **Commit changes**

### 3. 部署到 Render（免费）
1. 打开 https://render.com → **Sign Up**（用 GitHub 账号授权最省事）
2. 登录后点 **New + → Web Service**
3. 选 **Connect a repository** → 授权 GitHub → 选中 `zjh-online` 仓库
4. 配置（基本都自动填好了）：
   - Name：`zjh-online`
   - Runtime：**Node**
   - Build Command：`npm install`
   - Start Command：`npm start`
   - Plan：**Free**
5. 点 **Create Web Service**
6. 等 1～2 分钟，日志出现 `炸金花服务端已启动` 即成功
7. 顶部拿到网址，形如 **`https://zjh-online.onrender.com`** ← 这就是邀请链接

### 4. 发给好友
把 `https://zjh-online.onrender.com` 发群里，好友：
- 手机/电脑浏览器打开
- 填房间号 + 昵称 → 进房
- 你是房主，点「开局」

⚠️ Render 免费版**闲置 15 分钟后会休眠**，好友第一次打开可能要等 **20~40 秒**唤醒
（之后就快了）。开玩前你先自己点开一次预热即可。

---

## 路径二：你给我 GitHub Token，我代你推送（更省事）

如果你愿意：
1. GitHub → Settings → Developer settings → Personal access tokens → **Tokens (classic)**
2. 生成 token，勾 **repo** 权限，复制那串字符
3. 把 token 发给我，并告诉我仓库名（或让我新建）
4. 我帮你 `git push` 这 3 个文件，剩下的你在 Render 点几下连仓库即可

（token 用完可随时在 GitHub 撤销，安全。）

---

## 常见问题

**Q：能改网址吗？**
A：Render 里点服务 → Settings → Rename 可改前缀；或绑自己的域名（需付费域名）。

**Q：好友能随便进吗？**
A：只有知道**房间号**的人能进同一桌，陌生人进不来你的牌局。房间号自己定。

**Q：免费版够用吗？**
A：9 人牌局、WebSocket 实时同步，免费 512MB 内存完全够。就是会休眠。

**Q：不想用 Render 了？**
A：删掉 Render 服务即可，代码还在你 GitHub 里，随时可换 Railway / Fly.io 等。
