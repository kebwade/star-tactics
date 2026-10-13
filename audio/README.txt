背景音乐放这里（audio/）
========================================

  audio/bgm.m4a     整个游戏的背景音乐（循环播放）

★ 和立绘一样，文件名固定，被 js/ui.js 里的 BGM_SRC 直接引用：

     var BGM_SRC = 'audio/bgm.m4a';

  想换音乐：直接把新文件覆盖成这个名字就行，代码一个字都不用动。
  换成 mp3 / ogg 也可以，只要把 ui.js 里那一行的扩展名一起改掉。

这段音乐是怎么来的
----------------------------------------
user 提供的视频（微信保存的 mp4，HEVC 画面 + AAC 音轨，约 16 秒）里
那条**音轨**，用 Windows 自带的 Media Foundation 转码器抽出来的：

  powershell -NoProfile -ExecutionPolicy Bypass -File tools\_extract-audio.ps1 ^
      -In "原始视频.mp4" -Out "audio\bgm.m4a" -Bitrate 160000

  · 机器上没装 ffmpeg，走的是 Windows.Media.Transcoding（系统自带，零安装）。
  · 只取音轨：输出是纯音频 m4a，视频那 2.5 MB 不会一起带上（317 KB）。
  · 想验证结果结构对不对，跑 tools\_probe-mp4.ps1 看盒子树（应当只有 1 个
    音频 trak，mdat 不越界）。

播放上的几个约定（都在 js/ui.js 里写着注释）
----------------------------------------
  · **不用 WebAudio 接播放器**：本作是双击 index.html 用 file:// 打开的，
    file:// 下的媒体会被当成跨域，接进 createMediaElementSource 会直接静音。
    所以直接播 <audio loop>，音量用 el.volume。
  · 浏览器不允许自动播放有声媒体 → 第一次点击/按键时才 play()。
  · 音乐音量 = 总音量 × 音乐音量 × 2（默认 0.75 × 0.30 → 0.45），
    在「设置 → 背景音乐」里调，拉到 0 就是静音。
  · 文件读不出来（被删了 / 浏览器不支持 AAC）会自动退回原来那段
    现场合成的五声音阶琶音，不会变成"点了没反应"。
