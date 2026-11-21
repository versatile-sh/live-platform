# The computer's sound with a screen

Chrome and Edge send the whole computer's sound with a screen on Windows and on macOS 14.2 or later: choose *Entire screen* and tick *Share system audio*. Firefox and Safari send no computer sound. On Linux, Chrome sends only a tab's sound; the helper [`screen-audio.sh`](../web/public/assets/screen-audio.sh) uses `pactl` (PulseAudio or PipeWire, no root) to route the desktop's sound into a device the page can share:

```sh
curl -fsSL https://live.versatile.sh/assets/screen-audio.sh -o ~/.local/bin/screen-audio && chmod +x ~/.local/bin/screen-audio
screen-audio on     # before sharing
screen-audio off    # gives the sound back to the original device
```

In a call, the screen button's menu shows a guide for your system when a screen goes out without its sound.
