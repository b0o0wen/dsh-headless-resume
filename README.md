# dsh-headless-resume

One-shot, non-interactive dsh session continuation through `agents.resume()`.

为 dsh headless 增加 `--resume <sessionId>`，适用于脚本、CI 和 MCP adapter。每次运行处理一个任务，刷新持久化日志后退出；后续进程可以恢复同一会话继续对话。

## 安装

需要已安装的 dsh 和 pnpm。当前验证版本为 dsh `0.1.5-rc.1`、Node.js `22.22.1`；dsh 的 API 和会话格式仍在演进，升级后应运行下文的集成测试。

在本项目目录安装源码：

```bash
dsh plugin --profile headless-resume add file:.
```

或者安装发布包 / GitHub 源码：

```bash
dsh plugin --profile headless-resume add @b0o0wen/dsh-headless-resume
# 或者：
dsh plugin --profile headless-resume add github:b0o0wen/dsh-headless-resume
```

`dsh plugin` 会初始化新的自定义 profile，并追加插件 bundle。该 profile 的 `package.json` 中应包含：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@b0o0wen/dsh-headless-resume"
      ]
    }
  }
}
```

本插件是独立 headless 层，包含 startup、runner、code-runtime、system prompt 和 `DSH_TOOLS_MODE` 配置。不要先用 `--from-default-profile headless` 复制原生 headless：原生 bundle 会与本插件产生重复条目。

### 从旧版安装方式迁移

如果已经按照旧 README 复制过 headless profile，请在安装 / 更新本插件后，从 `$DSH_HOME/profiles/headless-resume/package.json` 的 `dsh.profile.bundles` 数组中移除 `@deepseek-ai/dsh-headless`。`DSH_HOME` 默认是 `~/.dsh`。这只修改插件组合，不会删除历史会话。

可执行以下命令完成该项修改：

```bash
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const path = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'profiles', 'headless-resume', 'package.json');
const manifest = JSON.parse(readFileSync(path, 'utf8'));
manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== '@deepseek-ai/dsh-headless');
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
JS
```

## 使用

```bash
# 新建会话
dsh --profile headless-resume "分析这个设计"
# stderr: dsh: session: session-40248dc0-321b-4ae5-872b-9e841dea2857

# 使用上一轮输出的完整 ID 续聊
dsh --profile headless-resume \
  --resume session-40248dc0-321b-4ae5-872b-9e841dea2857 \
  "我修复了你指出的问题，请再检查一次"

# 查看帮助
dsh --profile headless-resume --help
```

- `stdout` 只输出本次运行的最终助手文本；推理进度、session ID 和错误写入 `stderr`。
- session ID 是不透明字符串，必须原样传递，包括 `session-` 前缀。旧版输出去掉前缀是缺陷；若旧会话实际 ID 是 `session-<uuid>`，需恢复此前缀。
- `--resume` 后仍需提供非空任务。未知 ID 报错退出，不会创建替代会话。
- 成功完成返回退出码 `0`；失败或中止返回 `1`。已完成日志刷新的失败轮次也输出 session ID，便于再次续聊。
- 新建和恢复都使用当前 profile 的模型选择。恢复保留持久化历史和会话元数据；建议从原工作目录、相同 `DSH_HOME` 和相同插件组合运行。插件不会根据会话自动切换进程目录。
- 会话使用 dsh 原生持久化存储，默认位于 `~/.dsh/sessions/`。恢复其他 profile 的会话需要兼容的日志格式、事件插件和运行时配置。

## PolyReview

```toml
[[reviewer]]
name = "dsh"
new_cmd = ["dsh", "--profile", "headless-resume", "{prompt}"]
resume_cmd = ["dsh", "--profile", "headless-resume", "--resume", "{session}", "{prompt}"]
session_regex = 'dsh: session:\s*(\S+)'
```

## 验证

```bash
npm test
# 若 dsh 不在 PATH 中：
DSH_BIN=/absolute/path/to/dsh npm test
```

测试将插件打包，在临时 `DSH_HOME` 中通过 `dsh plugin` 离线安装，启动真实 CLI、Cordis、Agent loop 和持久化后端。仅模型适配器替换为确定性本地实现，不需要 API Key，也不修改用户的 profile。

覆盖新建会话、跨进程恢复历史、重复续聊、当前轮输出隔离、模型失败退出码、未知 ID 和 CLI 参数校验。测试同时验证 session ID 往返不变，恢复请求包含上一进程的用户消息与助手回复，并且没有创建第二份会话日志。

## License

MIT。Runner 基于 DeepSeek Harness 的 MIT 授权 headless 实现改造。
