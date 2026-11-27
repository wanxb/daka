# 正式资源

`icons/` 统一采用本地 Phosphor Regular。运行 `node scripts/sync-prototype-icons.mjs` 从 `shared/project-appearance.json` 与 `shared/phosphor-regular.json` 生成原型资源、正式SVG、TS预设及WXSS主题；保留原生256视框和几何，不套用旧1.8线宽。正式版显式填充颜色，支持10色、15项目图标及操作图标；MIT许可证与来源映射保存在 `icons/`。不使用Emoji或在线CDN。

只保留实际使用的27个图形及其按引用生成的配色SVG；生成脚本扫描WXML引用，动态项目选择覆盖全部可选图标和主题色，静态操作仅保留使用到的颜色。`sources.json` 中的 `usage` 是允许的图标/颜色组合，组件的安全回退也使用该清单，避免引用已删除的变体。选型素材和其他图标库不再留存项目。

页面使用系统字体，卡片保留原五色并扩展为十种彩色；灰色与深色主题未纳入首版。prototype和调研图不进入正式安装包；正式版自身的首次使用数据由应用层初始化，不复制浏览器演示数据。完整图标盘点见 `docs/design/外观资源.md`。

`miniprogram-code.jpg` 为用户提供的小尺寸官方小程序码，与原型资源逐字节一致。Canvas导出仅做等比例绘制，保留原始色彩与白底；码加载失败必须中止导出并允许重试，不能用装饰图形代替。
