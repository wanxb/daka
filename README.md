# 愚公打卡

原生 TypeScript / WXML / WXSS，WebView 渲染，基础库初始锁定 3.0.0。
正式源码为 `miniprogram/`；`prototype/` 仍是独立浏览器评审稿，不打包进小程序。

## 开发准备

当前已安装开发依赖并生成 `package-lock.json`。Node.js 20.18+、npm 10+。
后续重新安装用 `npm ci`，不要手改 lock。运行时无第三方包，不需要“构建 npm”。

```powershell
npm run check             # 类型检查、工程边界测试、代码格式检查
npm test                  # 单次测试；后续领域测试放 tests/*.test.ts
npm run format            # 格式化正式 TS、脚本及根配置
npm run devtools:status   # 微信工具连接、登录和 skill 版本
npm run devtools:open     # 打开当前工程完整窗口
npm run devtools:refresh  # 触发模拟器编译；返回成功不等于编译通过
```

CLI 默认 `D:/Tencent/微信web开发者工具/wechatide.cmd`，可用环境变量 `WECHATIDE_CLI` 指向其他安装位置。
首次连接需在微信开发者工具中允许 Codex；工具需要登录时使用自己的微信扫码。

## AppID 与开发环境

`project.config.json` 已配置用户提供的 AppID `wx181a7d368ae8a4c8`，正式源码根为 `miniprogram/`。
仍需确认当前微信具备该小程序的开发者权限，并完成开发者工具连接、登录及模拟器验证。

AppID 可在 [微信公众平台](https://mp.weixin.qq.com/) → 开发管理 → 开发设置 → 开发者 ID 核对。
手机预览、上传及真机验收使用该 AppID 和有权限的开发者账号；本地检查通过不等于微信编译或真机验收通过。

## 骨架边界

- `pages/home`：首页入口；`pages/project-detail`：项目详情；`pages/project-edit`：新增/设置。
- `components/app-navigation`：按状态栏及微信胶囊尺寸预留自定义导航，返回无前页时回首页。
- `domain`：纯规则；`application`：命令/查询编排；`infrastructure`：本地用户文件与恢复；`assets`：正式资源。
- 三页目前只有占位结构，无示例数据、业务写入、记录功能或存储协议实现。
- 后续图表使用 Canvas2D，原始记录使用本地用户文件分片，不引入整库 KV、云开发或服务器。

开始业务编码前阅读 [产品方案](产品方案-v1-20261124.md)、[记录规范](时间与数量记录规范-v1-20261124.md) 和 [准备入口](docs/predevelopment/README.md)。
下一步按 D02 实现领域规则，再实现 D03 仓储与故障恢复。完整环境实测状态见 [框架搭建记录](docs/predevelopment/框架搭建记录-20261124.md)。
