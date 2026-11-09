# 实时协议（WebSocket，JSON 文本帧）

连接：`/ws?temple=<代号>&token=<会话令牌>`。令牌由 `POST /api/session` 取得。

## 客户端 → 服务器

| `t` | 字段 | 说明 |
|---|---|---|
| `mv` | `x, z, ry` | 位置与朝向，客户端节流到 ≤ 5 次/秒；服务器校验步行区域与速度，过快会回 `fix` |
| `act` | `a` | 动作：`idle walk pray bow prostrate incense muyu bead fortune wish`（仪式类在文化模式下被忽略） |
| `sit` / `stand` | `seat` | 坐到蒲团 / 起身；静坐每满 1 分钟由服务器记 1 分功德 |
| `rit` | `k` | 仪式计数：`incense`（每日 3 炷）`muyu`（10 声 = 1 功德）`bead`（108 颗 = 3 功德）`bow` |
| `greet` | `to?, k` | 预设致意：`gassho bow rejoice wellwish` |
| `ping` | `c` | 应用层心跳 |

每个连接限速 30 条/秒（令牌桶），超限丢弃，持续超限断开（4008）。

## 服务器 → 客户端

### `welcome`
```json
{ "t": "welcome",
  "you":  { "id", "name", "rank", "merit", "minutes", "look": { "stage", "kiln", "cracks", "gold", "seed" } },
  "room": { "id", "temple", "scene", "mode": "ritual|cultural", "capacity", "tickHz", "actions": [...] },
  "members": [ { "id", "n", "name", "look", "rank", "x", "z", "ry", "a", "seat" } ],
  "shadows": [ { "seat", "look" } ],
  "stats":   { "online", "rooms", "incense", "lamps" } }
```
`n` 是房间内的短编号，用于下面的增量。`actions` 是动作码表（只追加，不重排）。

### `tick`（10 Hz，仅在有变化时发送）
```json
{ "t": "tick", "s": 42,
  "u": [ [n, x10, z10],                         // 走动中：仅位置（5 Hz），朝向由移动方向推算
         [n, x10, z10, ry50, actionCode, seat] ], // 动作 / 座位变化：完整字段，seat 为场景座位序号，-1 表示未坐
  "j": [ 完整成员 ],   // 新加入
  "l": [ n ],          // 离开
  "e": [ { "k": "incense", "id" }, { "k": "greet", "from", "to", "kind" }, { "k": "bow", "id" }, { "k": "look", "id", "look", "rank" } ] }
```
坐标 = 整数 / 10（米），朝向 = 整数 / 50（弧度）。座位序号对应 `GET /api/temples/:slug` 返回的 `scene.seats` 顺序。

### 其他
| `t` | 说明 |
|---|---|
| `stats` | 每 5 秒：全寺在线、房间数、今日香火、灯墙上的灯数、影子同修；有人点灯时立即补发一次，客户端据 `lamps` 变化重画灯墙 |
| `merit` | 只发给本人：`action, gained, merit, minutes, rank, look?`（`look` 出现表示阶位提升，泥生换釉） |
| `fix` | 服务器纠正的位置 |
| `err` | `seat_taken`、`incense_daily_limit`、`not_in_this_mode` 等 |
| `pong` | 心跳回应 |

### 关闭码
`4000` 闲置 30 分钟 · `4001` 同一账号在别处登录 · `4008` 消息过快 · `4401` 需要会话 · `4404` 寺庙不存在
