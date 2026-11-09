# 设计资料

| 资料 | 位置 |
|---|---|
| 全面开发设计规划（产品、玩法、SaaS、技术、商业、合规、排期、美术） | [云上寺-全面开发设计规划.md](云上寺-全面开发设计规划.md) · 在线版（含 3 张图表与评论）：https://claude.ai/artifact/SUG1uj71RSVjmgsHgkP9mz |
| 泥生角色设计稿（三视图、五阶段釉色、关键动作分镜、精稿、模型设定、3D 渲染） | 设计画布：https://claude.ai/artifact/GrDZPYCoFzzc1aoaAf5Cyn |
| 泥生 3D 参考渲染 | [character/](character/) |
| 渲染脚本（程序化 SDF 光线步进，numpy + Pillow） | [render-tools/](render-tools/) |

## 泥生 3D 参考渲染

| 文件 | 内容 |
|---|---|
| `hero_front.png` / `hero_34.png` | 素烧阶段 · 正面 / 3/4 侧 |
| `stages_lineup.png` | 五阶段：素坯 → 素烧 → 施釉（天青）→ 窑变（开片）→ 金缮 |
| `pose_incense.png` | 分镜 A · 上香 |
| `pose_prostrate.png` | 分镜 B · 五体投地 |
| `pose_return.png` | 分镜 C · 金缮归来 |

这些是程序化光线步进渲染，用于造型与材质参考，不是最终美术。正式模型由建模师在 ZBrush / Blender 中制作（手指分开、下摆褶皱、心灯两侧莲瓣刻纹需补雕）。

**不可改动的设定**（游戏内 `client/src/avatar/nisheng.js` 与这些参考一致）：
- 钟形陶身、无嘴、两道下弯弧线的闭眼，表情只靠姿态和心灯；
- 胸口心灯为莲苞形小窗，静坐越久越亮；
- 袈裟**偏袒右肩，搭在左肩**，田相缝线，左肩前有铜色环扣；
- 毡灰下摆，沿口一道明线；背后有按用户生成的指纹；
- 动作重量感：下去快、起来慢约 30%（陶是重的）。

## 重新渲染

```bash
pip install numpy pillow
python render-tools/nisheng3d.py --stage bisque --yaw 35 --w 900 --h 1200 --out front.png
python render-tools/nisheng_pose.py --pose incense --out incense.png   # pray | incense | prostrate | return
```
`--stage`：raw / bisque / glaze / kiln / kintsugi。900×1200 单张约 2–4 分钟（纯 CPU）。
