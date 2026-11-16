---
status: accepted
---
# Background blur is a small model running in the browser

The owner asked for the background of the camera out of focus, not for colour filters. Telling a person from what is behind them needs a segmentation model. It runs in the browser, so no picture goes to a server to be processed.

`@mediapipe/tasks-vision` (Apache 2.0, pinned, no dependencies, `npm audit` clean) carries the runtime, a 14 MB WebAssembly file copied to `/assets/vision/` at build. The model is Google's selfie segmenter, 250 kB, kept in the repository at `web/public/assets/models/selfie_segmenter.tflite` (SHA-256 `191ac952…226658b`) so that nothing is fetched from another origin. Both load only when someone chooses a blur. Each frame is shrunk to 256 pixels wide for the model, and the mask it answers cuts the person out over a blurred copy of the frame.

Which side of the mask is the person was not something we could look at while writing this, so the code settles it by looking: a person is in the middle and low in the picture, the background in the upper corners, and the side that agrees is taken as the person. A camera pointed at an empty room has no person to find and is blurred whole.

Changing the blur, or turning it off, keeps the camera: only what is drawn from it changes.

Like the whiteboard (ADR 0009), this is code we did not write running in the page, and it bends ADR 0007 the same way: before end-to-end encryption ships it runs where it cannot reach the key.

What it costs: processor or graphics time on every frame while on, and a picture that slows down when the tab is hidden, because browsers stop drawing hidden tabs.
