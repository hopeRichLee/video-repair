# 视频修复助手

Windows 10/11 x64 离线视频诊断与修复工具。支持 MP4、MOV、M4V 和 3GP，原文件始终保持不变。

## 开发

```powershell
npm install
npm run prepare:binaries
npm run dev
```

## 验证与打包

```powershell
npm test
npm run build
npm run dist
```

安装包生成在 `release` 目录。该安装包未签名，首次安装时 Windows 可能显示未知发布者提示。

## 修复顺序

1. FFprobe 诊断容器、轨道、时长和典型损坏。
2. FFmpeg 无损重封装并重新生成时间戳。
3. MP4/MOV 索引缺失时，使用同设备正常视频配合 untrunc 重建索引。
4. 没有参考视频时，可选择实验恢复，自动尝试 iPhone 6 的 1080p30、1080p60 和 720p30 H.264 参数。
5. untrunc 在坏包处提前停止时，自动启用逐字节扫描和动态轨道统计，继续寻找后续画面。
6. 无损结果无法解码时，转为 H.264/AAC；索引恢复结果至少需要解出预期视频帧的 50%。
7. 多个恢复结果按视频轨、恢复时长、文件大小和实际解码比例择优，再生成正式输出文件。

详细的第三方软件来源及许可证见 `THIRD_PARTY_NOTICES.txt`。
