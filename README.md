# Safe Audio

A safe listening calculator whose volume slider follows the logarithmic curves real operating systems use, instead of a straight line.

Follow the six steps: headphone sensitivity, headphone impedance, source output at full volume (volts, or mW into a load), volume slider type, slider position, and what you play. It estimates the level at the ear, the safe listening time (NIOSH: 85 dBA for 8 h, halving every 3 dB) and your dose for the day.

## Slider curves

| Curve | Model |
| --- | --- |
| Linux | PulseAudio / PipeWire cubic: amplitude = percent³ (60·log10 dB) |
| Linux driver | ALSA, driver specific: linear in dB over the range from `amixer` (dBscale-min) |
| Windows | Approximation: amplitude = scalar² (40·log10 dB) |
| Android | AOSP default headset curve, 15 steps |
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
