# AIHubMix 图像工具接入说明

> 整理依据：AIHubMix Image Gen API 与 Gemini Guides。本文用于 Research Space 图像类工具改造，不保存任何 API Key。

## 1. 工具拆分原则

Research Space 当前保留 4 个用户可见图像工具：

| 工具 | 输入 | 输出 | 推荐模型族 | 说明 |
| --- | --- | --- | --- | --- |
| 图像生成 | 文本 prompt | 1 张或多张图片 | GPT Image / Gemini / Doubao | 文生图主入口 |
| 图像编辑 | 1 张参考图 + 文本指令 | 图片 | GPT Image / Gemini / Doubao | 图生图 / 局部或整体编辑 |
| 多图融合 | 2 张以上参考图 + 指令 | 图片 | Doubao Seedream | 多图合成语义明确，暂不和普通编辑混用 |
| 组图输出 | 主题 prompt | 多张连贯图片 | Doubao Seedream | 连续组图 / 系列图输出 |

暂不直接合并为一个工具。原因是 4 类工具的输入约束、用户预期和错误提示不同；直接合并会把“无图 / 单图 / 多图 / 多输出”的判断压进一个节点，降低可理解性。改造方向是先统一内部能力表和执行内核，后续可新增“高级统一图像创作”入口做实验。

## 2. AIHubMix GPT Image 接口

### 2.1 Endpoint

GPT Image 当前优先走 AIHubMix 的 OpenAI Images 兼容路由，避免长耗时 prediction 路由在生成过程中发生 socket close 后无法取回结果：

```http
POST https://aihubmix.com/v1/images/generations
POST https://aihubmix.com/v1/images/edits
Authorization: Bearer <AIHUBMIX_API_KEY>
```

`/v1/models/openai/{model}/predictions` 仅作为模型页示例保留参考，不作为 Research Space 的 GPT Image 主链路。

### 2.2 文生图请求结构

```json
{
  "model": "gpt-image-2",
  "prompt": "A deer drinking in the lake...",
  "size": "1024x1024",
  "n": 1,
  "quality": "high",
  "moderation": "low",
  "background": "auto",
  "output_format": "png"
}
```

### 2.3 图像编辑请求结构

Research Space 对 GPT Image 编辑使用 `multipart/form-data`：`model`、`prompt`、`image`、`size`、`quality`、`background`、`output_format` 作为表单字段提交；编辑指令可来自节点参数或上游文本节点。

### 2.4 参数约束

| 参数 | 当前 UI 默认 | 说明 |
| --- | --- | --- |
| `prompt` | 来自“图像描述”参数或上游文本节点 | 必填；`style_hint` 只作为补充风格 |
| `size` | `1024x1024` | GPT Image 使用 `1024x1024` / `1024x1536` / `1536x1024` / `auto` |
| `n` | `1` | 当前限制为 1-8，避免一次生成过多节点 |
| `quality` | `high` | 可选 `high` / `medium` / `low` / `auto` |
| `moderation` | `low` | 可选 `low` / `auto` |
| `background` | `auto` | 可选 `auto` / `transparent` / `opaque` |
| `output_format` | `png` | 可选 `png` / `jpeg` / `webp` |

## 3. Gemini 图像接口

Gemini 图像生成 / 编辑走 AIHubMix Gemini 路由：

```http
POST https://aihubmix.com/gemini/v1beta/models/{model}:generateContent
x-goog-api-key: <AIHUBMIX_API_KEY>
Content-Type: application/json
```

### 3.1 文生图 body

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "text": "生成一张樱花湖边的鹿" }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "1k"
    }
  }
}
```

### 3.2 图像编辑 body

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        { "inlineData": { "mimeType": "image/png", "data": "...base64..." } },
        { "text": "把背景改成夜景霓虹街道" }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["TEXT", "IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "1k"
    }
  }
}
```

### 3.3 参数约束

当前只向用户暴露 `aspect_ratio`。`imageSize` 暂固定为 `1k`，避免把 Gemini 与 GPT Image / Doubao 的尺寸语义混在一起。

## 4. Doubao Seedream 图像接口

Doubao Seedream 走 AIHubMix Doubao predictions 路由：

```http
POST https://aihubmix.com/v1/models/doubao/{model}/predictions
Authorization: Bearer <AIHUBMIX_API_KEY>
Content-Type: application/json
```

Research Space 当前用于：

- 文生图
- 单图编辑
- 多图融合
- 组图输出

### 4.1 文生图 / 单图编辑参数

| 参数 | 说明 |
| --- | --- |
| `prompt` | 文本提示词，可来自节点参数或上游文本节点 |
| `image` | 图像编辑时传入单张 data URL |
| `size` | Doubao 当前主要使用 `2k` / `3k` |
| `watermark` | 是否添加水印 |
| `response_format` | 当前使用 `url` |
| `stream` | 当前固定 `false` |

### 4.2 多图融合参数

`image` 使用 data URL 数组：

```json
{
  "input": {
    "model": "doubao-seedream-5.0-lite",
    "prompt": "把两张参考图融合为统一海报风格",
    "image": ["data:image/png;base64,...", "data:image/png;base64,..."],
    "size": "2k",
    "response_format": "url",
    "stream": false,
    "watermark": false
  }
}
```

### 4.3 组图输出参数

组图输出使用顺序生成配置：

```json
{
  "input": {
    "model": "doubao-seedream-5.0-lite",
    "prompt": "生成一组四季庭院插画",
    "size": "2k",
    "sequential_image_generation": "auto",
    "sequential_image_generation_options": { "max_images": 4 },
    "response_format": "url",
    "stream": false,
    "watermark": true
  }
}
```

## 5. 改造规则

1. 模型能力集中到 `src/core/aihubmix-image-models.ts`。
2. Webview 参数显示只读取能力表，不再在组件内散写模型判断。
3. Runner 只根据能力表选择 GPT Image / Gemini / Doubao 执行分支。
4. 输出统一落为 `image` 节点，并写入：
   - `ai_provider: AIHubMix`
   - `ai_model`
   - `display_mode: file`
5. 返回图像统一支持：
   - URL 下载
   - data URL
   - base64 字段
6. 不在源码、文档、fixture、README、VSIX 中写入真实 API Key。

## 6. 后续改造计划

- 第一阶段：能力表驱动参数显示，GPT Image / Gemini / Doubao 路由集中化。
- 第二阶段：把图像请求执行与返回解析从 `function-runner.ts` 抽到 `src/ai/multimodal/`。
- 第三阶段：新增可选“图像创作（高级）”工具，根据输入自动选择文生图 / 图像编辑 / 多图融合 / 组图输出。
- 第四阶段：如果高级工具稳定，再考虑隐藏旧入口；不直接删除旧工具，避免破坏旧画布与蓝图。

## 7. 来源

- AIHubMix Image Gen API：<https://docs.aihubmix.com/cn/api/Image-Gen>
- AIHubMix Gemini Guides：<https://docs.aihubmix.com/cn/api/Gemini-Guides>
