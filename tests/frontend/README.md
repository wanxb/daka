# 微信前端对抗测试

这组脚本需要已登录且已授权Codex的微信开发者工具。它们不属于`npm test`的无人值守测试，也不打包进正式小程序。

`prepare.mjs`复制当时的业务源码到`.build/<运行名>/project`，只改变测试副本的文件存储命名空间、旧目录迁移路径和App测试入口。真实`miniprogram/`保持不变。测试副本的`qa.ts`来自`runtime-harness.ts`，挂载真实页面控制器、服务及仓储的受控访问，用于构造隔离数据和注入文件系统故障；测试入口在运行前再次拒绝真实存储目录。

```powershell
node tests/frontend/prepare.mjs frontend-retest
# 将上一条命令返回的report目录设为QA_REPORT；打开返回的qaRoot，等模拟器首页就绪后再运行。
$env:QA_REPORT = 'E:\Projects\daka\reports\frontend-retest'
node tests/frontend/native-smoke.mjs
node tests/frontend/run-case.mjs '{"case":"configInputs"}'
node tests/frontend/run-case.mjs '{"case":"recordInputs"}'
node tests/frontend/run-case.mjs '{"case":"cancelAndRace"}'
node tests/frontend/run-case.mjs '{"case":"uncertainWrites"}'
node tests/frontend/run-case.mjs '{"case":"pressure","records":10000,"projects":10}'
```

可用场景以`runtime-harness.ts`的`cases`表为准。`bootstrap`只应在新副本首次进入时执行。其他场景会重置隔离存档，必须串行运行；用`reproUncertain`并传`target:record`或`target:settings`可保留冲突界面截图。大数据场景可能长时间占用模拟器，不应并发重发；工具超时不能直接视为产品缺陷，需要读取App中的`qa.status()`确认场景是否仍在执行。

`native-smoke`通过automator输入、点击及明确的控件事件检查真实页面绑定；`run-case`通过真实运行时中的页面/组件方法测试时序与边界，并区分直接服务并发、存储故障注入和数据规模构造。模拟器方法调用不等于真实键盘、IME、手指手势、多设备并发或手机帧率验证。

原始结果保存在`results.ndjson`、`native-steps.ndjson`，每个断言记录期望值、实际值、耗时和故障条件。问题清单按缺陷和修复点去重，不按失败断言次数重复统计。结束后回到真实项目首页，只读取基线核对原有数据。

完整回归可在首页初始化结束后运行`node tests/frontend/run-suite.mjs`，它依次执行边界、异常、并发、存储故障、15项目容量与旧超额兼容、迟到事件和最多50,000条记录的压力场景；失败立即停止，原始结果保留。随后运行`native-smoke.mjs`检查控件绑定，再运行`summarize.mjs`生成矩阵和汇总。所有命令应使用同一个显式`QA_REPORT`。`bootstrap`等待首次页面加载，项目设置保存后等待原生返回完成，避免把初始化或转场中的中间态当成产品失败。
