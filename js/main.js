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
   * @param referencePitch The frequency of A4.
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

  get length() {
    return this.seq.length;
  }

  setNote(beat, octave, noteIndex) {
  }

  unsetNote(beat, octave, noteIndex) {
  }
}

/**
 * Handles scheduling of notes in a Sequence.
 */
class Scheduler {
  constructor() {
    this.audioCtx = new AudioContext();
    this.bpm = 120.0;
    this.sequenceLength = 8; // number of beats in sequence
    this.noteDuration = 0.1; // duration of note sound (seconds)
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
  }

  /**
   * Updates nextNoteTime and advances currentNoteIndex.
   */
  nextNote() {
    const period = 60 / this.bpm; // seconds
    this.nextNoteTime += period;

    this.currentNoteIndex++;
    this.currentNoteIndex %= this.sequenceLength;
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
    osc.type = "sine";
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
      this.scheduleNote(220, this.currentNoteIndex, this.nextNoteTime);
      this.nextNote();
    }

    this.timerID = window.setTimeout(
      () => this.lookAheadAndSchedule(),
      this.lookAheadAndSchedulePeriod
    );
  }
}

function main() {
  const scheduler = new Scheduler();
  scheduler.lookAheadAndSchedule();

  let tuning = new EDOTuning(440, 12);
  let sequence = new Sequence(8, tuning, 3, 4);
  console.log(sequence);
  console.log(tuning.getNoteInOctave(3, 0));
  console.log(tuning.getNoteInOctave(3, 1));
  console.log(tuning.getNoteInOctave(5, 0));
  console.log(tuning.getNoteInOctave(5, 1));
}

main();
