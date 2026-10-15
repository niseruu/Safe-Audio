# Safe Audio

A safe listening calculator whose volume slider follows the logarithmic curves real operating systems use, instead of a straight line.

Pick your headphone (sensitivity and impedance) and source (max output voltage), choose a slider curve, and it estimates the level at the ear, the safe listening time (NIOSH: 85 dBA for 8 h, halving every 3 dB) and your dose for the day.

## Slider curves

| Curve | Model |
| --- | --- |
| Linux | PulseAudio / PipeWire cubic: amplitude = percent³ (60·log10 dB) |
| Windows | Approximation: amplitude = scalar² (40·log10 dB) |
| Android | AOSP default headset curve, 15 steps |
| Apple | Approximation: exponential taper, 16 steps |
| Generic dB | Linear in dB over an adjustable range |
| Linear | Naive straight-line model, for comparison |

The Windows, Android and Apple curves are approximations. Those platforms do not publish exact gain tables and they vary by driver and manufacturer.

## Run it

It is a static site. Open `index.html`, or serve the folder with any static server and deploy it to GitHub Pages.

## Tests

```
node --test tests/curves.test.js
```
