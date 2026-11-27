# 项目外观资源源

`project-appearance.json` 是10色、15个项目图标和操作图标映射的唯一配置源。保留旧标识，避免历史数据因素材更换而失效。

`phosphor-regular.json` 只保存实际使用的28个Phosphor Regular矢量图案（15个项目图标、13个操作图标）。原有图案来自Phosphor Icons的Iconify分发；新增分享图标export来自@phosphor-icons/core 2.1.1的Regular资源，使用原始256视框与路径。许可证原件在本目录 `LICENSE-Phosphor.txt`，正式包保留必要的[MIT声明](../miniprogram/assets/icons/LICENSE-Phosphor.txt)。

在项目根运行 `npm run assets:sync` 可离线生成：原型 `appearance.js`、正式 `domain/appearance.ts`、`appearance.wxss` 与 `assets/icons/`。不要手动修改生成文件；脚本按WXML实际引用展开15图标/10色的有限组合，仅输出实际引用的配色SVG，并清理生成目录中的过期SVG。遇到新引用表达式会停止并提示，避免静默遗漏素材。未使用的图标、其他图标库及选型对比页已移除。
