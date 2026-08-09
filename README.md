# 视频修复助手

Windows 10/11 x64 离线视频诊断与修复工具。支持 MP4、MOV、M4V 和 3GP，原文件始终保持不变。

## 主要能力

- 选择文件后自动预检媒体结构、修复策略和磁盘空间。
- FFmpeg 无损重封装并重新生成时间戳，失败后自动进行 H.264/AAC 容错转码。
- MP4/MOV 索引缺失时，使用同设备正常视频配合 untrunc 重建索引。
- 无参考实验恢复支持通用 H.264/H.265、720p/1080p/4K、30/60 fps 参数组合，并缓存生成的参数样本。
- 索引恢复可跳过未知坏字节，继续搜索后续画面。
- 输出结果执行完整解码验证，展示可解码帧、解码比例、时长、文件大小和风险提示。
- 最近 100 条任务仅以元数据形式保存在本机，可删除或清空。

## 开发

```powershell
npm install
npm run prepare:binaries
npm run dev
```

## 验证与打包

```powershell
npm test
npm run test:media
npm run build
npm run dist
```

生成未安装目录后可运行真实 Electron 界面冒烟测试：

```powershell
npx electron-builder --win dir --x64
npm run smoke:electron
npm run smoke:packaged-repair
```

安装包生成在 `release` 目录。安装包未签名，首次安装时 Windows 可能显示未知发布者提示。

第三方软件来源及许可证见 `THIRD_PARTY_NOTICES.txt`。
