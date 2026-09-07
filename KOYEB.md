# 部署到 Koyeb（免绑卡 · 好友点链接即玩）

目标：把牌局变成一个公网 HTTPS 网址（形如 `https://zjh-online-xxxx.koyeb.app`），
发给好友，他们手机/电脑浏览器点开就能玩，**不用装 App、不用加网络**。

为什么选 Koyeb（而不是 Render）：
- 免费档**多数用户不需要信用卡**（仅少数地区验证失败才要，概率低）
- **原生支持 WebSocket**（炸金花实时同步必需，Koyeb 明确支持）
- 从 GitHub 直接部署，代码已在 `RICK-CAI-AI/zjh-online`

---

## 部署步骤（约 8 分钟）

### 1. 注册 Koyeb
1. 打开 https://koyeb.com → 右上角 **Sign Up**
2. 用 **GitHub 账号授权**登录最省事（也会自动连上你的仓库）
3. 若提示绑卡/手机验证：按提示操作即可（预授权 $1 不真扣；多数国内用户免卡）

### 2. 连仓库部署
1. 控制台点 **Create App**（或 **New Service / Deploy**）
2. 选 **GitHub** 源 → 授权 → 选中仓库 **`zjh-online`**
3. 配置（基本自动识别，确认这几项）：
   - **Name**：`zjh-online`
   - **Builder**：留空（Koyeb 自动检测根目录的 `Dockerfile` 构建）
   - **Port**：`8080`（必须填这个，服务端就监听 8080）
   - **Region**：选 **Frankfurt** 或 **Washington, D.C.**（免费档二选一；杭州连 Frankfurt 更近）
   - **Instance type**：**Starter (Free)** — 512 MB / 0.1 vCPU
4. 点 **Deploy**

### 3. 等部署完成
- 约 1~2 分钟，构建日志出现 `炸金花服务端已启动` 即成功
- 顶部拿到网址，形如 **`https://zjh-online-xxxx.koyeb.app`** ← 这就是邀请链接

### 4. 发给好友
把 `https://zjh-online-xxxx.koyeb.app` 发群里，好友：
- 手机/电脑浏览器打开
- 填房间号 + 昵称 → 进房
- 你是房主，点「开局」

---

## 注意事项
- ⚠️ 免费档闲置约 **1 小时会休眠**，开玩前你先自己点开一次预热（首次唤醒 5~15 秒，之后就快了）
- 🌐 杭州连 Frankfurt/Washington 延迟约 **200~300ms**，牌局实时同步够用
- 🔒 部署完成后，去 GitHub **Settings → Developer settings → Personal access tokens** 撤销 `ghp_` 开头的 token（安全）
- 💡 只有知道**房间号**的人能进同一桌，陌生人进不来你的牌局

## 换平台也容易
代码在 GitHub 公开仓库，随时可换 Render / Railway / Fly.io 等，只需改部署配置。
