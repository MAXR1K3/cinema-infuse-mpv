Cinema Infuse · Apple 芯片 Mac 版

这是什么
沿用现有片库界面、Emby 分类与组合筛选、详情、收藏、追剧、字幕下载和 WebDAV 海报墙；播放交给你已经安装的 Infuse。
包内包含 Apple Silicon Node.js 运行环境，不需要另装 Node、Homebrew 或 mpv。
不包含 mpv、RIFE、VapourSynth、TensorRT、Windows 画质配置、服务器账号、密码或你的观看记录。

开始使用
1. 用 macOS 自带“归档实用工具”解压 ZIP，保留目录结构。
2. 把 Cinema Infuse.app 放到“应用程序”（也可以保留整个文件夹放在固定位置）。
3. 确认 Infuse 已安装并至少打开过一次。起播位置与返回回调需要 Infuse 8.4.7 或更新版本。
4. 双击 Cinema Infuse.app。它会启动仅本机可访问的片库，并在默认浏览器打开 http://127.0.0.1:7788/。
5. 在界面里重新连接你的 Emby 和 WebDAV。Windows 上加密保存的登录不能直接复制到 Mac。
6. 选择影片或 WebDAV 视频，点击播放，应用会唤起 Infuse。
7. 片库服务要在 Infuse 播放期间保持运行。播放完使用 Infuse 的返回操作回到片库，回调会保存返回的位置。未返回、强制退出或断电时不会承诺已保存最新位置。

进度和连播
此版本通过 Infuse 官方 x-callback-url 回传保存“退出返回时”的位置，不读取 Infuse 私有数据库，也没有实时抓取正在播放状态。
Emby 作品已知总时长时，会沿用 95% 已看完规则；本地和 WebDAV 作品没有总时长资料时，只保存续播位置，不猜测是否看完。
Infuse 原生资料库的进度与本片库的回传记录不是同一个数据库；如果同时使用 Infuse 的 Emby 连接，请以服务器同步结果为准。
“继续观看”的下一集推荐保留；Windows 的 mpv 自动接播脚本没有迁移，连续播放请使用 Infuse 自身能力。

本地影片目录
默认扫描 ~/Movies。
首次启动后可在以下文件修改配置，然后停止片库并重新打开应用：
~/Library/Application Support/Cinema Infuse/config.json

示例：
{
  "libraryRoot": "/Volumes/你的NAS/Movies",
  "port": 7788
}
请填写实际挂载目录，不使用 Windows 的 Z: 或 F: 盘符。修改 JSON 时保留英文引号、冒号及逗号。
若可信局域网 Emby 只提供 HTTP，可以在配置中显式增加 "allowLanHttp": true；公网登录优先使用 HTTPS。

数据、日志与停止
连接信息、收藏和进度：~/Library/Application Support/Cinema Infuse/
运行日志：~/Library/Application Support/Cinema Infuse/logs/server.log
登录信息文件经过 AES-256-GCM 加密；随机密钥保存在当前 macOS 用户的钥匙串中。首次访问钥匙串时可能需要你允许访问。
关闭浏览器不会停止后台服务。使用“停止片库.command”停止，随后可以重新打开应用。
不要在 Infuse 正通过本机代理播放时停止服务。
应用升级只替换 .app，用户目录中的设置与数据保留。

签名与验证状态
这是从 Windows 构建的 .app ZIP，未进行 Apple Developer ID 签名和公证，也没有在真实 Mac 上执行过。
如果 macOS 阻止首次打开，请检查“系统设置 > 隐私与安全性”中针对该应用的提示，并仅在确认来源后允许打开本应用；不要关闭系统整体安全保护。
已检查所有 JavaScript 语法、应用包结构、Apple ARM64 Mach-O 架构、ZIP 可执行权限和 Node 官方 SHA-256；已测试钥匙串接口契约、Infuse 链接参数、回调校验、本地 Range 和进度持久化。
钥匙串实际授权、Finder 启动及 Infuse 的跨应用返回，需要在你的 Mac 上最终验证。遇到问题可提供 server.log，注意先检查并删去不希望分享的文件名或服务器地址。

来源
Node.js 官方运行时：https://nodejs.org/dist/latest-v22.x/
Infuse 官方接口：https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services
