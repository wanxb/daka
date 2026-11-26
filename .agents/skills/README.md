# 本项目 Skills

安装日期：2026-11-24。作用域：`E:/Projects/daka/.agents/skills/`。
技能从下一轮对话开始由支持项目级 Agent Skills 的客户端发现；本次未改动用户级技能目录。

| 分组 | 已安装目录 | 来源 |
|---|---|---|
| 微信开发者工具官方 Skills | `wechatide-skill` | 本机微信开发者工具 2.02.2609250 内置包，Skill 版本 0.3.11 |
| 微信官方 Skyline Skills | `skyline-overview`、`skyline-config`、`skyline-components`、`skyline-wxss`、`skyline-worklet`、`skyline-route`、`skyline-scroll-api` | https://github.com/wechat-miniprogram/skyline-skills ，master |
| 腾讯云小程序开发 | `miniprogram-development` | https://github.com/TencentCloudBase/CloudBase-AI-ToolKit/tree/main/config/source/skills/miniprogram-development |
| CloudBase 基础依赖 | `cloudbase-platform` | 同一腾讯云仓库，包含开发及部署协议引用 |
| UI/UX Pro Max | `ui-ux-pro-max` | 从本机已安装的 `C:/Users/Administrator/.codex/skills/ui-ux-pro-max` 完整复制；保留现有版本及数据、脚本 |
| Anthropic 前端设计 | `frontend-design` | https://github.com/anthropics/skills/tree/main/skills/frontend-design |
| 官网精修与评审 | `impeccable` | https://github.com/pbakaus/impeccable/tree/main/.agents/skills/impeccable ，2026-11-26安装 |
| 品牌官网设计 | `design-taste-frontend` | https://github.com/leonxlnx/taste-skill/tree/main/skills/taste-skill ，2026-11-26安装；其脚本要求Node 22+ |
| 落地页文案 | `copywriting` | https://github.com/coreyhaines31/marketingskills/tree/main/skills/copywriting ，2026-11-26安装 |

共 15 个顶层技能目录；微信开发者工具包另带 9 个场景子技能。

## 使用约定

- 编译、模拟器、预览、日志及工具调用优先遵循本机对应版本的 `wechatide-skill/SKILL.md`。CloudBase 文档引用的旧命令名或参数不能覆盖已安装官方工具的注册表。
- Skyline 技能按场景使用；安装技能不表示已经确定使用 Skyline 渲染引擎。
- UI/UX Pro Max 与 frontend-design 服务于已确定的 Apple 系统级审美要求，保留系统字体、清晰层级、克制视觉和一致交互。
- 只有确定采用 CloudBase 后，才启用相应云开发流程。认证、支付、数据库等可选兄弟技能按实际需求补充，本次没有开通云资源。
- Apple HIG 是设计参考文档，不是本次安装的技能：https://developer.apple.com/design/human-interface-guidelines/ 。

## 本机工具入口

官方 CLI：`D:/Tencent/微信web开发者工具/wechatide.cmd`。

本次官方安装诊断返回 `compatible: true`，版本为 `2.02.2609250`；当前终端 PATH 未发现短命令 `wechatide`，可直接使用上述绝对路径，无需修改全局 PATH。

安装期尝试连接 `Codex` 客户端时，首次授权等待超时，返回 `CONNECT_ERROR`。这不影响技能文件安装。真正开始模拟器操作、预览或调试前，再发起官方连接授权并验证状态；本次未确认登录状态、未导入业务项目或上传版本。

更新微信开发者工具后，应将其内置 Skill 单向同步到本项目，不向工具安装目录反写项目文件。
