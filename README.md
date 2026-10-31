# Pure Tone Lab

A browser app that listens to your voice and gives instant feedback on pitch, tone purity and tone color, and on extra notes such as overtones and undertones. It maps where your voice is strongest and helps you sing songs in that range.

- **Listen**: note and cents, a purity score (clarity, steadiness, harmonic focus), harmonics 1–10, "sounding now" notes, a spectrogram and a pitch trail.
- **My voice map**: time and purity for each note from C2 to C6, your strongest 9-semitone zone, and the pure tones you've found, played back in your own timbre.
- **Sing**: warm-ups and public-domain songs moved into your zone, with note-by-note guidance, plus new melodies composed from your purest notes.

It's one file, `index.html`, with no build step. All audio analysis runs in your browser, and your data stays in that browser's local storage. The microphone needs https or a local file.
