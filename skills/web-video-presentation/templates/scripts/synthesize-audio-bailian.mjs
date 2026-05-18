#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotEnvFile(file) {
  if (!existsSync(file)) return;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvFile(join(root, ".env.local"));
loadDotEnvFile(join(root, ".env"));

const config = {
  apiKey:
    process.env.DASHSCOPE_API_KEY ||
    process.env.BAILIAN_API_KEY ||
    process.env.ALIYUN_BAILIAN_API_KEY ||
    "",
  endpoint: process.env.DASHSCOPE_TTS_URL || "",
  segments: join(root, "audio-segments.json"),
  outRoot: join(root, "public", "audio"),
  engine: "cosyvoice",
  model: "cosyvoice-v3-flash",
  voice: "longyingling_v3",
  format: "mp3",
  sampleRate: 24000,
  volume: undefined,
  rate: undefined,
  pitch: undefined,
  languageHint: "zh",
  languageType: "Chinese",
  instruction: undefined,
  seed: undefined,
  enableSsml: false,
  enableMarkdownFilter: false,
  enableAigcTag: false,
  force: false,
  dryRun: false,
  limit: Infinity,
  timeoutMs: 300000,
};

function usage() {
  console.log(`Usage:
  npm run synthesize-audio -- [options]

Environment:
  DASHSCOPE_API_KEY           Required. Alibaba Cloud Bailian / DashScope API key.
  BAILIAN_API_KEY             Also accepted as an alias.
  ALIYUN_BAILIAN_API_KEY      Also accepted as an alias.
  DASHSCOPE_TTS_URL           Optional endpoint override.
  .env.local / .env           Loaded from project root if present.

Options:
  --segments=<path>           Input JSON array. Default: audio-segments.json
  --out-root=<path>           Output root. Default: public/audio
  --engine=<qwen|cosyvoice>   Default: cosyvoice
  --model=<id>                Default: cosyvoice-v3-flash
  --voice=<id>                Default: longyingling_v3
  --format=<mp3|wav|opus|pcm> Default: mp3
  --sample-rate=<hz>          Default: 24000
  --volume=<0-100>
  --rate=<0.5-2.0>
  --pitch=<0.5-2.0>
  --language-hint=<code>      Default: zh. Use --language-hint=none to omit.
  --language-type=<type>      Qwen-TTS language_type. Default: Chinese.
  --instruction=<text>
  --seed=<0-65535>
  --enable-ssml
  --enable-markdown-filter
  --enable-aigc-tag
  --force                     Overwrite existing files.
  --dry-run                   Print planned requests without calling API.
  --limit=<n>                 Synthesize first n segments only.
  --timeout=<seconds>         Request timeout. Default: 300.

Input segment shape:
  { "text": "...", "audio": "chapter/1.mp3" }
  The script also accepts { "chapter": "chapter", "step": 1 } and derives audio.
`);
}

function parseArgs(argv) {
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--force") {
      config.force = true;
    } else if (arg === "--dry-run") {
      config.dryRun = true;
    } else if (arg === "--enable-ssml") {
      config.enableSsml = true;
    } else if (arg === "--enable-markdown-filter") {
      config.enableMarkdownFilter = true;
    } else if (arg === "--enable-aigc-tag") {
      config.enableAigcTag = true;
    } else if (arg.startsWith("--segments=")) {
      config.segments = resolve(arg.slice("--segments=".length));
    } else if (arg.startsWith("--out-root=")) {
      config.outRoot = resolve(arg.slice("--out-root=".length));
    } else if (arg.startsWith("--model=")) {
      config.model = arg.slice("--model=".length);
    } else if (arg.startsWith("--engine=")) {
      config.engine = arg.slice("--engine=".length);
    } else if (arg.startsWith("--voice=")) {
      config.voice = arg.slice("--voice=".length);
    } else if (arg.startsWith("--format=")) {
      config.format = arg.slice("--format=".length);
    } else if (arg.startsWith("--sample-rate=")) {
      config.sampleRate = Number(arg.slice("--sample-rate=".length));
    } else if (arg.startsWith("--volume=")) {
      config.volume = Number(arg.slice("--volume=".length));
    } else if (arg.startsWith("--rate=")) {
      config.rate = Number(arg.slice("--rate=".length));
    } else if (arg.startsWith("--pitch=")) {
      config.pitch = Number(arg.slice("--pitch=".length));
    } else if (arg.startsWith("--language-hint=")) {
      const value = arg.slice("--language-hint=".length);
      config.languageHint = value === "none" ? undefined : value;
    } else if (arg.startsWith("--language-type=")) {
      config.languageType = arg.slice("--language-type=".length);
    } else if (arg.startsWith("--instruction=")) {
      config.instruction = arg.slice("--instruction=".length);
    } else if (arg.startsWith("--seed=")) {
      config.seed = Number(arg.slice("--seed=".length));
    } else if (arg.startsWith("--limit=")) {
      config.limit = Number(arg.slice("--limit=".length));
    } else if (arg.startsWith("--timeout=")) {
      config.timeoutMs = Number(arg.slice("--timeout=".length)) * 1000;
    } else {
      console.error(`Unknown arg: ${arg}`);
      process.exit(1);
    }
  }
}

function validate() {
  if (!existsSync(config.segments)) {
    console.error(`Segments file not found: ${config.segments}`);
    process.exit(1);
  }
  if (!config.dryRun && !config.apiKey) {
    console.error(
      "Missing API key. Set DASHSCOPE_API_KEY, BAILIAN_API_KEY, or ALIYUN_BAILIAN_API_KEY.",
    );
    process.exit(1);
  }
  if (!Number.isFinite(config.sampleRate) || config.sampleRate <= 0) {
    console.error("--sample-rate must be a positive number");
    process.exit(1);
  }
  if (!Number.isFinite(config.limit) && config.limit !== Infinity) {
    console.error("--limit must be a number");
    process.exit(1);
  }
  if (!["qwen", "cosyvoice"].includes(config.engine)) {
    console.error("--engine must be qwen or cosyvoice");
    process.exit(1);
  }
  if (!config.endpoint) {
    config.endpoint =
      config.engine === "qwen"
        ? "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
        : "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer";
  }
}

function segmentAudioPath(segment) {
  if (segment.audio) return segment.audio;
  if (segment.chapter && segment.step) return `${segment.chapter}/${segment.step}.mp3`;
  throw new Error(`Segment is missing "audio": ${JSON.stringify(segment)}`);
}

function buildRequest(text) {
  if (config.engine === "qwen") {
    const input = {
      text,
      voice: config.voice,
      language_type: config.languageType,
    };
    if (config.instruction) input.instructions = config.instruction;
    return {
      model: config.model,
      input,
    };
  }

  const input = {
    text,
    voice: config.voice,
    format: config.format,
    sample_rate: config.sampleRate,
  };

  if (config.volume !== undefined) input.volume = config.volume;
  if (config.rate !== undefined) input.rate = config.rate;
  if (config.pitch !== undefined) input.pitch = config.pitch;
  if (config.languageHint) input.language_hints = [config.languageHint];
  if (config.instruction) input.instruction = config.instruction;
  if (config.seed !== undefined) input.seed = config.seed;
  if (config.enableSsml) input.enable_ssml = true;
  if (config.enableMarkdownFilter) input.enable_markdown_filter = true;
  if (config.enableAigcTag) input.enable_aigc_tag = true;

  return {
    model: config.model,
    input,
  };
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Non-JSON response (${response.status}): ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function responseAudio(response) {
  const audio = response?.output?.audio;
  if (!audio) {
    throw new Error(`No output.audio in response: ${JSON.stringify(response)}`);
  }
  if (audio.data) return { kind: "base64", value: audio.data };
  if (audio.url) return { kind: "url", value: audio.url };
  throw new Error(`No audio.data or audio.url in response: ${JSON.stringify(response)}`);
}

async function downloadAudio(url, out) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Audio download failed HTTP ${response.status}: ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  writeAtomically(out, bytes);
}

function writeAtomically(out, bytes) {
  mkdirSync(dirname(out), { recursive: true });
  const temp = `${out}.tmp-${process.pid}`;
  writeFileSync(temp, bytes);
  renameSync(temp, out);
}

function durationSeconds(file) {
  try {
    const value = execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=nw=1:nk=1",
        file,
      ],
      { encoding: "utf8" },
    ).trim();
    return Number(value);
  } catch {
    return undefined;
  }
}

async function synthesize(segment, index, total) {
  const audioRel = segmentAudioPath(segment);
  const text = segment.text || "";
  const out = join(config.outRoot, audioRel);
  const label = audioRel.padEnd(24);
  const prefix = `[${String(index + 1).padStart(3, " ")}/${total}]`;

  if (!text.trim()) {
    console.log(`${prefix} ${label} skip (empty text)`);
    return { status: "skipped" };
  }
  if (existsSync(out) && !config.force) {
    console.log(`${prefix} ${label} skip (exists)`);
    return { status: "skipped" };
  }

  const body = buildRequest(text);
  if (config.dryRun) {
    console.log(
      `${prefix} ${label} dry-run ${JSON.stringify({
        endpoint: config.endpoint,
        model: body.model,
        input: {
          ...body.input,
          text: `${text.slice(0, 36)}${text.length > 36 ? "..." : ""}`,
        },
      })}`,
    );
    return { status: "dry-run" };
  }

  const started = Date.now();
  try {
    const json = await fetchJson(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const audio = responseAudio(json);
    if (audio.kind === "base64") {
      writeAtomically(out, Buffer.from(audio.value, "base64"));
    } else {
      await downloadAudio(audio.value, out);
    }

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const duration = durationSeconds(out);
    const durationText = duration ? ` audio=${duration.toFixed(2)}s` : "";
    const usageText = json?.usage?.characters ? ` chars=${json.usage.characters}` : "";
    console.log(`${prefix} ${label} ok ${elapsed}s${durationText}${usageText}`);
    return { status: "synthesized", duration };
  } catch (error) {
    rmSync(out, { force: true });
    console.error(`${prefix} ${label} FAILED`);
    console.error(`  ${error?.message || error}`);
    return { status: "failed" };
  }
}

async function main() {
  parseArgs(process.argv.slice(2));
  validate();

  const segments = JSON.parse(readFileSync(config.segments, "utf8"));
  if (!Array.isArray(segments)) {
    console.error("Segments file must be a JSON array.");
    process.exit(1);
  }

  const planned = segments.slice(0, config.limit);
  let synthesized = 0;
  let skipped = 0;
  let failed = 0;
  let dryRun = 0;
  const durations = [];

  console.log(`Bailian TTS endpoint: ${config.endpoint}`);
  console.log(
    `engine=${config.engine} model=${config.model} voice=${config.voice} format=${config.format}`,
  );
  console.log(`segments=${planned.length} force=${config.force} dryRun=${config.dryRun}`);
  console.log("");

  for (let i = 0; i < planned.length; i += 1) {
    const result = await synthesize(planned[i], i, planned.length);
    if (result.status === "synthesized") {
      synthesized += 1;
      if (result.duration) durations.push(result.duration);
    } else if (result.status === "skipped") {
      skipped += 1;
    } else if (result.status === "dry-run") {
      dryRun += 1;
    } else if (result.status === "failed") {
      failed += 1;
    }
  }

  console.log("");
  console.log(
    `done - synthesized ${synthesized}, skipped ${skipped}, dry-run ${dryRun}, failed ${failed}`,
  );
  if (durations.length > 0) {
    const total = durations.reduce((sum, item) => sum + item, 0);
    const max = Math.max(...durations);
    console.log(`audio duration this run: ${total.toFixed(2)}s, max ${max.toFixed(2)}s`);
  }

  process.exit(failed === 0 ? 0 : 2);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
