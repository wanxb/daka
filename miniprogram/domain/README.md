# 领域层

后续在此实现模型、校验、日期与累计纯函数，不引用 wx、页面或文件系统。
时间保存为整数秒，数量与记录条数分开，历史缺失项保留 null。
固定验收向量见 ../../docs/predevelopment/acceptance-cases.json。
