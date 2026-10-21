# Safe Audio

A safe listening calculator whose volume slider follows the logarithmic curves real operating systems use, instead of a straight line.

Follow the five steps: headphone (sensitivity as dB/mW or dB/V, plus impedance when it is in dB/mW), source output at full volume (volts, or mW into a load), what you play (content type, defaulting to typical music, and EQ preamp), volume slider type, and volume position (a volume slider, a linked 0 dB to max dB SPL level slider, and buttons for how long you listen each day that set the loudest safe volume, snapped down to a real step on Android and Apple). It estimates the level at the ear, the safe listening time (WHO/ITU by default: 80 dB for 8 h a day, or NIOSH: 85 dB for 8 h; both halve every 3 dB, and 70 dB and below is unlimited) at that level.

## Slider curves

| Curve | Model |
| --- | --- |
| Linux | PulseAudio / PipeWire cubic: amplitude = percent³ (60·log10 dB) |
| Linux driver | ALSA, driver specific: linear in dB over the range from `amixer` (dBscale-min) |
| Windows | Approximation: 1.75-power taper between the device's minimum dB and 0 dB, `35 * log10(a + (1 - a) * slider)` with `a = 10^(min / 35)`. Matches a public measurement (−10.3047 dB at 50% on a −63.5 dB device) |
| Android | AOSP music curve (−58, −40, −17, 0 dB at curve indexes 1, 20, 60, 100), 15 steps, step 0 mutes. Verified against the AOSP source |
| Apple | Approximation: exponential taper, 16 steps |
| Custom dB | Linear in dB over an adjustable range, for any other device |
| Linear | Naive straight-line model, for comparison |

The Windows, Android and Apple curves are approximations. Those platforms do not publish exact gain tables and they vary by driver and manufacturer.

## Run it

It is a static site. Open `index.html`, or serve the folder with any static server and deploy it to GitHub Pages.

## Tests

```
node --test tests/curves.test.js
```

## Author

Built by [M Shafri Syamsuddin](https://shafri.pages.dev/), AI Engineer. The page carries a small credit linking back to the portfolio.
