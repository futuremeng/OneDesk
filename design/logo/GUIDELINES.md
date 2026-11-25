# OneDesk 品牌标识指南

版本 1.0（2026-11）。概念 B「一张桌面，多个应用」定稿。

## 标识构成

**图形（mark）**：1 个大圆角 tile（桌面）+ 3 个小圆角 tile（应用）。
语义：一个 OneDesk 桌面承载多个应用。刻意与 Office 四象限均分构图区分——
层级不对称是特征，不是缺陷。

- 生产网格：`viewBox 0 0 256`。大 tile 18..150（rx 26），小 tile 72×72
  （rx 20，右上 166..238 / 左下 18..90 / 右下 166..238）。
  四边等距边距 18，内部沟槽 16，光学中心 (128, 128)。
- 文件：`mark.svg`（单色黑）、`mark-white.svg`（反白）、`mark-color.svg`
  （彩色，见下）。

## 色彩

| 用途 | 值 |
| --- | --- |
| 墨色（主） | `#000` 纯黑（lockup 纯黑白，供暗色主题 invert 滤镜翻转） |
| 彩色版大 tile | `#0F1115` |
| 彩色版小 tile | `#0F7FFF`（shell 品牌蓝 `--accent`；各 app 界面内可用自身 `--accent` 替换） |
| 图标容器 | 纯黑圆角方（rx 22.5%），保留旧图标在桌面栏的黑色血缘 |

## 程序图标（icon mode）

母版 `appicon-master.svg`（1024 网格）：黑色圆角容器满幅，图形白色反挖，
内容区 204..819（约 70%，与旧图标墨量一致）。
重新生成：`node tools/gen-app-icon.mjs` →
`apps/shell/build/icon.png / icon-mac.png / icon.ico / icon.icns`
（macOS 槽位按 824/1024 网格留边，Windows 满幅；同时更新 shell/sheets 的
`app-icon.png` 资产——Onboarding 图与 macOS 通知徽标使用。）

## 横排 lockup

`apps/shell/src/renderer/src/assets/onedesk-logo.svg`：图形 + 定制字标。

- 字标：OneDesk Poppins Bold 轮廓路径（OFL 授权），baseline y=189，
  cap ≈117.5，总宽严丝 766（324..1090）。
- 图形墨高 132，居中于 y=128，右边 264（与字标间隙 60）。
- 纯黑白；暗色主题经 `--logo-invert` invert 滤镜翻白，不得引入彩色。
- 重新生成：`/tmp/ft-venv/bin/python design/logo/gen-lockup.py`
  （需 fonttools+brotli 的 venv）。
- 侧栏内高度 28px；最小数字尺寸：lockup 宽 ≥114px，图形 ≥32px。

## 规则

1. 图形永远保持「1 大 3 小」层级与 16 沟槽；不得四格等大。
2. 最小尺寸：单色图形 32px，程序图标 16px；16px 下沟槽仍须可见。
3. 留白：至少图形 1 个大 tile 宽度的 25%。
4. 禁止：拉伸变形、旋转、加描边/阴影/渐变（彩色版除外）、把 tile 换成
   文档/箭头等象形符号、延续旧「双矩形互扣」链环造型。
5. 深色背景用反白版；桌面图标一律用黑色容器版。

## 与旧资产的关系

- 旧黑色圆角容器血缘保留；互扣双矩形（链环感）退役。
- 旧字标为「GenOffice」（品牌迁移遗漏），本次一并更正为 OneDesk。
- 文件关联图标（`file-*.svg` → docx.xlsx… .icns/.ico）为各文件类型自己的
  mini mark，不含 OneDesk 图形，无需再生成。
