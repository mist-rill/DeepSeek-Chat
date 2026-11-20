# Third-Party Notices / 第三方组件声明

本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo)（MIT License, Copyright (c) 2026 DeepSeek）修改，整体仍以 [MIT](LICENSE) 发布。

以下是应用运行时打包的主要第三方组件及其许可证。各组件的完整许可证文本可在其源码仓库或 npm 包内查阅。

## JavaScript 运行时依赖

| 组件 | 许可证 | 来源 |
| --- | --- | --- |
| react / react-dom | MIT | https://github.com/facebook/react |
| zustand | MIT | https://github.com/pmndrs/zustand |
| @capacitor/core / app / filesystem / keyboard / share / status-bar / android | Apache-2.0 | https://github.com/ionic-team/capacitor |
| katex | MIT | https://github.com/KaTeX/KaTeX |
| mermaid | MIT | https://github.com/mermaid-js/mermaid |
| prismjs | MIT | https://github.com/PrismJS/prism |
| idb | ISC | https://github.com/jakearchibald/idb |
| clsx | MIT | https://github.com/lukeed/clsx |
| fflate | MIT | https://github.com/101arrowz/fflate |
| mdast-util-* / micromark-extension-* | MIT | https://github.com/micromark/micromark |

## Android 依赖

| 组件 | 许可证 | 来源 |
| --- | --- | --- |
| AndroidX / Jetpack（core-ktx、activity、webkit、lifecycle 等） | Apache-2.0 | https://developer.android.com/jetpack |
| Material Components for Android | Apache-2.0 | https://github.com/material-components/material-components-android |
| WebView 与系统运行时 | 由 Android 设备制造商随系统分发 | — |

## 构建工具（仅开发期使用，不随应用分发）

| 组件 | 许可证 |
| --- | --- |
| @rspack/* （构建器） | MIT |
| @swc/helpers | Apache-2.0 |
| typescript | Apache-2.0 |
| oxlint / oxfmt | MIT |
| sharp | Apache-2.0 |

---

DeepSeek、React、Capacitor、Android 等名称与商标归其各自权利人所有。本项目为个人学习修改版本，与 DeepSeek 官方无隶属或背书关系。
