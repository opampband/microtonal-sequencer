// Based on: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Advanced_techniques

/**
 * Holds information about a tuning (e.g. 12 EDO, just intonation)
 * Octave-agnostic but internally stores the 4th octave.
 * Caching of other octaves may eventually be implemented.
 * A tuning is considered immutable (so that it can be commoned).
 */
class Tuning {
  constructor() {
    // List of frequences in one octave.
    // This is assumed to be the 4th octave because A4 is a common reference
    // tone.
    this.pitches = [];
  }

  /**
   * The number of distinct pitches in one octave.
   */
  get length() {
    return this.pitches.length;
  }

  getNote(n) {
    return this.pitches[n];
  }

  /**
   * Returns the frequency of the desired note in the desired octave.
   * @param octave The octave (e.g. 4)
   * @param note Index of the note within the octave (e.g. 9)
   *             (zero indexed)
   * @return The frequency of the note in the octave (e.g. 440)
   */
  getNoteInOctave(octave, note) {
    // TODO implement caching
    let octaveScaleFactor = Math.pow(2, octave - 4);
    return octaveScaleFactor * this.getNote(note);
  }
}

class EDOTuning extends Tuning {
  /**
   * @param referencePitch The frequency of the first (index 0) note in the 4th
   *                       octave.
   * @param divisions The number of divisions of the octave.
   *                  (e.g. 12 for 12 EDO)
   */
  constructor(referencePitch, divisions) {
    super();
    this.referencePitch = referencePitch;
    this.divisions = divisions;

    for (let i = 0; i < divisions; ++i) {
      this.pitches.push(this.referencePitch * Math.pow(this.ratio, i));
    }
  }

  /**
   * Ratio between adjacent notes in this EDO
   */
  get ratio() {
    return Math.pow(2, 1 / this.divisions);
  }
}

/**
 * Encapsulates all "static" information about a note sequence.
 * I.e. how many beats, what tuning, and what actual notes to play.
 * Note that this does not store tempo. That is handled by the Scheduler.
 * A sequence is mutable. I.e. we can turn on/off notes in the grid.
 */
class Sequence {
  /**
   * @param beats The number of places in the "grid" for this sequence.
   * @param tuning A Tuning instance.
   * @param lowOctave The lowest octave included in the grid.
   * @param highOctave The highest octave included in the grid (may be the same
   *                   as lowOctave).
   */
  constructor(beats, tuning, lowOctave, highOctave) {
    this.beats = beats;
    this.tuning = tuning;
    this.lowOctave = lowOctave;
    this.highOctave = highOctave;
    let numOctaves = highOctave - lowOctave + 1;
    // Array of arrays of ordered pairs (octave, note).
    // Outer array is beats.
    // Inner array is notes on each beat.
    // Inner array is an array of frequences that should be played on each beat.
    this.seq = [];
    for (let i = 0; i < this.beats; ++i) {
      this.seq.push([]);
      for (let j = 0; j < this.tuning.length * numOctaves; ++j) {
        this.seq[i].push(false);
      }
    }
  }

  /**
   * The number of beats in the sequence.
   */
  get length() {
    return this.seq.length;
  }

  get numOctaves() {
    return this.highOctave - this.lowOctave + 1;
  }

  setNote(beat, octave, noteIndex) {
    this.seq[beat][
      (octave - this.lowOctave) * this.tuning.length + noteIndex
    ] = true;
  }

  unsetNote(beat, octave, noteIndex) {
    this.seq[beat][
      (octave - this.lowOctave) * this.tuning.length + noteIndex
    ] = false;
  }

  getIteratorAtBeat(beat) {
    return new NotesOnBeatIterator(this, beat);
  }
}

/**
 * Iterates through notes in a sequence on a given beat.
 * The intention of this class is to decouple the Sequence classs from the
 * Scheduler class without doing something inefficient like having the Sequence
 * create a new array and pass it to the Scheduler.
 */
class NotesOnBeatIterator {
  constructor(sequence, beat) {
    this.sequence = sequence;
    this.beat = beat;
    this.beatArray = this.sequence.seq[beat];
    // Index of next note to return
    this.nextIndex = 0;
  }

  advanceToNextActiveNote() {
    while (this.nextIndex < this.beatArray.length) {
      if (this.beatArray[this.nextIndex]) {
	break;
      }
      this.nextIndex++;
    }
  }

  get hasNext() {
    this.advanceToNextActiveNote();
    if (this.nextIndex < this.beatArray.length) {
      return true;
    }
    return false;
  }

  get next() {
    this.advanceToNextActiveNote();
    let scaleLength = this.sequence.tuning.length;
    let note = this.nextIndex % scaleLength;
    let octave = this.sequence.lowOctave + Math.floor(this.nextIndex / scaleLength);
    this.nextIndex++;
    return this.sequence.tuning.getNoteInOctave(octave, note);
  }
}

/**
 * Handles scheduling of notes in a Sequence.
 */
class Scheduler {
  /**
   * @param sequence The sequence that is to be played.
   */
  constructor(sequence) {
    this.audioCtx = new AudioContext();
    this.sequence = sequence;
    // period in which to call lookAheadAndSchedule again (milliseconds)
    this.lookAheadAndSchedulePeriod = 25.0;
    // period in which lookAheadAndSchedule will schedule notes ahead of time
    // (seconds)
    this.scheduleAheadTime = 0.1;
    // which beat the current note is in in the sequence grid
    this.currentNoteIndex = 0;
    this.nextNoteTime = 0.0; // when next note should sound
    this.noteQueue = []; // queue of notes to play (for rendering purposes)

    // used to store ID returned by setTimeout in case we need to cancel events
    this.timerID = null;

    // Set defaults which may be changed by user later
    this.bpm = 120.0;
    this.waveform = "sine";
  }

  /**
   * Updates nextNoteTime and advances currentNoteIndex.
   */
  nextNote() {
    const period = 60 / this.bpm; // seconds
    this.nextNoteTime += period;

    this.currentNoteIndex++;
    this.currentNoteIndex %= this.sequence.length;
  }

  /**
   * Schedules a note to be played.
   * @param freq The frequency of the note to play.
   * @param noteIndex The spot in the sequencer grid to play the note. (For
   *                  rendering purposes)
   * @param scheduledTime The time at which the note should sound.
   */
  scheduleNote(freq, noteIndex, scheduledTime) {
    // This is where I would push notes to the queue when rendering implemented
    // I won't do this until I have implemented something that pops from this
    // queue.
    //this.playQueue.push({ noteIndex: noteIndex, scheduledTime: scheduledTime });

    let osc = this.audioCtx.createOscillator();
    osc.type = this.waveform;
    osc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
    // connect osc to output
    osc.connect(this.audioCtx.destination);
    osc.start(scheduledTime);
    osc.stop(scheduledTime + this.noteDuration);
  }

  /**
   * Looks ahead (based on this.lookahead) and calls scheduleNote to schedule
   * notes if necessary.
   * If a note is scheduled, nextNote is called to update indeces, etc.
   * This method will call setTimeout to call itself again.
   */
  lookAheadAndSchedule() {
    while (
      this.nextNoteTime <
      this.audioCtx.currentTime + this.scheduleAheadTime
    ) {
      // Iterate through notes in sequence at the current beat
      let iterator = this.sequence.getIteratorAtBeat(this.currentNoteIndex);
      while (iterator.hasNext) {
	this.scheduleNote(iterator.next, this.currentNoteIndex, this.nextNoteTime);
      }
      this.nextNote();
    }

    this.timerID = window.setTimeout(
      () => this.lookAheadAndSchedule(),
      this.lookAheadAndSchedulePeriod
    );
  }

  setBPM(bpm) {
    this.bpm = bpm;
  }

  /**
   * Duration of note sound (seconds)
   */
  get noteDuration() {
    return 1 / this.bpm * 60;
  }

  setWaveform(waveform) {
    this.waveform = waveform;
  }
}

class Driver {
  /**
   * Setup callbacks for inputs and get params to create sequencer.
   */
  setup() {
    // Add callbacks for static params
    let edo = this.getPlaceholderValue("edo");
    // TODO refactor code in callback into helper
    this.addInputCallback("edo", e => {
      edo = e.target.value;
    });
    let numBeats = this.getPlaceholderValue("numBeats");
    this.addInputCallback("numBeats", e => {
      numBeats = e.target.value;
    });

    // Ensure sequencer objects are not created if go is clicked more that
    // once.
    let clickedGo = false;
    let goButton = document.getElementById("go");
    goButton.addEventListener("click", e => {
      if (edo === undefined
	  || numBeats === undefined) {
	console.log("One or more setup parameters undefined");
	return;
      }

      if (clickedGo) {
	console.log("GO button was already clicked");
	return;
      }
      clickedGo = true;

      // TODO make reference pitch a static param
      // Calculate frequency of C4 by moving 9 semitones down from A4
      const C4 = 440 * Math.pow(Math.pow(2, 1 / 12), -9);
      this.tuning = new EDOTuning(440, edo);
      // TODO make octaves static params
      this.sequence = new Sequence(numBeats, this.tuning, 3, 4);
      this.scheduler = new Scheduler(this.sequence);

      // Add callbacks for dynamic params that need a Scheduler instance
      this.scheduler.setBPM(this.getPlaceholderValue("bpm"));
      this.addInputCallback("bpm", e => {
	let bpm = parseFloat(e.target.value);
	if (bpm !== NaN
	    && bpm > 0
	    && bpm < Infinity) {
	  this.scheduler.setBPM(e.target.value);
	}
      });

      this.scheduler.setWaveform(this.getPlaceholderValue("waveform"));
      this.addInputCallback("waveform", e => {
	this.scheduler.setWaveform(e.target.value);
      });

      this.start();
    });
  }

  /**
   * Helper function to add a callback to an input element.
   */
  addInputCallback(id, callback) {
    let element = document.getElementById(id);
    element.addEventListener("input", callback);
  }

  /**
   * Helper function to get the placeholder value of an input element.
   * If a value already exists, it will return that value.
   *
   * TODO refactor so that this is returned by addInputCallback
   */
  getPlaceholderValue(id) {
    let element = document.getElementById(id);
    if (element.value !== "") {
      // Value may have been pre-filled by browser based on history.
      // In this case, the pre-filled value takes precedence.
      return element.value;
    }
    return element.placeholder;
  }

  renderGrid() {
    let numNotes = this.sequence.tuning.length * this.sequence.numOctaves;
    let numBeats = this.sequence.length;

    let gridContainerElement = document.getElementById("grid");

    for (let i = 0; i < numNotes; ++i) {
      let noteElement = document.createElement("div");
      gridContainerElement.appendChild(noteElement);

      let note = (numNotes - i - 1) % this.sequence.tuning.length;
      let octave = this.sequence.lowOctave
	  + Math.floor((numNotes - i - 1) / this.tuning.length);
      // TODO make this a label element perhaps?
      let noteLabel = document.createElement("span");
      noteLabel.appendChild(document.createTextNode(octave + "-" + note));
      noteElement.appendChild(noteLabel);

      for (let j = 0; j < numBeats; ++j) {
	let beatElement = document.createElement("input");
	beatElement.type = "checkbox";
	beatElement.addEventListener("input", e => {
	  let beat = j;
	  if (e.target.checked) {
	    this.sequence.setNote(beat, octave, note);
	  } else {
	    this.sequence.unsetNote(beat, octave, note);
	  }
	});
	noteElement.appendChild(beatElement);
      }
    }
  }

  /**
   * Start the sequencer.
   */
  start() {
    this.renderGrid();
    this.scheduler.lookAheadAndSchedule();
  }

}

function main() {
  let driver = new Driver();
  driver.setup();
}

window.onload = main;
