# 关于本 fork

本仓库是 [juejin-cn/juejin-usage](https://github.com/juejin-cn/juejin-usage) 的独立 fork，基于上游提交 `6f6299d`（2026-10-17）。

上游以 MIT 协议发布，原版权声明 `Copyright (c) 2026 juejin-cn` 完整保留在 [LICENSE](LICENSE) 中。本 fork 的修改同样以 MIT 协议发布。

本 fork 与掘金官方无隶属关系。数据目录、上报接口、包名都沿用上游，没有改动。

## 与上游的差异

都在 `packages/core` 内，只做性能和健壮性方面的修改，不改变统计结果。

| 改动 | 位置 | 原因 |
|------|------|------|
| 轮询时用 `statSync` 检查会话文件 | `parsers/shared.ts` 的 `statFileSync`，在 claude / codex / workbuddy 解析器中使用 | 每轮都要对几千个 JSONL 逐个 stat。promise 版 `stat` 每个文件都要经过一次线程池并创建一个 promise，同样的系统调用，CPU 开销约为 `statSync` 的 6 倍 |
| `cursors.json` 改为原子写入 | `queue/index.ts` 的 `writeFileAtomic` | 原实现直接覆盖写一个约 10 MB 的文件。写到一半时进程崩溃会留下截断的文件，`loadCursors` 解析失败后回退为 `{}`，所有解析器都要带着已经丢失的去重状态，从头重扫全部历史 |
| Claude 的 `seenHashes` 不再重复存一份 `seenUsage` 的 key | `parsers/claude.ts` | 这些 key 本来就在 `seenUsage` 里，再存一份不会影响任何去重判断，只会让 cursors.json 变大，并且每轮多重建一个上万元素的数组 |

## 实测

以下数据在作者本机测得（macOS，约 2750 个 Claude 会话文件，cursors.json 约 11 MB）。方法是在同一份 cursors 快照上，用上游与本 fork 各自的构建产物分别跑一次稳态轮询（没有新数据的一轮）。每个版本跑 12 次，丢弃前 2 次，取 CPU 时间的中位数。整组测试重复了两遍。

| 指标 | 上游 `6f6299d` | 本 fork |
|------|------|------|
| Claude 解析器每轮 CPU | 51–53 ms | 22 ms |
| Codex 解析器每轮 CPU | 9–10 ms | 8 ms |
| Claude 解析后的 cursors.json 体积 | 10.98 MB | 10.37 MB |

## 验证

| 命令 | 结果 |
|------|------|
| `pnpm build` | 通过 |
| `pnpm --filter @juejin-opensource/jusage-desktop typecheck` | 通过 |
| `pnpm --filter @juejin-opensource/jusage-core test` | 502 通过 / 0 失败 / 3 跳过（含 4 个新增用例：`test/cursors-io-optimizations.test.ts`） |
| `pnpm --filter @juejin-opensource/jusage test` | 22 通过 |
| `pnpm --filter @juejin-opensource/jusage-dashboard test` | 83 通过 |
| `pnpm --filter @juejin-opensource/jusage-desktop test` | 328 通过 / 2 失败。失败的是 `auto-update`、`autostart` 两个用例，原因是本地没有装 Electron 二进制，`require('electron')` 抛错，属于环境问题。这两个用例与本次改动无关，没有在完整环境中复测 |

尚未在打包后的桌面端 App 中做长时间实机运行验证。
