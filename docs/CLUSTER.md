# 多实例部署：PostgreSQL + Redis

单机模式（JSON 文件）仍是默认：什么都不设就是它。设了 `DATABASE_URL` 才切到 PostgreSQL，再设 `REDIS_URL` 才能跑多个实例。

| 环境变量 | 结果 |
|---|---|
| （都不设） | 单实例，数据在 `DATA_DIR` 的 JSON 快照 + 追加日志 |
| `DATABASE_URL` | 单实例，数据在 PostgreSQL |
| `DATABASE_URL` + `REDIS_URL` | 多实例：PostgreSQL 存数据，Redis 把实例连起来 |

```bash
# 本机起一套：PostgreSQL、Redis、两个实例、Nginx
docker compose -f docker-compose.cluster.yml up -d --build
# http://localhost:8797（经 Nginx）；两个实例各自在 8791 / 8792
```

连接串：`postgres://用户:密码@主机:5432/库?sslmode=require`（托管数据库用 `require` 或 `verify-full`）、`redis://[:密码@]主机:6379[/库号]` 或 `rediss://`（TLS）。`INSTANCE_ID` 每个实例不同（不设则随机）。

## 怎么工作

领域服务读数据是同步的（`store.get(...)` 直接返回），所以存储接口没变，换的是后面那层（`server/store/pgStore.js`）：

- **内存**：每个实例启动时把数据从 PostgreSQL 分页载入内存，读永远不等。
- **PostgreSQL**：改动过的文档每 200 ms 成批 upsert（一张表 `docs(col, id, doc jsonb, v, writer, updated_at)`）。
- **Redis 发布订阅**：实例把自己的改动发出去，其他实例几毫秒内应用。
- **补漏**：每 10 秒各实例再读一遍「最近 30 秒别人改过的行」，Redis 消息丢了也会追上。
- **冲突**：按文档「后写者胜」，顺序是（版本号, 实例号），内存里和 SQL 的 `WHERE` 里用同一条规则，所以各实例和数据库最后一定一致。
- 远端改动是**原地更新**同一个对象——房间里拿着用户文档的引用，不能换成新对象。

Redis 还负责（`server/realtime/cluster.js`）：
- **在线人数与影子同修**：每个实例每 2 秒写一次自己的各寺人数、房间数、最近静坐者，8 秒过期；实例挂了就自动从总数里消失。
- **单点任务锁**：推播提醒每分钟只由拿到锁的那个实例跑，不会重复提醒。

另外几处为多实例改过的地方：
- 香火计数：每个实例只写自己的计数文档，读取时求和，并发上香不会互相覆盖。
- 通行密钥的 challenge：放在「只同步、不落库」的集合里，A 实例发的 B 实例能验。
- 推播金钥：第一个启动的实例写入，其他实例用同一把（`store.ensure`）。

房间本身不跨实例：一个房间 100 人，落在哪个实例对房间里的人没有区别。

## 必须做的：粘性负载均衡

`deploy/nginx.cluster.conf` 用 `ip_hash`：同一个人的 WebSocket 和 HTTP 请求落在同一个实例。这样一个人的文档只在一个实例上被改，「后写者胜」只是兜底；禅房的计时会话（存在实例内存里）也不会断。
前面有 HTTPS 终结时，把 `X-Forwarded-Proto` 传成 `https`，并设置 `PUBLIC_ORIGIN`（通行密钥要核对来源）。

## 已验证（2026-11-10，本机）

- 在 A 建的访客、点的灯，B 立刻读得到；在 B 建的家堂与灵位，A 读得到；A 殿里有人，B 报的在线数包含他。
- WebSocket 经 Nginx 正常升级。
- 停掉 A：经负载均衡的请求全部由 B 响应，数据都在，还能继续点灯；A 重启后从 PostgreSQL 载回，包含它停机期间别人写的内容。
- 测试：`test/cluster.test.js`（两个存储实例互相同步、并发写收敛、漏消息补回、两个完整应用实例共享账号 / 灯 / 香火 / 在线数）。需要真的服务才跑：

```bash
docker run -d --name simiao-test-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=simiao -p 55432:5432 postgres:16-alpine
docker run -d --name simiao-test-redis -p 56379:6379 redis:7-alpine
TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/simiao TEST_REDIS_URL=redis://localhost:56379 npm test
```

## 从单机迁过来

```bash
DATA_DIR=./data DATABASE_URL=postgres://… node tools/json-to-pg.mjs   # 已有的行不会被覆盖，可重复跑
```

## 大集合

用户多了以后先出问题的不是内存，而是**每个请求都在扫整张表**（「我在哪些家堂里」要看遍所有家堂）。服务器是单线程，一个人扫表时其他人都在等。`node tools/bench-store.mjs --users 100000` 的实测（一位用户从进殿到打开家堂要做的几次查找合计）：

| 用户数 | 之前 | 现在 |
|---:|---:|---:|
| 10 万 | 8.5 ms | 0.15 ms |
| 100 万 | 135 ms | 3.6 ms（几乎全是「列出这座寺 25,000 盏亮着的灯」） |

做了三件事，存储接口（`get / put / list / remove`）不变：

1. **索引**（`server/store/indexes.js`）：`store.index(集合, 名字, 取键函数)` 声明一次，`store.by(集合, 名字, 键)` 直接取。跟着 `put` / `remove` 和其他实例同步过来的改动更新。祈愿墙是「每座寺最新 60 块」的有序索引，不排序、不扫表。索引让内存多用约一半。
2. **照片按需读取**：灵位照片（单张最多 90 KB）以前放在灵位文档里，于是常驻内存，而且每献一次花就把 90 KB 重写一遍、再经 Redis 发给其他实例。现在照片在 blob 存储里（单机是 `data/blobs/photos/` 下一个文件一张；PostgreSQL 是 `blobs` 表），只有打开灵位时才读。旧数据在启动时自动搬过去。
3. **熄了的灯归档**：熄灭超过 2 天的灯每小时搬到 `lamps_old`（保留，不删除；祈福卡链接仍会显示「这盏灯已经熄了」）。单机模式下这个集合平时不载入内存。

写新功能时：**请求路径上不要用 `store.list(集合, 过滤函数)`**，先声明索引再用 `store.by`。后台、每分钟一次的定时任务可以扫。目前仍在扫表的：后台的内容 / 账号列表、清明统计（缓存一分钟）、推送排程（每分钟一次）。

另外修了一个启动问题：两个实例同时在空数据库上启动时，会抢着建表而其中一个失败；现在建表先取咨询锁。

## 限制（如实）

- **文档仍然都在每个实例的内存里**（见下面「大集合」）。实测每位用户连同他的灵位、祈愿牌、灯和索引约 1.2 KB：10 万用户约 130 MB，100 万约 1.2 GB。账号本身（`users` / `tokens`）还没有做成按需载入——要改就得把存储接口从同步改成异步，牵动所有业务代码；在 100 万用户之前不需要。
- 写入是「先内存、200 ms 内落库」：实例崩溃会丢它最后 200 ms 的改动（与单机模式相同）。
- 两个实例在几毫秒内改同一份文档时，整份文档后写者胜，先写的那次会丢——靠粘性负载均衡避免，不是靠事务。**涉及金钱的数据（P1 支付）不能走这条路**，要用 PostgreSQL 事务单独做。
- PostgreSQL 与 Redis 的客户端是自写的最小实现（`server/store/pg.js`、`redis.js`，零依赖）：单连接、SCRAM-SHA-256 / MD5、可选 TLS。不支持连接池、Redis Cluster / Sentinel；需要时换成 `pg` / `ioredis`，对外只有 `query()`、`command()`、`subscribe()` 三个方法。
- 备份：备份 PostgreSQL 即可（推播金钥、灵位照片都在里面）。单机模式要备份整个数据目录，包括 `blobs/`。Redis 里的东西都可以丢。
