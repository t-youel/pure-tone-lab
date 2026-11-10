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
your path, and a song that fits your voice. 

**First Notes:** the starting point for every new singer, built to need no reading and to fit on one screen,
with big picture buttons along the top (Home, Games, Again, Next, Helpers). Seven games: Wake the bird (free play),
Mother bird home (fly her back to her chicks on the target note), Balloon ride (up to the clouds and back),
Frog hops (copy two or three lily pads), Grow a flower (hold a steady note), Piano play-along (tap the glowing key
to play a song, then sing along), and Sing a song. The daily routine plays five of them by itself; each starts after
a short demo or as soon as the singer makes a sound. Every scale note has its own colour, the scale shows as
coloured lanes, and labels show the note being sung and the target. Each day adds a flower to a garden.
Design choices follow research on visual learning strengths, auditory-memory load and common hearing loss in
Down syndrome, and on app design for people with intellectual disabilities.

**Tone tools:** each measured live from the mic.
- *Exhale meter* (Unit 2): "sss" then "zzz", length and evenness.
- *Gentle onsets* (Unit 3): hard, breathy or scooped starts.
- *Break finder* (Unit 7): one slow siren, where the voice jumps.
- *Blend* (Unit 8): sirens through the break, scoring the jump and any loudness push.
- *Swell* (Unit 9): soft-loud-soft range with steady pitch.
- *Echo* (Checkpoint A, part 2): a new 4-bar tune heard once, sung back from memory.

**Style tools (Stage 4):** while you sing, the app times when each note arrives against the beat, checks for
breaths at the ʼ marks (after commas and line ends) and breaks in the middle of a line, and measures the loudness
shape of each line. Unit 10's check blends the song score with timing, Unit 11's with phrase shape, and the
**Showcase** (Unit 12) puts a full performance next to your first song, with both takes to play and a short
written reflection.

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

## Find your sound (your voice's gifts)

Lab → 🎨 Find your sound. Eleven sounds, each modelled on a famous kind of voice: your easy voice first (everything else is measured against it), then 🐻 low and warm, 🚀 the big climb, 🕊 falsetto, 📣 belt, 🐺 howl (Springsteen: a "whoa-oh" sliding up a fourth and held, open and a little rough), 🦆 twang, 🌬 breathy, 〰 vibrato, 😐 deadpan, 🔥 gentle grit (only if it feels fine; a warning if it gets loud). Each sound shows the note to sing in big letters (▶ Hear the note; the howl shows both notes, the climb low → high), plays it twice, counts 3-2-1, then draws your voice live on a graph with the note names and a green band on the target (green on the note, amber close, red off), with your note and cents ("A3 · on the note ✓", "D3 · 30¢ flat") and four live meters: On the note, Pure tone, Steady, and the sound itself (Depth, Range, Lightness, Power, Howl, Twang, Air, Vibrato, Cool, Rasp). Every attempt is graded (A–D and a score from the four parts, the sound itself counting most), with the parts as bars, one tip for the weakest, ▶ Hear yourself, and your attempts listed (the best counts). Results: every sound you tried by grade; your most natural sound (the one you make most purely and steadily, or an honest 'none yet'); your gifts (B or better), each with what was measured, singers to listen to on your music app (named only), and a song here to use it in.

The slides (🚨 sirens, 🚀 the big climb, 🐻 low and warm) have a path to follow, like the other lessons: a green band a semitone wide each side (low ↗ high ↘ low for the sirens and the climb, never above the top of your range; a slide down and a hold for low and warm), shown in full from the start with its start and top notes named, your starting note played first, and while you sing a playhead with a dot on the path (follow the dot), your voice green on the path, amber close, red off, "on the path ✓ / above the path: come down / below: go up", and an On the path meter; the grade counts how much of the slide you followed, as well as its size and smoothness.

⭐ Start here: a vocal coach's 3 daily exercises, first in the list after your easy voice (from vocal coach Nick Merico's three-step guide, and standard in voice teaching), graded mostly on the exercise itself: 🚨 Sirens on "ooo" (low → high → low on a light, round "ooo": how far, how smooth through the break, how pure); 🎯 Clean starts, coup de glotte (four short "ah!"s in four green boxes on the note; each start is checked: how fast it's on the note, an "h" of air first, or a hard bang, and the facts say how many were clean and what went wrong: "4 starts: 3 clean, 1 breathy"); 🌊 Messa di voce, the swell (one note, soft → strong → soft: the loudness is drawn under the pitch against the dashed wave to follow; graded on how far it grows, the wave's shape, and the pitch staying put while the loudness moves). Each has the drawing, examples, stepping stones ("uh-oh" for the clean start), links to vocal coaches, and training progress; the results list their grades as your daily exercises.

Examples to follow, for every sound: ▶ Hear an example (the app's example voice sings a sketch of the sound on your own notes: a buzzing source through vowel resonances, with the sound's pitch shape and colour: the howl's slide and rasp, the falsetto's float, the twang's 3 kHz ring, breath, vibrato; not a real singer, but the shape to copy); stepping stones up to the harder sounds, each with its own example (the howl: call it, slide it, howl it; falsetto: owl hoot, yawn-sigh, float it; belt, climb, low and grit too); 🎧 Hear real singers do it (folded): the songs and the moment to listen for, opening a search on YouTube, Apple Music or Spotify (their recordings can't be in the app); ⬇ Lower / ⬆ Higher to move a sound's notes, and after an attempt sung well below or above the note, an offer to move the note to where you sang.

🗣 How to make it, in every sound: the voice drawn from the side (our own drawing: jaw and lips, tongue, palate and soft palate, nose, throat, voice box and vocal folds) set to that sound's shape (the howl: jaw dropped for a tall "oh", soft palate lifted, folds firm with a little rasp; falsetto: soft palate up, lips round, folds thin; belt: wide "eh", folds pressed with breath from below; twang: tongue high and forward, a narrowing above the voice box; breathy: folds apart with air leaking; low: voice box low), numbered pointers ①②③ matching three instructions underneath, and ▶ Show me animating it from rest. While you sing, a live mirror: the drawing follows your own jaw and tongue, estimated from your sound (linear prediction finds your first two vowel resonances; the first rises as the jaw opens, the second as the tongue moves forward), with the target shape dashed and one cue ("Open your jaw more", "Tongue further forward"). An estimate from the sound, most reliable on low and middle notes. Training: every attempt is kept with its day; each sound shows your progress (first → best, attempts and days, a small chart), and each gift has 🏋️ Train it.

✍️ Write a song for my voice: an original song shaped for your gift (verses low and easy, a chorus that goes where you shine: up into falsetto, an octave leap, a belted top, long waving notes, quick twangy words, a gritty "yeah"), in your range (the key moves until the top note is one you sang) and a fitting key (minor for low and gritty). Simple starter words on the gift's theme, one syllable per note, 8 beats a line; change any words (✓ Use my words re-fits the tune), 🎲 another one, ▶ hear the tune, 🎤 Sing it opens it on the Sing screen like any song, kept with your songs.

## Find your singing home

Lab → Find your singing home (1 minute). Count to ten in your talking voice (its pitch is measured), then sing "ah" up a ladder of whole steps from just under it, and back down, each note on the moving graph with your talking voice marked. Each note is scored for pitch, steadiness and a clear tone; it stops after two misses (or "That's my top"). The comfortable zone is the longest run of good notes, the sweet spot its best-scored middle. Most voices sing best a few notes (often 3 to 7 semitones) above where they talk. The zone sets the key for songs (profile zlo/zhi) and the sweet spot is where the workout starts.

## Singer's daily workout

Lab → Singer's daily workout (about 10 minutes), four scored parts on the same moving graph: Breath and body (release cues, then one long hum on your home note: how long and how steady); Muscles (a five-note scale up and down on "ah", three rounds a step higher each: accuracy and your top comfortable note); Ear (hear three notes, imagine them in the silence, then sing them with no starting note); Your voice's home (a line of Twinkle in your key with your talking voice marked). The summary shows each score against last time and the area with most room to grow; the workout page shows each area over the last seven workouts.

## Learn from the pros

Lab → Learn from the pros (open from day one). Pick one of the songs in the app (below), or one of your own takes. Everything is analysed on the device: the voice's pitch every 20 ms (from the mid channel, filtered to the voice band), adjusted for the recording's own tuning, split into notes. The graph shows each note as a bar the length it lasts and the voice as a line, with notes more than 25¢ off outlined; tap a bar for that note, drag to move, play along with a moving playhead. Measures: True Tone (% within 20¢, average cents off), flat or sharp lean, vibrato (share of long notes, rate, width), steadiness, note starts (slides), beat (bpm, distance from the beat, feel), key and range, recording tuning. "Save as a pro benchmark" keeps the numbers; "Score my singing like the pros" gives full marks within the pros' typical distance from the note (15–35¢, never stricter than the usual ±15¢). Your own takes are compared with your saved pros.

Three passes:
1. **Learn the song**: notes, key, tempo and beat; short or half-hidden notes found from fainter readings; off-key bars the voice sits well away from are moved back into the key; repeated lines (6 notes matching in at least 5) vote on the tune, so bars are the learned melody; bars take their intended start and length from a sixteenth-note grid when the beat is clear.
2. **Check every note** against the learned tune: cents off, early or late, misses (an off-centre note the other times disagree with, shown red) and deliberate variations (a centred note that differs, dashed purple, not counted wrong).
3. **Fine-tune**: tuning measured from the band's bass line (so flat and sharp are against the band), each note's pitch re-measured with a longer window near the note, tempo re-fitted to the note starts; then re-scored.

### His voice alone (the instrumental)

Every song in the app comes with its official instrumental, so his voice is always separated before the notes are measured (see The songs in the app). Pitch is measured on the voice alone (beat and bass tuning still come from the full song). In practice: 🎤 Hear his voice alone, and 🎧 Sing with the band (headphones on) plays the instrumental from the same moment of the song under you.

### The songs in the app

Learn from the pros opens on the songs that come with the app (in `songs/`, by Josh Woodward, CC BY): Crazy Glue, Afterglow, Coffee and I'm Letting Go. There is no file picking. Tapping a song downloads it with its official instrumental, and his voice is taken out of the band right away:
- Frequency by frequency, not sample by sample: two MP3s of the same mix never match wave for wave, but they match in how loud each frequency is at each moment. The offset between the two is the one that leaves the least behind; each frequency's level is matched; the instrumental's loudness is taken from the song's, and the song's own phases turn the rest back into sound.
- Octave slips are corrected: a note more than 7 semitones from the notes around it moves an octave toward them, with its stretch of the voice line.
- Crazy Glue, Afterglow and Coffee are prepared: notes and every word timed on his voice alone. I'm Letting Go shows his notes; its words come once its structure is confirmed.
- How a song is prepared (`tools/`): `prepare_song.py` separates his voice and lists his sung phrases; the line starts (`*.spans.json`) come from evidence (his phrases and breaths, the bar grid, the chorus melody repeating); `time_words.py` lays each syllable (`syllables.py`) on the sung syllables in each line (dips in his voice and changes of note, the line's last syllable held) and reports any line where fewer syllables are heard than the words have; `build_prep.py` makes one bar per syllable from his pitch line. Stretches that can't be matched to the lyrics (Coffee's ending after the last chorus) get no words.

### Practise this song (one area, under the main graph)

Everything happens on the main graph, with the real recording and the words (the lyric line above, each bar with its word). Pick a line with ‹ Line 3 of 18 › (or Whole song); ✎ Words fixes a line's words.
- ▶ Listen: his line (or the whole song) with the playhead and the words.
- 🎤 My turn: he sings the line, two soft clicks, then you sing or hum it back while the music waits, so the mic hears only you. Your voice is drawn over his bars as you sing.
- 🎧 Sing along: the music keeps playing (headphones on) and every line you pass is scored; with the instrumental, sing along with just the band; with his voice separated, hear his voice alone.
- Controls at the top: one bar stays at the top of the screen while you scroll, with ▶ Play, ⟲ Start, 🎤 Sing along (❚❚ Pause while singing, then ▶ Resume singing from that exact spot), ⏮ start of the line (or the one before, if it has only just started), ↺ 10s, 10s ↻, ⏭ next line, and 🧑‍🏫 Coach; the current words ride along in the bar. Skips keep doing what you were doing (playing, singing along, or just moving there), and the words follow the music.
- 🎤 Sing along next to Play: the rest of the song from where you are (2 seconds before the line), to the end, scoring each line as you pass it. It only scrolls if the words or the graph are off screen.
- No headphones: the song from the speaker leaks into the mic, which would draw his tune while you're silent. The app taps the playback's level, learns how much of it reaches the mic in the quieter moments (the low quarter of the last 6 seconds, matched over the same 0.2 s; it falls at once and only creeps up), and counts the mic only when it's 1.6× louder than that leak.
- The screen stays on while a song plays (Play or Sing along): the app asks for the phone's wake lock on the tap; if the browser refuses (some in-app browsers), it says so once and what works (Safari, or Auto-Lock off).
- Leaving (another app, another tab, the screen locking): the song stops cleanly and its spot is kept. Coming back, a note says where it paused; ▶ Play wakes the sound (iOS leaves it paused) and carries on from there; 🎤 Sing along starts 2 seconds before that line; the mic reconnects if iOS cut it off.
- Speed (🐢 slider in the top bar): 50–90%, Normal in the middle, 110–150%; set steps only, so a song can't end up at 97% by accident. Off normal, the speed shows in orange with ↺ Normal (tap the speed to go back too). Slower doesn't lower the notes: a slowed copy is made that keeps every note on pitch (WSOLA: overlapping 46 ms slices spread out, each nudged up to ±12 ms to join smoothly), once per speed (about 1–3 s for a 3-minute song). Play, Sing along, the coach and the words all run at that speed; singing alone is expected at the same pace.
- 📋 How you did (after singing along with the whole song, or the 📋 button any time): your score and how many lines you sang, against last time; how close you stayed to his notes (% within 25¢ and within 50¢); the one or two habits that cost the most (flat or sharp on average, the high notes, the low notes, early or late, long notes drifting, words going missing, or the mic barely hearing you); the three lines most worth practising, each with one tip (a wrong note is named as a wrong note, not '515¢ flat'), 👁 to show it on the graph and 🧑‍🏫 Coach this line; your best line; ▶ Play my take (your recording, with the playhead moving over his bars and your line); 🎤 Sing it again.
- The mic for songs: echo cancelling is on in Learn from the pros (the song from the speaker is taken out of the mic, as on a phone call), and the leak filter only drops sound that isn't clearly louder than the song's leak (1.6×), so your line is drawn while you sing. The voice exercises keep the raw mic for the most exact pitch.
- 🧑‍🏫 Coach (in the top bar): one line at a time, all in the main view. The bar shows the line (⏮ ⏭, ✕ Done), ▶ Hear him, 🎤 Sing with him (the music plays while you sing) and 🎤 Sing alone (he sings it, then you sing while the music waits). Your score, one tip naming the word, ↻ Again, and Next line when it goes well (Lock in the note when a line keeps going wrong) show right under the words; the Practise panel is hidden meanwhile. The same scoring as line-by-line practice.
- Words only where he sings, and never guessed: from a full mix the app can't reliably tell his voice from a guitar, so it shows no words and says to add the instrumental (that box comes first). There are no tap-to-sync buttons.
- Prepared songs (Crazy Glue): his notes and every word were timed offline on his voice alone (the song minus its official instrumental, see `tools/prepare_song.py`) and checked, then built into the app. They load with no instrumental and no tapping.
- With the instrumental added: his notes are split into syllable-sized sounds (a new note, or a short dip in loudness where a consonant cuts the vowel), the lyric lines are matched to his sung phrases, and the words' syllables to the sounds in each phrase. Long words are split so each note gets one (gra-vi-ty); the intro shows ♪. Words typed for a line (✎ Words) are kept and never re-placed.
- ■ Stop and ↻ Again at any time. After a try: a score, each word's bar green/gold/red, one tip (the word that was off and how he sings it, timing, a cue), and help when a line keeps going wrong (🎯 Lock in the note on a live meter, 🎤 hear his voice alone, hum it first). ✓ when a line is learned (80+, every note within 35¢), kept between visits, with progress for the song.

## Advice after a song

The advice leads with the one thing that matters most. A tune sung in another key (most notes off by about the same amount, the shape intact) is called what it is: "You sang the tune 2 semitones lower than written: in C instead of D", with how much of the tune was right once the shift is taken out, the notes that were right in your key marked ✓ in your key, and two ways forward: 🎯 Move the song to my key (sing it again there and every note can score) or ▶ Hear the first note (the first note sets the key). The rest of the pitch advice (flat or sharp, uneven pitch, jumps) is then judged in your key, so it doesn't repeat the same shift as twenty errors.

## Your take, note by note

After every song, the results show the same graph as Learn from the pros for your own singing: each note of the song as a bar (its length is how long it lasts, its word underneath), your voice as a line, notes more than 25¢ off outlined with their cents, and ▶ Play to hear your recorded take with the playhead moving along.

## Your starting point

On the first day, Unit 1 starts a 4-minute voice check-up before any training: Find your voice, Pitch match (5 rounds), one long note held as long as is comfortable (up to 15 s), a first song recorded and kept, and a short "how do you feel" question with goals. It scores 11 parts of the voice (range, pitch matching, flat or sharp, steadiness, breath, clear tone, singing a song, clean starts, resonance, timing, confidence). Progress shows them, plays the first song back, and after a retake (same song, key and tempo, no guide tone) shows then vs now for each part.

## Voice Tutor

Opens at Level 2 (after the Stage 1 basics). Pick a popular song in **Lab → Voice Tutor: sing with the band** and sing it through. Then:

- **Hear it with the band**: your take with drums, bass and piano, with sliders for your voice and the band.
- **Your lines**: each line marked Sung well, Nearly there or Needs work, with **▶ Hear me** (that line of your take) and **♪ How it goes**.
- **Your Voice Tutor**: praises your best line, names the hardest line and the word that went wrong (flat, sharp or missed), and says why and what to do. It builds a lesson on the fly: the tricky notes slowly, the whole line slowly, the line at full speed, then back with the band. After the retry it compares the line and the whole song with before, then plans the next lesson, or suggests a faster tempo or the next song once every line is in good shape.

## Backlog

- **Body signals while singing.** Measure heart rate, breathing rate and heart-rate variability by holding a fingertip
  over the phone camera (photoplethysmography: the camera sees the tiny colour change of each pulse), and line them up
  with the singing data. Questions to explore: does a calmer pulse or slower breathing before a song predict purer
  tone, steadier pitch or longer phrases? Could a 30-second calm-breathing exercise be suggested when the pulse is high?
