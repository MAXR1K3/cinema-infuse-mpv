# Windows / mpv

配置以 dyphire/mpv-config 为基础，包含本项目的 RIFE 选择器、SDR/HDR 处理、右键画质菜单和现代播放控件修改。安装器只作用于你明确给出的 mpv 目录，本仓库不会自动修改系统播放器关联。

## 运行依赖

- mpv Windows 构建：建议使用支持 gpu-next、D3D11 及所需 VapourSynth 滤镜的版本。播放器程序不纳入 Git。
- Node.js >=22：影院服务无额外 npm 运行依赖。
- RIFE 可选：VapourSynth + 与其 Python 版本匹配的 `vs-rife` 或 `vs-mlrt`，以及对应模型/推理后端。`.vpy` 的 import 清楚标明各脚本所需接口。vs-mlrt 源码见 https://github.com/AmusementClub/vs-mlrt ，vs-rife 见 https://github.com/HolyWu/vs-rife 。
- NVIDIA TensorRT 后端必须使用匹配 CUDA、驱动、TensorRT 和显卡的插件。`trt_cache`/engine 不可作为通用环境搬运；新机器首次编译可能较慢。
- 辅助组件如 ffmpeg、yt-dlp、字幕同步/翻译服务按所用脚本的上游说明另装。`display-info.dll` 是可选插件，未随源码分发；不安装时没有显示器检测能力。

默认 RIFE 选择器不自动开启；安装后先验证普通 SDR、HDR/DV 播放，再主动启用需要的增强。普通硬解/杜比视界路径与补帧不是同一处理链；本项目不承诺 RIFE 处理后保留 DV 动态元数据。

## 个性化设置

编辑根目录 `config.local.json`：

```json
{
  "mpvExe": "D:/Apps/mpv/mpv.exe",
  "libraryRoot": "D:/Movies",
  "port": 7788
}
```

环境变量 `MPV_EXE`、`MPV_LIBRARY_ROOT`、`MPV_LIBRARY_PORT` 等可覆盖启动器设置。Emby 和 WebDAV 在本机界面设置；勿把账号写入配置后提交到 Git。

`portable_config` 是安装模板，其中 `@MPV_ROOT@` 等占位符由 configure.cjs 展开；请勿直接把未展开的模板当成安装后的目录。已有播放器请先整体备份，再选择是否使用 `--force` 覆盖同名配置。
