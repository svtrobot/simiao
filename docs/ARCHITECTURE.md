# 架构

## 现在（P0 原型）

```
浏览器 (three.js, ES Modules)
   │  HTTPS  /api/*            JSON：会话、寺庙、签、愿望、开庙、后台
   │  WSS    /ws?temple=&token= 房间同步：10 Hz 增量
   ▼
Node 单进程（零依赖）
   ├── http.js            路由 + 静态文件
   ├── realtime/ws.js     RFC 6455 WebSocket
   ├── realtime/lobby.js  分线：按容量切房间、全寺统计、影子同修
   ├── realtime/room.js   权威房间：位置 / 动作 / 座位 / 仪式事件
   ├── domain/*           功德、签、香火、愿望、开庙、场景、合规
   └── store/jsonStore.js 每个集合一个 JSON 文件
```

为什么零依赖：原型阶段要能在任何有 Node 的机器上直接跑，部署和审计都简单。模块边界按设计文档第六章的目标架构切分，所以升级是替换实现而不是重写。

## 升级路径（P1）

| 现在 | P1 替换为 | 替换范围 |
|---|---|---|
| `realtime/ws.js` + `room.js` | Colyseus Room（状态 schema 增量同步） | `Room` 的公开行为（join / 消息 / tick）保持；协议见 PROTOCOL.md |
| `lobby.js` 内存统计 | **已完成**：Redis 汇总在线数、房间数、影子同修（`realtime/cluster.js`）；香火改为每实例计数求和 | `templeStats` / `recentSitters` 读汇总值 |
| `store/jsonStore.js` | **已完成**：`store/pgStore.js`（内存工作集 + PostgreSQL 落库 + Redis 同步），设 `DATABASE_URL` 启用；见 CLUSTER.md | 仓储接口 `get / put / list / update / remove` 不变 |
| `http.js` 路由 | NestJS 控制器（账号、支付、背包、租户、内容、审核） | 路由路径不变 |
| 游客令牌 | 正式账号（手机 / Google / Apple / LINE），令牌并入账号 | `UserService.session` |
| 服务端日志 | ClickHouse 行为分析（北极星：周参拜用户） | 新增 |

多实例已可用（`docker-compose.cluster.yml`，两实例 + Nginx 粘性负载均衡，停一个另一个继续服务，见 CLUSTER.md）；单进程实测 10,000 人同时在线、5 分钟零掉线（docs/LOADTEST.md）；先碰到的是出口带宽（每人约 2 KB/s）。

## 客户端

- **场景包加载**（`world/scene.js` → `loadPackage`）：`render.builder` 为程序化构建器，`render.gltf` 走 GLTFLoader，`render.splat` 是预留的高斯泼溅远景层。
- **泥生**（`avatar/nisheng.js`）：形体分为下身 / 上身（腰部为枢轴，可前折到五体投地）/ 头（颈部点头）；手臂用两骨 IK 追手的目标位置。釉色、冰裂、兔毫、金缮线、指纹全部在着色器里按参数生成。
- **画质分档**（`env.js`）：低端机关阴影、降像素比、减粒子。
- **three.js 来源**：import map 指向 `/vendor/three/`。执行过 `npm run vendor:three` 就由本服务器提供；否则服务器 302 到 jsDelivr 的固定版本。

## 性能实测（`npm run loadtest`）

| 场景 | 结果 |
|---|---|
| 250 人进同一座寺 | 自动分为 3 个房间，1.2 秒内全部连上 |
| 30% 的人在走动、其余静坐（大殿常态） | 每人下行 1.9 KB/s（预算 ≤ 2 KB/s） |
| 所有人同时不停走动（极端） | 每人下行 4.9 KB/s |

带宽来自紧凑编码：每个房间给成员一个短编号，坐标量化到 10 cm，走动时只发位置（5 Hz），动作或座位改变时才发完整字段。

## 待办（P1 性能）

- 他人的泥生是只跑 IK 的骨架（rig），由 `client/src/avatar/crowd.js` 按「部件 × 釉类 × 远近」合并成 GPU 实例化批次绘制，釉色 / 冰裂 / 金缮走实例属性；名牌合成一张图集一次画完。96 人同殿实测整帧 1,694 → 148 draw calls（大殿本身约 100），三角面 128 万 → 55 万（12 米外用半细分模型）。自己的泥生仍是完整网格与阴影。姿态仍在 CPU 上算（每尊约 20 个矩阵），远处与画面外的泥生隔帧更新；若真机上 CPU 成为瓶颈，再把弯腰 / 点头 / 手臂移到顶点着色器。
- 远处化身降为低模 LOD；名字牌合并为一张图集。
