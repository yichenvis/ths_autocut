# 视频编辑器 Node.js 版

这是一个使用 Node.js 实现的视频编辑工具，原版是用 Python 编写的。它使用 FFmpeg 处理图像并创建带背景音乐的视频。

## 项目内容

本项目是一个完整的视频编辑应用程序，主要功能包括：
- 将图片转换为视频
- 为视频添加背景音乐
- 自定义视频帧率和每张图片显示时长
- 设置自定义视频分辨率
- 提供直观的 Web 界面用于操作

## 功能特性

- 将图片转换为视频，可自定义 FPS 和每张图片的显示时长
- 为视频添加背景音乐
- 按前缀过滤图片
- 设置自定义分辨率的输出视频
- 拖拽上传图片
- 图片排序和管理
- 视频预览功能
- 导出生成的视频

## 安装部署

### 基本安装

1. 确保已安装 Node.js
2. 安装项目依赖:
   ```
   npm install
   ```

### FFmpeg 设置

本应用程序可以通过两种方式使用 FFmpeg:

1. **系统级 FFmpeg**: 如果 FFmpeg 已安装并在您的 PATH 环境变量中
2. **本地 FFmpeg**: 您可以将 FFmpeg 二进制文件放在项目目录中:
   - `ffmpeg/bin/ffmpeg` (Linux/macOS)
   - `ffmpeg/bin/ffmpeg.exe` (Windows)

应用程序将自动检测以下位置的 FFmpeg:
- `ffmpeg/bin/ffmpeg`
- `ffmpeg/bin/ffmpeg.exe`
- `bin/ffmpeg`
- `bin/ffmpeg.exe`

如果在这些位置都找不到，将默认使用 "ffmpeg" 命令（期望在 PATH 中）。

### 启动运行

1. 启动服务器:
   ```
   npm start
   ```

2. 打开浏览器并访问 `http://localhost:3000`

3. 在表单中填写所需设置:
   - 上传图片: 通过拖拽或点击选择图片文件
   - 背景音乐: 从下拉列表中选择背景音乐
   - 每张图片显示时长: 设置每张图片显示的秒数
   - FPS: 设置输出视频的帧率
   - 输出分辨率: 设置视频的宽度和高度
   - 性能模式: 可选择标准模式或低性能模式

4. 点击"生成视频"开始视频创建过程

5. 视频生成后可预览并导出

## API 接口

- POST `/create-video` - 从图片创建视频
- GET `/music-files` - 获取可用的背景音乐文件列表

## 部署到 CentOS 9 Stream

当部署到 CentOS 9 Stream 或其他 FFmpeg 可能不在 PATH 中的服务器环境时:

1. 下载 FFmpeg 静态构建包:
   ```bash
   mkdir ffmpeg
   cd ffmpeg
   wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-git-amd64-static.tar.xz
   tar xvf ffmpeg-git-amd64-static.tar.xz
   mv ffmpeg-git-*/ffmpeg ./ffmpeg
   chmod +x ffmpeg
   ```

2. 应用程序将自动检测并使用这个本地 FFmpeg 二进制文件。

## 注意事项

- 服务器性能较弱，目前稳定可设置的视频分辨率为：1080*2048，帧率为30，尽量不要修改默认属性
- 为了保证系统稳定性，建议使用默认的分辨率和帧率设置