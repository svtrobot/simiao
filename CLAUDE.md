# 云上寺（simiao）· 项目说明

给在本仓库工作的 Claude / 开发者。先读这一页，再读 `docs/design/云上寺-全面开发设计规划.md`。

## 这是什么

手机浏览器打开即进入的多人在线 3D 寺院：静坐、上香、求签掷筊、木鱼、念珠、祈愿牌；每房间 100 人同殿、只有预设致意没有文字聊天；招牌化身「泥生」；后续开放机构「代理开庙」（SaaS）。
首发台湾与海外华人（界面繁体），大陆版是独立部署、只开文化参访模式。

当前进度：**P0 原型已完成**（见 `docs/ROADMAP.md`），内测服务器已上线 https://yunbaifo.com （单实例，2026-11-13）。下一步是找种子用户、继续 P1。

## 运行

```bash
npm start            # http://localhost:8787 （Node ≥ 20，零 npm 依赖）
npm test             # 70 项测试（其中 5 项需要真的 PostgreSQL / Redis，没设 TEST_DATABASE_URL 时跳过），必须全部通过再提交
npm run loadtest     # 压测
docker compose up -d --build   # 容器方式（单实例）
docker compose -f docker-compose.cluster.yml up -d --build   # PostgreSQL + Redis + 两实例 + Nginx（:8797）
```
后台 `/admin` 需要环境变量 `ADMIN_TOKEN`。画质 `?q=low|med|high`，天色预览 `?hour=20`。

## 结构

- `server/` Node 服务，**零依赖**：`realtime/`（自实现 WebSocket、房间、分线）、`domain/`（功德、签、香火愿望、开庙、场景注册表、合规）、`store/`（默认 JSON 快照 + 追加日志；设 `DATABASE_URL` / `REDIS_URL` 后换成 `pgStore.js`：内存工作集 + PostgreSQL 落库 + Redis 同步，客户端 `pg.js` / `redis.js` 自写零依赖）
- `client/` 浏览器端，原生 ES Modules + three.js 0.170（import map 指向 `/vendor/three/`，未自托管时服务器 302 到 jsDelivr），**没有构建步骤**
  - `src/world/` 场景包加载、程序化大殿 `temple.js`（建筑语汇 `styles.js`：中式 / 韩式山寺 / 神社，柱位等共用布局在 `layout.js`）（佛像与胁侍 `statue.js`、殿内陈设 `interior.js`、远山松林院墙放生池 `landscape.js`）、天色季节 `env.js`、碰撞 `collide.js`、烟与落花 `fx.js`
  - `src/avatar/nisheng.js` 泥生（形体、五阶段釉色着色器、IK 动作）
  - `src/rituals.js` 各仪式交互（含点灯与祈福卡）；黄历面板 `src/almanac.js`（历法计算在服务端 `server/domain/almanac.js`，零依赖：农历用 Intl chinese 历，节气用太阳黄经）；灯墙 `src/world/lampwall.js`；禅房 `src/zen.js` + `src/world/chamber.js`（单人场景，离开房间连接，分钟走 `/api/zen` 心跳）；抄经描红 `src/copy.js`（底本 `content/copy/texts.json`，服务端 `server/domain/copying.js` 限速计功德）；祖先堂 `src/ancestors.js` + `src/world/ancestral.js`（私人家堂，离开房间连接；服务端 `server/domain/ancestors.js`：家堂、灵位、忌日提醒、献供、寄语、烧纸限速）；`src/net.js` 房间客户端（插值）
- `admin/` 平台后台 · `scenes/` 场景包 · `content/` 签诗 · `docs/` 文档 · `test/` · `tools/`

## 必须遵守的规则（来自设计文档，不要改）

1. **功德买不到**：功德只由服务器根据静坐、礼拜、仪式计算，限速 + 本地日封顶（`server/domain/practice.js`）。任何付费道具都不加功德；签文好坏与付费无关；不做抽卡。
2. **合规模式**：`REGION=cn` 或场景/寺庙为 `cultural` 时，仪式（上香、求签、木鱼、念珠、礼拜）在客户端隐藏、在服务器拒绝——两边都要改，见 `docs/COMPLIANCE.md`。大陆不开自助开庙。
3. **开庙名称**：自称寺/庙/宫/观/神社须附登记证，否则只能是「文化空间」；禁止“消灾、改命、保证灵验、功德充值”等用语。
4. **心理安全**：用户内容里出现自伤念头 → 不公开、只回本人温和话语 + 当地热线。不要删掉这条逻辑。
5. **社交**：只有预设致意（合掌 / 顶礼 / 随喜 / 愿你安好），不加自由文字聊天。
6. **泥生设定**：无嘴、闭眼弧线、心灯、袈裟**搭左肩（偏袒右肩）**、毡灰下摆、背后指纹；五阶段 素坯→素烧→施釉→窑变→金缮。参考图在 `docs/design/character/`。
7. **场景是数据**：新景点 = `scenes/<id>/manifest.json`，不为某个景点写专用代码；性能预算超标会被拒收（`docs/SCENE_PACKAGE.md`）。
8. **协议**：房间增量是紧凑数组编码（`docs/PROTOCOL.md`），动作码表只追加不重排。改协议要同时改 `server/realtime/room.js`、`client/src/net.js` 和文档。

## 已知限制 / 待办

- 3D 画面已在电脑浏览器（含手机尺寸模拟）验证可正常渲染；线上版已有一台真实手机看过、画面正常（2026-11-13）；**中低端机型、通行密钥与推送还没在真机上逐项验证**。
- 数据层两种模式（`docs/CLUSTER.md`）：默认单机 JSON；`DATABASE_URL` + `REDIS_URL` 时为多实例。**存储接口是同步的**：每个实例把全部数据放在内存里，改动 200 ms 内落 PostgreSQL 并经 Redis 同步给其他实例，按文档「后写者胜」。因此：必须用粘性负载均衡（`deploy/nginx.cluster.conf`）；新的跨实例状态不要放在进程内存的 Map 里（放 store，或 `challenges` 那样的不落库集合）；计数器用「每实例一份、读时求和」；**涉及金钱的数据不要走这条路**，用 PostgreSQL 事务。单进程压测 10,000 人在线 5 分钟零掉线（`docs/LOADTEST.md`）。
- 账号：游客令牌 + 「保存修行」（通行密钥 / 恢复码，`server/domain/accounts.js` + `client/src/account.js`，见 `docs/ACCOUNTS.md`）；不收集电话、email。手机号 / Google / Apple / LINE 登录与支付要先拿到各平台凭证。线上必须 HTTPS 并设置 `PUBLIC_ORIGIN`，否则通行密钥不可用。提醒走 Web Push（`server/domain/push.js` + `client/sw.js`，见 `docs/NOTIFICATIONS.md`）：早 8 点黄历、前一晚与当天的忌日 / 清明、睡前静坐，一天最多两则；VAPID 金钥存在数据里，备份时一起备份。灵位照片存在 JSON 存储里（单张 ≤ 90 KB），上 PostgreSQL 时改对象存储。
- 他人的泥生是只跑 IK 的骨架（rig），由 `client/src/avatar/crowd.js` 按「部件 × 釉类 × 远近」合并成 GPU 实例化批次绘制，釉色 / 冰裂 / 金缮走实例属性；名牌合成一张图集一次画完。96 人同殿实测整帧 1,694 → 148 draw calls（大殿本身约 100），三角面 128 万 → 55 万（12 米外用半细分模型）。自己的泥生仍是完整网格与阴影。改泥生的部件或材质时，`nisheng.js` 的 slot 名与 `crowd.js` 的材质表要一起改。
- 付费道具（`docs/PAYMENTS.md`）：目录 `content/shop/catalog.json`、`server/domain/shop.js`、订单账本 `server/store/ledger.js`（PostgreSQL 模式走事务）、通道 `server/domain/payments.js`（沙盒 / Stripe）、客户端 `client/src/shop.js`。不设 `PAYMENTS` 就不卖；`PAYMENTS=sandbox` 只用于本机测试。规则 1 在这里用代码守着：目录校验拒收 `merit` 与任何随机字段，买与用都不碰功德。价格是设计文档建议值，待营运确认；Stripe 通道没用真实密钥跑过。
- 签诗是原创示例 12 签，需文化顾问审阅。

## 资料

- 设计规划（在线版含图表）：https://claude.ai/artifact/SUG1uj71RSVjmgsHgkP9mz
- 泥生角色设计画布：https://claude.ai/artifact/GrDZPYCoFzzc1aoaAf5Cyn
- GitHub：https://github.com/svtrobot/simiao

## 风格

- 代码注释：英文为主，与设计相关的规则可写中文并注明设计文档章节号。
- 用户界面文字放 `client/src/i18n.js`，繁体为主、简体覆盖。
- 不引入构建工具和大型框架，除非按 P1 计划替换对应模块。
