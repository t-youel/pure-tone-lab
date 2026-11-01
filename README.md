# Pure Tone Lab

A browser app that listens to your voice and gives instant feedback on pitch, tone purity and tone color, and on extra notes such as overtones and undertones. It maps where your voice is strongest and helps you sing songs in that range.

- **Listen**: note and cents, a purity score (clarity, steadiness, harmonic focus), harmonics 1–10, "sounding now" notes, a spectrogram and a pitch trail.
- **My voice map**: time and purity for each note from C2 to C6, your strongest 9-semitone zone, and the pure tones you've found, played back in your own timbre.
- **Sing**: warm-ups and public-domain songs moved into your zone, with note-by-note guidance, plus new melodies composed from your purest notes.

It's one file, `index.html`, with no build step. All audio analysis runs in your browser, and your data stays in that browser's local storage. The microphone needs https or a local file.

## The Pure Tone Path

A 12-unit course in four stages, following the usual teaching order (body, ear, tone, style and performance):

1. **Body:** your voice today (range, voice type and a baseline song), posture & breath, finding the sound.
2. **Ear:** pitch matching, inner hearing & intervals, then **Checkpoint A** (the scale in solfège).
3. **Tone:** vowels & resonance, registers, blending the passage, dynamics & tone color.
4. **Style & performance:** rhythm & phrasing, interpretation, showcase.

Each unit runs Experience → Name it → Practise. A unit is passed with one skill-check score of **70+**, or with **three tries of 50+**.
Stages 1–2 are planned as the free tier; a `PAYWALL` switch (off for now) locks later units behind Pro.
Home is **Today**: the current unit, a voice check-in (a scratchy voice gets a gentle day and the see-a-doctor rule),
your path, and a song that fits your voice. Units 10–12 use a song as the skill check until the style tools are built.

**Tone tools:** each measured live from the mic.
- *Exhale meter* (Unit 2): "sss" then "zzz", length and evenness.
- *Gentle onsets* (Unit 3): hard, breathy or scooped starts.
- *Break finder* (Unit 7): one slow siren, where the voice jumps.
- *Blend* (Unit 8): sirens through the break, scoring the jump and any loudness push.
- *Swell* (Unit 9): soft-loud-soft range with steady pitch.
- *Echo* (Checkpoint A, part 2): a new 4-bar tune heard once, sung back from memory.

**Progress & recordings:** every song you sing through is recorded on the device (compressed audio, about
0.5 MB a minute) with a small pitch trace. Your first and best takes are always kept, and you can star others.
Progress compares you with your starting point (range, scores, notes in tune), keeps weekly 1–5 comfort scores,
and has a Storage panel: space used, delete per take, "Delete all but kept", recording on/off, and auto-delete of
unkept takes after 30 days (on by default).

**Solfège:** Do-Re-Mi songs and exercises show the Curwen hand signs, drawn at rising heights, with the current
syllable lit up. *Climb the Ladder* is an original solfège song written for the app, and *Solfège patterns* drills
steps, skips and turn-arounds (Unit 4 and 5 point to both).

The songs are traditional (When the Saints), public-domain hymns, folk melodies with new verses, and originals
written for the app; copyrighted hits are not included.

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
