# 付费道具与支付

对应设计文档第七章：**「参拜永久免费，付费只买仪式感和沉浸度，不卖灵验。」**

## 现在卖什么

目录在 `content/shop/catalog.json`（价格是设计文档的建议值换算，**上线前由营运确认**）：

| 商品 | 台湾 | 海外 | 买到什么 |
|---|---:|---:|---|
| 高香 · 十炷 | NT$120 | US$3.99 | 背包 +10 高香：比清香高一截、烟更长 |
| 龙凤香 · 五炷 | NT$150 | US$4.99 | 背包 +5：一炷粗长的大香 |
| 纸扎一套 | NT$90 | US$2.99 | 纸扎屋、纸扎车各一，寒衣两件 |
| 寒衣 · 十件 | NT$60 | US$1.99 | 背包 +10 |
| 续灯一个月 | NT$30 | US$0.99 | 指定的那盏灯多亮 30 天 |
| 描金灵位 · 长明灯 | NT$300 | US$9.99 | 指定的灵位描金，前面的灯长明 |

一直免费的：每日三炷清香、银纸 / 元宝 / 莲花、献花供果点烛、点灯（七天一续）、设灵位、求签、静坐、抄经。

- 商品是**包**，买到进**背包**；不做储值余额（避免被理解成「功德充值」，也避开储值监管）。
- 免费灵位不会过期。「永久灵位」目前只是描金与长明灯；要不要给免费灵位设期限是产品决定，没有替你做。

## 红线（都由程序守着）

| 规则 | 怎么守 |
|---|---|
| 付费不加功德 | 购买、发放、使用都不碰 `practice`；付费香不发 `merit`、不占免费额度。`test/shop.test.js` |
| 不做抽卡 | 目录校验拒收 `chance` / `random` / `odds` / `pool` 字段；`grants` 必须是固定数量 |
| 不卖灵验 | 商品名称与说明过禁语表；有禁语时整份目录拒收，服务不启动 |
| 单日消费上限 | 每账号 24 小时内 NT$600 / US$20（目录里的 `dailyCap`） |
| 明示效力 | 商店面板固定一行说明 |
| 大陆不开 | `REGION=cn` 时商店关闭，目录为空 |

## 怎么收款

`PAYMENTS` 环境变量决定通道；不设就只显示价格、不能购买。

| `PAYMENTS` | 用途 |
|---|---|
| （空） | 不贩售 |
| `sandbox` | **只供本机测试**：点「完成测试付款」就算付了，不扣款。线上不要设 |
| `stripe` | Stripe Checkout（跳到 Stripe 的页面付款，我们不经手卡号）。需要 `STRIPE_SECRET_KEY`、`STRIPE_WEBHOOK_SECRET` |

接 Stripe 要做的：
1. 注册 Stripe，拿到 Secret key（先用 `sk_test_…` 测试密钥）。
2. 在 Stripe 后台新增 webhook：地址 `https://你的域名/api/pay/stripe/webhook`，事件勾选 `checkout.session.completed` 与 `charge.refunded`，拿到 Signing secret（`whsec_…`）。
3. 设置 `PAYMENTS=stripe`、两把密钥、`PUBLIC_ORIGIN`（付款完成后跳回的地址）。
4. 用 Stripe 的测试卡号走一遍。**这条通道目前只用模拟请求测过（请求内容、签名校验、重复通知、退款），没有用真实密钥跑过。**

台湾在地支付（绿界、LINE Pay）是同样形状的第三个通道：实现 `checkout()` 与 `webhook()` 两个函数（`server/domain/payments.js`）。

## 结构

- `server/domain/shop.js`：目录校验、下单、付款到账后的发放、退款收回、背包。
- `server/store/ledger.js`：订单账本。PostgreSQL 模式用 `orders` 表和条件 UPDATE——`pending → paid` 只会成功一次，发放也只会被一个实例认领；**不走文档同步的「后写者胜」**。单机模式写在 JSON 存储里。
- `server/domain/payments.js`：通道（沙盒、Stripe）。Stripe 的 webhook 校验 `Stripe-Signature`（HMAC-SHA256，5 分钟内有效）。
- `client/src/shop.js`：商店面板。入口：上香面板「请高香」、烧纸托盘「请纸扎」、灵位「描金 · 长明灯」、我的灯「续一个月」、我的修行「供养」。

接口：`GET /api/shop`、`POST /api/shop/orders`、`GET /api/shop/orders[/:id]`、`POST /api/shop/sandbox/:id/pay`（仅沙盒）、`POST /api/pay/stripe/webhook`。

## 后台：订单与退款

`/admin`（需要 `ADMIN_TOKEN`）的「订单与退款」：

- 近 24 小时 / 近 30 天的收款与退款合计；订单列表可按状态、账号 ID 筛选（最新 100 笔）。
- 「退款」是**整笔退回**，要填原因（记在账上）。顺序是：先让支付通道把钱退回原付款方式 → 成功后才改账 → 再从背包收回道具（续灯减回 30 天、描金取消）。通道拒绝时什么都不变。
- 已用掉的道具不追回（背包不会变成负数）；功德不受退款影响；退掉的金额不再占用户的 24 小时消费上限。
- 同一笔订单只能退一次；Stripe 之后送来的退款通知（或在 Stripe 后台直接退款）走同一条路，重复无害。
- 没开支付通道、或订单属于另一个通道时，只能查看不能退款。
- 接口：`GET /api/admin/orders?status=&user=&limit=`、`POST /api/admin/orders/:id/refund`（`{ reason }`）。

还没有：部分退款、未付款订单的清理、操作人记录（后台只有一把共用令牌，日志里只记了哪笔订单被退）。

## 已知不足

- 发放是「认领后立刻写背包」：认领成功到写入之间进程崩溃会漏发一次（概率极低）。对账可用 `orders` 表里 `status = 'paid' AND granted` 与背包比对。
- 背包在用户文档里，多实例下仍是「后写者胜」（粘性负载均衡下不会冲突）；金额与订单状态不受影响。
- 没有发票 / 收据、没有订阅（会员「常住」在 P2）。
