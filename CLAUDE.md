# 云上寺（simiao）· 项目说明

给在本仓库工作的 Claude / 开发者。先读这一页，再读 `docs/design/云上寺-全面开发设计规划.md`。

## 这是什么

手机浏览器打开即进入的多人在线 3D 寺院：静坐、上香、求签掷筊、木鱼、念珠、祈愿牌；每房间 100 人同殿、只有预设致意没有文字聊天；招牌化身「泥生」；后续开放机构「代理开庙」（SaaS）。
首发台湾与海外华人（界面繁体），大陆版是独立部署、只开文化参访模式。

当前进度：**P0 原型已完成**（见 `docs/ROADMAP.md`）。下一步是部署内测服务器、用真机检查 3D 画面、找种子用户，然后做 P1。

## 运行

```bash
npm start            # http://localhost:8787 （Node ≥ 20，零 npm 依赖）
npm test             # 28 项测试，必须全部通过再提交
npm run loadtest     # 压测
docker compose up -d --build   # 容器方式
```
后台 `/admin` 需要环境变量 `ADMIN_TOKEN`。画质 `?q=low|med|high`，天色预览 `?hour=20`。

## 结构

- `server/` Node 服务，**零依赖**：`realtime/`（自实现 WebSocket、房间、分线）、`domain/`（功德、签、香火愿望、开庙、场景注册表、合规）、`store/`（JSON 文件存储）
- `client/` 浏览器端，原生 ES Modules + three.js 0.170（import map 指向 `/vendor/three/`，未自托管时服务器 302 到 jsDelivr），**没有构建步骤**
  - `src/world/` 场景包加载、程序化大殿 `temple.js`（佛像与胁侍 `statue.js`、殿内陈设 `interior.js`、远山松林院墙放生池 `landscape.js`）、天色季节 `env.js`、碰撞 `collide.js`、烟与落花 `fx.js`
  - `src/avatar/nisheng.js` 泥生（形体、五阶段釉色着色器、IK 动作）
  - `src/rituals.js` 各仪式交互（含点灯与祈福卡）；灯墙 `src/world/lampwall.js`；`src/net.js` 房间客户端（插值）
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

- 3D 画面已在电脑浏览器（含手机尺寸模拟）验证可正常渲染；**还没在真实手机上验证过**。部署后第一件事：中低端手机看一遍，修画面问题。
- 数据是单机 JSON 文件，只能单实例运行；多实例前必须完成 PostgreSQL + Redis（`docs/ARCHITECTURE.md` 有逐项替换表）。
- 账号只有游客令牌；支付、祖先堂、点灯、黄历、烧纸在 P1。
- 100 尊泥生约 1,400 draw calls，P1 改 GPU 实例化（目标 ≤ 150）。
- 签诗是原创示例 12 签，需文化顾问审阅。

## 资料

- 设计规划（在线版含图表）：https://claude.ai/artifact/SUG1uj71RSVjmgsHgkP9mz
- 泥生角色设计画布：https://claude.ai/artifact/GrDZPYCoFzzc1aoaAf5Cyn
- GitHub：https://github.com/svtrobot/simiao

## 风格

- 代码注释：英文为主，与设计相关的规则可写中文并注明设计文档章节号。
- 用户界面文字放 `client/src/i18n.js`，繁体为主、简体覆盖。
- 不引入构建工具和大型框架，除非按 P1 计划替换对应模块。
