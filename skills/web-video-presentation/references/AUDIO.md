# 音频合成

把每个章节 `narrations.ts` 里的口播文字按 **step 颗粒度**合成 mp3，
落到 `presentation/public/audio/<chapter-id>/<step-N>.mp3`。运行时
Auto 模式会自动按 step 播放并自动推进——录屏可以一镜到底。

> **真相源**：每个章节的 `src/chapters/<NN>-<id>/narrations.ts` 是 step
> 数 + 口播文本的**唯一来源**。`outline.md` 不再参与音频合成，章节代码
> 也不再手写 `totalSteps`。这一改根除了"网页 step 和音频文件数对不上"
> 这个老问题。

默认用 **阿里云百炼 / DashScope TTS**，脚本在
`presentation/scripts/synthesize-audio-bailian.mjs`。当前默认配置：

```js
engine: "cosyvoice",
model: "cosyvoice-v3-flash",
voice: "longyingling_v3",
```

---

## 文件命名约定

```
presentation/public/audio/
├── coldopen/
│   ├── 1.mp3
│   ├── 2.mp3
│   └── ...
├── hook/
│   └── ...
└── ...
```

- 章节子目录名 = `chapters.ts` 里的 `id`
- 文件名 = `<step-N>.mp3`（**1-indexed**，对齐 narrations 数组的 index + 1）
- 格式默认 mp3。如果 TTS 后端只能出 wav，加一步用 `ffmpeg` 转换

---

## 标准流程

### 1. 抽取 segments

```bash
cd presentation
npm run extract-narrations
```

这会扫所有章节的 `narrations.ts`，按 `chapters.ts` 注册顺序生成
`audio-segments.json`：

```json
[
  { "chapter": "coldopen", "step": 1, "text": "...", "audio": "coldopen/1.mp3" },
  { "chapter": "coldopen", "step": 2, "text": "...", "audio": "coldopen/2.mp3" }
]
```

让用户**先扫一眼这个 json**，确认文本和切分都对，再开始烧 TTS token。

> 空字符串的 narration 会被自动跳过（不烧 TTS token）——运行时 Auto 模式
> 按字数估时撑过这种"无声过场"step。

### 2. 配置百炼 API key

脚本会自动读取项目根目录下的 `.env.local` / `.env`，也可以直接读当前
shell 环境变量。下面三个变量名任选其一：

```bash
DASHSCOPE_API_KEY=sk-...
BAILIAN_API_KEY=sk-...
ALIYUN_BAILIAN_API_KEY=sk-...
```

可选覆盖 endpoint：

```bash
DASHSCOPE_TTS_URL=https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer
```

未配置 key 时**不要继续**。提示用户把 key 放进 `presentation/.env.local`：

```bash
echo 'DASHSCOPE_API_KEY=sk-...' >> .env.local
```

### 3. 先 dry-run 一条

```bash
npm run synthesize-audio -- --dry-run --limit=1
```

确认脚本能读到 `audio-segments.json`，并且请求参数符合预期。

### 4. 调用合成脚本

```bash
npm run synthesize-audio              # 增量：跳过已存在的 mp3
npm run synthesize-audio -- --force   # 全部重合成
npm run synthesize-audio -- --voice=<voice-id>
npm run synthesize-audio -- --model=<model-id>
```

脚本**串行**调用百炼（避免 rate limit），**自动跳过已存在文件**（断点续合
不烧重复 token）。每条打印进度：

```text
[  3/24] coldopen/3.mp3          ok 1.8s audio=4.12s chars=45
[  4/24] coldopen/4.mp3          skip (exists)
```

常用参数：

| 参数 | 用途 | 默认 |
|---|---|---|
| `--engine=cosyvoice` | CosyVoice TTS endpoint | `cosyvoice` |
| `--engine=qwen` | Qwen-TTS multimodal generation endpoint | —— |
| `--model=<id>` | 模型 id | `cosyvoice-v3-flash` |
| `--voice=<id>` | 音色 id | `longyingling_v3` |
| `--format=<mp3|wav|opus|pcm>` | 输出格式 | `mp3` |
| `--sample-rate=<hz>` | 采样率 | `24000` |
| `--rate=<0.5-2.0>` | 语速 | 不传 |
| `--pitch=<0.5-2.0>` | 音高 | 不传 |
| `--volume=<0-100>` | 音量 | 不传 |
| `--language-hint=<code>` | CosyVoice 语言提示；`none` 表示不传 | `zh` |
| `--language-type=<type>` | Qwen-TTS `language_type` | `Chinese` |
| `--instruction=<text>` | 口吻 / 风格指令 | 不传 |
| `--seed=<0-65535>` | 随机种子 | 不传 |
| `--timeout=<seconds>` | 请求超时 | `300` |

### 5. 校验时长

脚本会在本机存在 `ffprobe` 时自动打印本次合成的单段时长和总时长。也可以
手动汇总：

```bash
for f in public/audio/*/*.mp3; do
  d=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f")
  echo "$f  ${d}s"
done
```

把每条的实际秒数汇总告诉用户。**重点关注 >= 15s 的条目**——口播太长意味
着该 step 的 narration 写得过密，或者 step 没拆够。让用户决定**改稿子
重合**还是**回章节代码拆 step**。

---

## 用户自带 TTS 的最小契约

任何 TTS 后端只要满足三个能力即可接进来：

| 能力 | 输入 | 输出 |
|---|---|---|
| 单段合成 | 一段文字 + 音色 id（可选） | 一个 mp3 / wav 文件 |
| 错误反馈 | —— | 失败时明确报错（rate limit / auth / 内容审核 / 网络） |
| 输出可落盘 | 目标文件路径或可下载 URL / base64 | 最终写到 `public/audio/<chapter>/<N>.mp3` |

百炼脚本已经处理两种响应：`output.audio.data`（base64）和
`output.audio.url`（下载链接）。如果换成其它 API，也按相同的"读
`audio-segments.json` → 串行调用 → 落盘 → 校验"流程改脚本即可。

---

## 运行时如何使用合成的音频

合成完成后，**不需要任何额外配置**——脚手架的 `App.tsx` 已经接好：

| 模式 | 触发方式 | 行为 |
|---|---|---|
| **Manual**（默认） | 直接打开页面 | 不播音频，点击 / 方向键推进 |
| **Audio**（半自动） | URL `?audio=1` 或按 `M` 键 | 进入 step 自动播音频，但你手动推进（点鼠标） |
| **Auto**（全自动） | URL `?auto=1` 或按两次 `M` 键 | 进入 step 播音频 → 播完自动 next() → 进下个 step → ... |

Auto 模式首次需要按一次 `Space` 启动（绕过浏览器自动播放限制），之后
全自动跑。**录屏时打开屏幕录制 → 按 Space → 整片自动跑完 → stop**。

> **Auto 模式的推进规则就一句话**：每段音频播完 + 200ms 缓冲 → 自动 next。
> **没有"等动画跑完"的兜底**——如果你写的视觉动画比口播长，会被当场切。
> 解决办法：写更长口播 / 拆 step / 调动画速度（详见
> [`CHAPTER-CRAFT.md`](CHAPTER-CRAFT.md) 「代码层最小约束」）。
>
> 音频文件缺失（还没合成 / 404）或 narration 是空串 → 退化到字数估时
> （`max(1500ms, 字数 × 250ms)`），保证预览也能整片跑通。

---

## 故障排查

| 现象 | 原因 / 修法 |
|---|---|
| `Segments file not found` | 先在 `presentation` 目录跑 `npm run extract-narrations` |
| `Missing API key` | 设置 `DASHSCOPE_API_KEY` / `BAILIAN_API_KEY` / `ALIYUN_BAILIAN_API_KEY` |
| `401 / unauthorized` | key 无效、过期、权限不够，或 shell 没读到 `.env.local` |
| `HTTP 429` / rate limit | 等一会儿重跑；已存在 mp3 会自动跳过 |
| `No output.audio in response` | endpoint / engine / model 不匹配，或返回结构变了；先用 `--dry-run --limit=1` 查请求参数 |
| `Audio download failed` | 百炼返回的音频 URL 失效或网络失败；重跑该段即可 |
| 中间断了几条没合成 | `npm run synthesize-audio` 重跑；已存在文件会跳过 |
| 中文音色不自然 | 换 `--voice=<voice-id>`，或用 `--instruction=<text>` 指定口吻 |
| 整段合成被截断 | 单段过长。在 narrations.ts 里把这条拆成两条（也意味着该 step 应该拆成两个 step） |
| 浏览器没播音频 | Auto / Audio 模式下首次需要用户手势——确认你按了 SPACE 启动 Auto，或者点过页面 |
| 音频 404 但 Auto 模式还能跑 | 找不到 mp3 时 useAudioPlayer 退化到字数估时，保证预览不中断 |
