# 第三方来源与许可

此项目组合多种独立许可的软件和配置。保留每个文件的作者、版权及许可证，仓库公开不改变第三方的许可，也不代表已获得对所有代码的重新许可授权。

- mpv 配置基础：https://github.com/dyphire/mpv-config 。原说明和许可索引位于 Windows portable_config 内的 README.md / LICENSE.MD。
- uosc：https://github.com/tomasklaen/uosc ，随附 scripts/uosc/LICENSE.LGPL（LGPL 2.1）。此副本有本项目的播放界面修改；修改源码一并公开，未改用其他许可证。相关 uosc 图标/纹理字体遵循上游许可。
- 其他 Lua、GLSL、现代 OSC 等组件：以文件内作者/来源/许可证为准，不删除已有许可头。可选 DLL、模型、Python 包和播放器二进制另行从对应上游获取。
- Noto CJK 字体：https://github.com/notofonts/noto-cjk ，SIL Open Font License 1.1；许可证位于 portable_config/fonts/OFL-Noto.txt，版权信息亦保留在字体元数据内。
- Node.js：https://nodejs.org/ ，Mac 运行时下载器校验官方 SHA-256，构建产物附 Node LICENSE。下载的运行时不提交到仓库。
- Infuse 是 Firecore 的独立产品，需另行安装；本项目仅调用公开播放接口：https://support.firecore.com/hc/en-us/articles/215090997-API-for-Third-Party-Apps-Services 。

第三方服务需使用者自己的账号和授权。已清空集成脚本中的静态 API key/token；不随项目发布任何私人账号或测试媒体。
