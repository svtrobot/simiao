# 账号：保存修行

对应设计文档 2.1：游客即可进入、即可玩；第一次有值得留下的东西时（功德 ≥ 10，或安放了第一个灵位），才轻轻提一次「要保存下来吗」，每台设备只提一次。

## 为什么先做这两种

游客身份是存在浏览器里的一个令牌。清掉浏览数据或换手机，功德、点的灯、家堂里的灵位与照片就找不回来了。手机号、Google、Apple、LINE 登录都要先在各平台申请凭证，所以先做两种**不依赖任何外部服务、也不收集个人资料**的方式：

| 方式 | 用户做什么 | 服务器存什么 |
|---|---|---|
| 通行密钥（WebAuthn passkey） | 指纹 / 面容解锁一次；跟着 iCloud 钥匙串或 Google 密码管理器同步到新手机 | 公钥（JWK）、算法、签名计数、设备标签 |
| 恢复码 | 抄下或截图 `XXXX-XXXX-XXXX-XXXX`（80 位随机） | 恢复码的 SHA-256；原文只显示一次 |

没有电话、没有 email、没有密码。

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/account` | `{ saved, passkeys[], recovery }` |
| POST | `/api/account/recovery` | 生成（或替换）恢复码，返回 `{ code }`，旧码立即失效 |
| POST | `/api/account/restore` | `{ code }` → 新设备的 `{ token, user }`；每个地址 10 分钟内最多 10 次 |
| POST | `/api/account/passkey/options` | 注册参数（`residentKey: required`，`attestation: none`） |
| POST | `/api/account/passkey` | 提交 `navigator.credentials.create()` 的结果 |
| POST | `/api/account/passkey/:id/remove` | 移除一把通行密钥 |
| POST | `/api/account/login/options` | 登录参数（可发现凭证，不需要先输入什么） |
| POST | `/api/account/login` | 提交 `navigator.credentials.get()` 的结果 → `{ token, user }` |
| POST | `/api/account/signout` | 注销这台设备的令牌，其他设备不受影响 |

二进制字段一律 base64url。

## 校验（`server/domain/accounts.js`，零依赖）

- 自写 CBOR 解码（只支持 WebAuthn 用到的子集）与 COSE → JWK（ES256 / RS256），签名用 `node:crypto` 验。
- challenge 32 字节随机、5 分钟有效、只能用一次，且区分注册 / 登录；注册的 challenge 绑定当前用户。
- `clientDataJSON.origin` 必须等于站点来源，`rpIdHash` 必须等于 `sha256(rpId)`，必须有用户在场（UP）标志。
- 不验证 attestation 声明（我们只要公钥，不关心设备型号）。
- 签名计数：同步型通行密钥恒为 0；硬件钥匙的计数倒退视为可能被复制，拒绝登录。
- challenge 与限速目前在进程内存里（单实例）；多实例时随 Redis 一起迁移（`docs/ARCHITECTURE.md`）。

## 部署注意

- 通行密钥只在 **HTTPS**（或 `localhost`）下可用。线上请设置 `PUBLIC_ORIGIN=https://你的域名`：通行密钥会绑定到这个域名，**换域名后旧通行密钥无法使用**（恢复码不受影响）。
- 不设 `PUBLIC_ORIGIN` 时，以请求自身的 Host（与反向代理传来的 `X-Forwarded-Proto`）判断来源，适合本地开发。
- 在新设备上登录时，这台设备原来的游客进度不会合并，留在原处。

## 之后

手机号 / Google / Apple / LINE 登录接在同一层：凭证表指向同一个 `userId`，登录成功一样调用 `users.issueToken()`。支付（P1）要求账号已保存，以免付费内容随着游客令牌丢失。
