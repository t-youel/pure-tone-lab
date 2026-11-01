# Pure Tone Lab

A browser app that listens to your voice and gives instant feedback on pitch, tone purity and tone color, and on extra notes such as overtones and undertones. It maps where your voice is strongest and helps you sing songs in that range.

- **Listen**: note and cents, a purity score (clarity, steadiness, harmonic focus), harmonics 1–10, "sounding now" notes, a spectrogram and a pitch trail.
- **My voice map**: time and purity for each note from C2 to C6, your strongest 9-semitone zone, and the pure tones you've found, played back in your own timbre.
- **Sing**: warm-ups and public-domain songs moved into your zone, with note-by-note guidance, plus new melodies composed from your purest notes.

It's one file, `index.html`, with no build step. All audio analysis runs in your browser, and your data stays in that browser's local storage. The microphone needs https or a local file.

## Levels

Five short levels, 13 lessons in all. Each exercise is a lesson in one level only, and rock & roll starts in Level 1:

1. **Foundations:** find your voice, Do-Re-Mi, match a note, and your first song (When the Saints Go Marching In).
2. **Breath & tone:** a steady hold, open-airway vowels, Rock and Roll Morning (a 12-bar blues).
3. **Pitch & leaps:** leaps, Jukebox Jive.
4. **Full-speed rock:** a rock song at Normal tempo, and your own melody.
5. **Advanced:** pure rock tone, and overtone singing.

The rock songs are a traditional song (When the Saints) and originals written for the app; copyrighted hits are not included.

## Guide tone

When a note is hard to find, the app can keep it playing while you sing: with the "🎵 Note on" button on the Sing screen (the note plays the whole time, in songs and in coach mode), in Coach mode ("Sing along", the
safety net below "Echo 3 notes"), in Pitch match (automatically after two reminders, or always with
"Keep the note playing"), and in Steady hold ("Guide on"). The tone softens once you are in the green band.
The microphone path runs through a narrow notch filter at the guide's frequency, so the app hears the singer
(through the overtones every voice has) and not the speaker. Headphones still help.

## Tests

`node tests/run.js` runs the end-to-end suite in headless Chromium with a simulated voice
(an oscillator fed into the analyser), so pitch, purity, levels, songs and buttons are checked
without a microphone. It needs the `playwright` package and its Chromium. The same suite runs
on GitHub Actions after every push.

## Backlog

- **Body signals while singing.** Measure heart rate, breathing rate and heart-rate variability by holding a fingertip
  over the phone camera (photoplethysmography: the camera sees the tiny colour change of each pulse), and line them up
  with the singing data. Questions to explore: does a calmer pulse or slower breathing before a song predict purer
  tone, steadier pitch or longer phrases? Could a 30-second calm-breathing exercise be suggested when the pulse is high?
