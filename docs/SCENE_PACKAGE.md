# 场景包规范（设计文档 6.5）

场景是数据，不是代码。新增景点 = 新增一个文件夹，不改代码、不发版：

```
scenes/<id>/
  manifest.json        必需
  assets/scene.glb     可选：glTF（Draco / Meshopt 压缩，KTX2 贴图）
  assets/*.splat       可选：高斯泼溅远景层（P1 渲染）
```

文件夹名必须等于 `id`。以 `_` 开头的文件夹（如 `_template`）不会被加载。后台「重新载入场景包」或重启服务即可生效；被拒收的包会在后台列出原因。

## manifest 字段

| 字段 | 必需 | 说明 |
|---|---|---|
| `id` | ✓ | 小写字母、数字、短横线 |
| `version` | ✓ | 正整数，每次交付递增 |
| `name` | ✓ | 至少 `zh-Hant`，可加 `zh-Hans`、`en` |
| `culture` | ✓ | 如 `zh-buddhist`、`zh-taoist`、`jp-shrine`、`kr-temple` |
| `regions` | ✓ | 上架地区子集：`tw`、`overseas`、`cn`。大陆景点默认只填 `cn` |
| `complianceModes` | ✓ | `ritual`（宗教仪式）/ `cultural`（文化游览）。列入 `cn` 的场景必须支持 `cultural` |
| `geo` |  | 坐标、省市，供首页寺庙地图使用 |
| `license` |  | `status: original \| licensed`；`licensed` 必须写 `expires`，并附授权书编号与分成方 |
| `render` | ✓ | `builder`（程序化构建器名）或 `gltf` / `splat` 路径，`lods` 为 LOD 列表 |
| `budget` | ✓ | `triangles ≤ 300000`、`drawCalls ≤ 150`、`textureMB ≤ 25`、`firstScreenMB ≤ 3`，超出即拒收（设计文档 6.3） |
| `environment` |  | 天空（跟随本地时间）、季节、雾、环境音、配色 |
| `walkArea` | ✓ | 可行走矩形，服务器据此校验移动 |
| `spawn` | ✓ | 出生点 `x, z, ry` |
| `seatGrid` |  | 蒲团网格 `x0, z0, dx, dz, cols, rows, ry`；展开后的座位数决定房间上限 |
| `slots` | ✓ | 槽位表：`incense_burner fortune_table muyu bell wish_wall lamp_wall seat photo_spot paper_brazier ancestor_hall main_altar gate`；景物 `tree`（古树，可选 `r`）、`pond`（放生池，`w`×`d` 米），两者都会阻挡行走 |

坐标单位为米，`ry` 为朝向弧度（0 = 面向 +z，π = 面向 −z）。

实时服务只读取 `walkArea`、`spawn`、座位和槽位，与模型长什么样无关——所以换模型不用动服务器。

## 交付检查清单

1. 复制 `scenes/_template` 为 `scenes/<id>`，改 `id` 与文件夹名一致。
2. 在 `budget` 中如实填写面数、draw call、贴图与首屏大小。
3. 使用真实景点名称或外观前，上传授权并填写 `license`（设计文档 8.2）。
4. 后台点「重新载入场景包」，确认没有出现在拒收列表里。
5. 用 `?q=low` 在中低端手机上检查帧率。
