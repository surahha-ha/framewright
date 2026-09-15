// framewright — one labelled slider with its readout.
//
// The fourth copy of this markup (the sound's level, the picture's zoom
// and two pans) was the trigger to write it once; the subtitle's two
// position sliders (E8-2c) are the fifth and sixth. Every change is the
// caller's command; the gesture ends here, on the pointer lifting, the key
// coming up or focus leaving, so a drag or a held arrow is one undo step
// (ADR-0006).

import { useStore } from '../store/projectStore';

export function RangeRow({
  label,
  min,
  max,
  step,
  value,
  valueText,
  describedBy,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** What the value means, for the readout and the screen reader. */
  valueText: string;
  describedBy: string;
  onChange: (value: number) => void;
}) {
  const endGesture = useStore((s) => s.endGesture);
  return (
    <label className="clip-range">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        aria-describedby={describedBy}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={endGesture}
        onKeyUp={endGesture}
        onBlur={endGesture}
      />
      <output aria-hidden="true">{valueText}</output>
    </label>
  );
}
