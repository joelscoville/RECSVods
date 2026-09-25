{ pkgs, ... }:
{
  packages = with pkgs; [
    nodejs_22
    pnpm
    python3
    git
    yt-dlp
    ffmpeg
    whisper-cpp
  ];
}
