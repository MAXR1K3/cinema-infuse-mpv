# Cinema · Infuse / mpv

本机运行的影院片库：HTML/CSS/JavaScript 界面 + Node.js 服务。连接自己的 Emby、WebDAV 或本地影片目录，在 Windows 用 mpv 播放，在 Apple 芯片 Mac 上交给 Infuse。

## 分平台结构

| 目录 | 内容 |
| --- | --- |
| `apps/cinema/` | 共享影院前后端、字幕、演职员、分类、收藏、追剧、观看进度与测试 |
| `platforms/windows/portable_config/` | 实际使用的 mpv 配置、右键菜单、uosc、着色器、SDR/HDR RIFE 脚本与字体 |
| `platforms/windows/` | 可移植配置安装器与影院启动器 |
| `platforms/macos/` | Apple Silicon `.app` 构建器、钥匙串保护、Infuse 播放适配与测试 |
| `tools/` | 发布检查和源码打包 |
| `docs/` | 平台说明、功能边界和第三方来源 |

## Windows 快速开始

1. 安装 [Node.js 22 LTS](https://nodejs.org/) 或更新的兼容版本，以及 [Windows mpv](https://mpv.io/installation/)。将本项目下载/克隆到固定目录。
2. 在项目根目录运行（路径替换为你的实际 mpv 目录）：

```powershell
node platforms/windows/configure.cjs --mpv-root "D:\Apps\mpv"
```

安装器会复制 `portable_config` 并替换配置内的路径占位符。如果该目录已有配置，默认拒绝覆盖；先备份再显式加 `--force` 才会覆盖同名文件。
3. 编辑新生成的 `config.local.json`，设置 `libraryRoot`、`port`；`mpvExe` 已由安装器填写。JSON 中路径可以使用正斜杠。
4. 启动：

```powershell
npm start
```

浏览器会打开 `http://127.0.0.1:7788/`。在界面重新登录 Emby 或添加 WebDAV。终端需要保持运行；按 Ctrl+C 停止服务。

账号和进度保存在 `%APPDATA%/CinemaInfuse/`，不在 Git 仓库中。API key、字幕服务和弹幕等可选服务须自行配置。播放器核心、VapourSynth/Python/TensorRT 等运行时需要另装，见 [Windows 配置说明](docs/windows.md)。

## macOS · Apple Silicon

Mac 使用 **Infuse**，不安装 Windows mpv、RIFE、TensorRT 配置。安装 Python 3.10+ 和构建依赖，然后在根目录执行：

```sh
python3 -m pip install -r requirements-build.txt
python3 platforms/macos/download-runtime.py
python3 platforms/macos/build.py
```

输出 `dist/Cinema-Infuse-macOS-AppleSilicon.zip`，内含 `.app`、Node ARM64、使用说明和停止工具。生成的应用未签名、未公证，尚无 Mac 实机验收。详见 [Mac 使用说明](platforms/macos/README-使用说明.txt)。

## 功能与实际边界

- Emby 原生分类、组合筛选、影片/剧集详情、演员照片与关联作品、收藏及追剧。
- 详情分别展示 IMDb、烂番茄、豆瓣等具名评分；Emby 通用社区/影评分单独标注，缺失数据不猜测来源。可在“评分设置”添加 OMDb API key，优先按精确 IMDb ID 补全评分；缺少 ID 时只接受原名、年份、类型一致的候选，界面注明这不是平台 ID 核验，同名同年作品仍有歧义。“测试连接”会区分无效 key、额度不足和服务失败；密钥在本机加密保存，OMDb 不提供豆瓣评分。
- 评分排序：Emby 社区/影评分支持完整分类分页排序；IMDb、烂番茄、豆瓣仅排序已载入且已有该来源评分的作品，缺失评分置后，不代表全库排名。剧集分集仍按集序显示。
- 多规格片源选择；不同文件即使规格相同也保留各自选项，不能仅按显示名称去重。
- Windows 播放进度记录、已知时长的 95% 完成阈值、下一集推荐和正常结束后的接播。
- Windows 片库启动的 mpv 会按账号、影片和片源版本记住拖入的本地字幕路径、字幕选择、字幕延迟与显示开关，重开自动加载。不会复制字幕文件；移动或删除原文件后需重新指定。首次启用前未记录的字幕需再指定一次。
- WebDAV 连接、目录浏览、海报墙、Range 原画质读取及 CDN 跳转缓存。默认自动识别当前显示文件夹内的视频：单视频直接播放，多视频弹出选择列表。每个文件夹最多读取 8 个目录、向下两层、120 个视频，并控制并发和缓存；超出范围保留原目录浏览。**不会递归汇总整个网盘，也不保证每部影片有海报**。
- 海报优先使用目录封面，缺失时尝试当前 Emby 账号的精确匹配。字幕搜索、中文角色资料和连载状态受上游资料完整性影响。
- WebDAV 下载速度取决于服务和网络；程序缓存不能补足长期带宽不足。RIFE 的可用速度取决于显卡、模型、分辨率及环境，不承诺 4K HDR 最高档实时稳定。
- Mac 使用 Infuse 官方返回回调记录退出时的位置，不能保证强制退出/断电后仍有最新进度；Windows 的 mpv 自动接播脚本不迁移到 Mac。
- 服务只监听本机。不要直接暴露到公网；这不是多人托管服务。

## 验证与发布

```powershell
npm test
python tools/audit_publication.py
python tools/package_source.py
```

可用 `MPV_TEST_EXE` 指定真实 mpv 路径运行合成音频接播/进度测试；未安装时这两项会跳过。Mac 构建后可运行 `node --test platforms/macos/tests/*.cjs`。测试不等同于跨设备 GPU 或 Mac 实机验收。

发布树不包含个人 Emby/WebDAV 账号、服务器地址、观看记录、媒体、日志、私人截图、Python 环境或 GPU 编译缓存。第三方代码保留原许可；本仓库没有用单一许可证重新授权全部内容，见 [第三方说明](docs/third-party.md)。
